import twilio from 'twilio';
import 'dotenv/config';
import PQueue from 'p-queue';
import pg from 'pg';

// Twilio Client Initialization
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsAppFromNumber = process.env.TWILIO_WHATSAPP_FROM_NUMBER; // Dedicated WhatsApp "From" number
const smsServiceSid = process.env.TWILIO_SMS_SID; // Messaging Service SID for SMS

let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
} else {
  console.error('❌ Critical Twilio environment variables TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN are missing. Twilio client not initialized.');
  // Depending on the application's needs, you might throw an error here
  // or functions below will fail gracefully if client is undefined.
}

// p-queue setup: 5 concurrent operations
const queue = new PQueue({ concurrency: 5 });

// === Delivery Log Setup ===
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Ensure delivery_log table exists
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS delivery_log (
      id SERIAL PRIMARY KEY,
      customer TEXT,
      channel  TEXT,
      status   TEXT,
      template TEXT,
      ts TIMESTAMPTZ DEFAULT now()
    );`);
    console.log('[twilioService] ✅ delivery_log table ready');
    console.info('✅ TwilioService connected to DB with SSL');
  } catch (err) {
    console.error('[twilioService] ⚠️  Failed to ensure delivery_log table:', err.message);
  }
})();

// Helper function for retrying with exponential backoff
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sends a message via Twilio with retry and queue.
 * @param {object} messagePayload - The payload for client.messages.create().
 * @param {string} recipientInfo - For logging purposes (e.g., "WhatsApp to ${to}").
 * @returns {Promise<object>} The Twilio message object if successful.
 * @throws {Error} If all retry attempts fail.
 */
async function sendMessageWithRetryAndQueue(messagePayload, recipientInfo) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Add the client.messages.create call to the queue
      const message = await queue.add(() => {
        try {
          return client.messages.create(messagePayload);
        } catch (err) {
          if (err.code === 63038) {
            console.warn('[Twilio] Sandbox daily-limit hit');
            return { limited: true };
          }
          throw err;
        }
      });
      
      if (message && message.limited) {
        console.log(`Attempt ${attempt}: Daily limit reached for ${recipientInfo}`);
        return { limited: true };
      }
      
      console.log(`Attempt ${attempt}: Successfully sent ${recipientInfo}. SID: ${message.sid}`);
      return message; // Success
    } catch (error) {
      if (error.code === 63038) {              // Sandbox daily-limit hit
        console.warn('[Twilio] Daily Sandbox limit reached – skipping retries');
        return { limited: true };
      }
      lastError = error;
      console.warn(`Attempt ${attempt}: Failed to send ${recipientInfo}. Error: ${error.message}`);
      if (attempt < 3) {
        const delayTime = Math.pow(2, attempt -1) * 1000; // 1s, 2s
        console.log(`Retrying in ${delayTime / 1000}s...`);
        await delay(delayTime);
      }
    }
  }
  console.error(`All ${3} attempts to send ${recipientInfo} failed. Last error: ${lastError.message}`);
  throw lastError; // All attempts failed
}

/**
 * Sends a WhatsApp message.
 * @param {string} to - The recipient's phone number (e.g., E.164 format).
 * @param {string} body - The message text.
 * @param {string} [mediaUrl] - Optional URL of media to send.
 * @returns {Promise<{success: boolean, sid?: string, error?: string, details?: any}>} Operation result.
 */
async function sendWapp(to, body, mediaUrl = null) {
  if (!client) {
    console.error('❌ Twilio client not initialized. Cannot send WhatsApp message.');
    return { success: false, error: 'Twilio client not initialized.' };
  }
  if (!whatsAppFromNumber) {
    console.error('❌ TWILIO_WHATSAPP_FROM_NUMBER is not configured. Cannot send WhatsApp message.');
    return { success: false, error: 'WhatsApp "from" number not configured.' };
  }
  if (!to || !body) {
    console.error('❌ "to" and "body" are required for sending WhatsApp message.');
    return { success: false, error: '"to" and "body" are required.' };
  }

  const messageData = {
    from: `whatsapp:${whatsAppFromNumber}`,
    to: `whatsapp:${to}`,
    body: body,
  };

  if (mediaUrl) {
    if (typeof mediaUrl === 'string' && mediaUrl.trim() !== '') {
      messageData.mediaUrl = [mediaUrl];
    } else {
      console.warn('⚠️ mediaUrl provided but was empty or not a string. Sending without media.');
    }
  }

  try {
    const message = await sendMessageWithRetryAndQueue(messageData, `WhatsApp to ${to}`);
    if (message === null) {
      // Daily limit hit
      await logDelivery('daily_limit_reached', 'whatsapp');
      return { success: false, error: 'Daily message limit reached' };
    }
    console.log(`✅ WhatsApp message sent to ${to}. SID: ${message.sid}`); // Final success log
    await logDelivery('success', 'whatsapp');
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error(`❌ Error sending WhatsApp message to ${to} after retries: ${error.message}`, error);
    await logDelivery(error.message || 'error', 'whatsapp');
    return { success: false, error: error.message, details: error };
  }
}

/**
 * Sends an SMS message as a fallback.
 * @param {string} to - The recipient's phone number (E.164 format).
 * @param {string} body - The message text.
 * @returns {Promise<{success: boolean, sid?: string, error?: string, details?: any}>} Operation result.
 */
async function smsFallback(to, body) {
  if (!client) {
    console.error('❌ Twilio client not initialized. Cannot send SMS.');
    return { success: false, error: 'Twilio client not initialized.' };
  }
  if (!smsServiceSid) {
    console.warn('[Twilio] SMS fallback skipped – TWILIO_SMS_SID missing');
    return { smsSkipped: true };
  }
  if (!to || !body) {
    console.error('❌ "to" and "body" are required for sending SMS message.');
    return { success: false, error: '"to" and "body" are required.' };
  }

  const messageData = {
    body: body,
    messagingServiceSid: smsServiceSid,
    to: to,
  };

  try {
    const message = await sendMessageWithRetryAndQueue(messageData, `SMS fallback to ${to}`);
    if (message && message.limited) {
      await logDelivery('daily_limit_reached', 'sms');
      return { success: false, error: 'Daily message limit reached' };
    }
    console.log(`✅ SMS fallback sent to ${to}. SID: ${message.sid}`); // Final success log
    await logDelivery('success', 'sms');
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error(`❌ Error sending SMS fallback to ${to} after retries: ${error.message}`, error);
    await logDelivery(error.message || 'error', 'sms');
    return { success: false, error: error.message, details: error };
  }
}

/**
 * Write a delivery attempt to the database.
 * @param {string} status  - e.g., 'success' or error message.
 * @param {string} channel - 'whatsapp' | 'sms'
 */
async function logDelivery(status, channel) {
  try {
    await pool.query(
      'INSERT INTO delivery_log (channel, status) VALUES ($1, $2)',
      [channel, status]
    );
  } catch (err) {
    console.error('[twilioService] ⚠️  Failed to log delivery:', err.message);
  }
}

export { sendWapp, smsFallback }; 