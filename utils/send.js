import axios from 'axios';

/**
 * Sends a WhatsApp message using the WhatsApp Business API
 * @param {string} phone - The recipient's phone number
 * @param {object} messagePayload - The message payload to send
 * @returns {Promise<object>} - The API response
 */
export async function sendWapp(phone, messagePayload) {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error("❌ WhatsApp API configuration missing");
    throw new Error("WhatsApp API configuration missing");
  }

  try {
    return await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        ...messagePayload
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error("Error sending WhatsApp message:", error.response?.data || error.message);
    throw error;
  }
} 