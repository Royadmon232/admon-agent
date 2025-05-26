import { sendWhatsAppMessage } from './services/twilio.js';

// Quote flow stages
const QUOTE_STAGES = {
  ID_NUMBER: 'id_number',
  START_DATE: 'start_date',
  COVERAGE_TYPE: 'coverage_type',
  PROPERTY_TYPE: 'property_type',
  SETTLEMENT: 'settlement',
  STREET: 'street',
  HOUSE_NUMBER: 'house_number',
  POSTAL_CODE: 'postal_code',
  COMPLETED: 'stage1_completed'
};

/**
 * Sends an interactive WhatsApp message based on the current quote stage
 * @param {string} phone - User's phone number
 * @param {string} stage - Current quote stage
 * @returns {Promise<object>} - Response from WhatsApp API
 */
export async function sendQuoteStep(phone, stage) {
  switch (stage) {
    case QUOTE_STAGES.COVERAGE_TYPE:
      return await sendCoverageTypeButtons(phone);
      
    case QUOTE_STAGES.PROPERTY_TYPE:
      return await sendPropertyTypeButtons(phone);
      
    case QUOTE_STAGES.SETTLEMENT:
      return await sendSettlementList(phone);
      
    default:
      throw new Error(`Unsupported quote stage: ${stage}`);
  }
}

/**
 * Sends interactive buttons for coverage type selection
 */
async function sendCoverageTypeButtons(phone) {
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "📦 *איזה סוג כיסוי אתה מחפש?*\n\nבחר את סוג הכיסוי המתאים עבורך:"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "coverage_structure_only",
              title: "מבנה בלבד"
            }
          },
          {
            type: "reply",
            reply: {
              id: "coverage_contents_only",
              title: "תכולה בלבד"
            }
          },
          {
            type: "reply",
            reply: {
              id: "coverage_structure_and_contents",
              title: "מבנה ותכולה"
            }
          }
        ]
      }
    }
  };
  
  return await sendWhatsAppMessage(phone, payload);
}

/**
 * Sends interactive buttons for property type selection
 */
async function sendPropertyTypeButtons(phone) {
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "🏠 *מה סוג הנכס שלך?*\n\nבחר את סוג הנכס המתאים:"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "property_private",
              title: "בית פרטי"
            }
          },
          {
            type: "reply",
            reply: {
              id: "property_ground_floor",
              title: "משותף קומת קרקע"
            }
          },
          {
            type: "reply",
            reply: {
              id: "property_first_buyer",
              title: "משותף קונה ראשונה"
            }
          },
          {
            type: "reply",
            reply: {
              id: "property_middle_floor",
              title: "משותף קומת ביניים"
            }
          },
          {
            type: "reply",
            reply: {
              id: "property_top_floor",
              title: "משותף קומה אחרונה"
            }
          }
        ]
      }
    }
  };
  
  return await sendWhatsAppMessage(phone, payload);
}

/**
 * Sends an interactive list message for settlement selection
 */
async function sendSettlementList(phone) {
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "📍 *באיזה יישוב נמצא הנכס?*"
      },
      body: {
        text: "בחר את היישוב מהרשימה או הזן יישוב אחר:"
      },
      action: {
        button: "בחר יישוב",
        sections: [
          {
            title: "יישובים נפוצים",
            rows: [
              {
                id: "settlement_tel_aviv",
                title: "תל אביב",
                description: "תל אביב - יפו"
              },
              {
                id: "settlement_jerusalem",
                title: "ירושלים",
                description: "בירת ישראל"
              },
              {
                id: "settlement_haifa",
                title: "חיפה",
                description: "עיר הכרמל"
              }
            ]
          }
        ]
      }
    }
  };
  
  return await sendWhatsAppMessage(phone, payload);
} 