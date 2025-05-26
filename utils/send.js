import twilio from 'twilio';
import { sendMessageWithRetryAndQueue } from '../services/twilioService.js';

// Twilio Client Initialization
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsAppFromNumber = process.env.TWILIO_WHATSAPP_FROM_NUMBER;

let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
} else {
  console.error('❌ Critical Twilio environment variables TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN are missing. Twilio client not initialized.');
}

/**
 * Sends a WhatsApp message via Twilio.
 * @param {string} to - The recipient's phone number (e.g., E.164 format).
 * @param {string} body - The message text.
 * @param {Array} [buttons] - Optional array of button objects for interactive messages.
 * @returns {Promise<{success: boolean, sid?: string, error?: string, details?: any}>} Operation result.
 */
export async function sendWapp(to, body, buttons = []) {
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

  try {
    const message = await sendMessageWithRetryAndQueue(messageData, `WhatsApp to ${to}`);
    console.log(`✅ WhatsApp message sent to ${to}. SID: ${message.sid}`);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error(`❌ Error sending WhatsApp message to ${to}:`, error);
    return { success: false, error: error.message, details: error };
  }
} 