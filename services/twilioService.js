import twilio from 'twilio';
import 'dotenv/config';

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
    to: `whatsapp:${to}`, // Assuming 'to' is a plain number that needs prefix
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
    const message = await client.messages.create(messageData);
    console.log(`✅ WhatsApp message sent to ${to}. SID: ${message.sid}`);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error(`❌ Error sending WhatsApp message to ${to}: ${error.message}`, error);
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
    console.warn('⚠️ TWILIO_SMS_SID is not configured. SMS fallback disabled.');
    return { success: false, error: 'SMS fallback service (TWILIO_SMS_SID) not configured.' };
  }
  if (!to || !body) {
    console.error('❌ "to" and "body" are required for sending SMS message.');
    return { success: false, error: '"to" and "body" are required.' };
  }

  try {
    const message = await client.messages.create({
      body: body,
      messagingServiceSid: smsServiceSid, // Using Messaging Service SID
      to: to, // Assuming 'to' is a full E.164 number
    });
    console.log(`✅ SMS fallback sent to ${to}. SID: ${message.sid}`);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error(`❌ Error sending SMS fallback to ${to}: ${error.message}`, error);
    return { success: false, error: error.message, details: error };
  }
}

export { sendWapp, smsFallback }; 