import { remember, recall } from "./services/memoryService.js";
import { sendWhatsAppMessage, sendWhatsAppMessageWithButton } from "./agentController.js";
import axios from 'axios';
import { sendQuoteStep } from "./sendQuoteStep.js";

// WhatsApp List Message function
async function sendWhatsAppListMessage(to, headerText, bodyText, buttonText, sections) {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error("❌ WhatsApp API configuration missing");
    return;
  }

  try {
    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: {
        type: "list",
        header: {
          type: "text",
          text: headerText
        },
        body: {
          text: bodyText
        },
        action: {
          button: buttonText,
          sections: sections
        }
      }
    };

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      payload,
      { 
        headers: { 
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`, 
          "Content-Type": "application/json" 
        } 
      }
    );
    
    console.log(`✅ Sent WhatsApp list message to ${to}`);
  } catch (error) {
    console.error("Error sending WhatsApp list message:", error.response?.data || error.message);
    // Fallback to regular message with numbered options
    const fallbackText = `${headerText}\n\n${bodyText}\n\n${sections[0].rows.map((row, index) => `${index + 1}. ${row.title}`).join('\n')}`;
    await sendWhatsAppMessage(to, fallbackText);
  }
}

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

// Coverage type options
const COVERAGE_OPTIONS = {
  'מבנה ותכולה': 'structure_and_contents',
  'מבנה בלבד': 'structure_only',
  'תכולה בלבד': 'contents_only',
  'מבנה בלבד משועבד': 'structure_only_mortgaged'
};

// Property type options
const PROPERTY_OPTIONS = {
  'בית פרטי': 'private_house',
  'משותף קומת קרקע': 'shared_ground_floor',
  'משותף קונה ראשונה': 'shared_first_buyer',
  'משותף קומת ביניים': 'shared_middle_floor',
  'משותף קומה אחרונה': 'shared_top_floor'
};

/**
 * Main function to handle the house quote flow
 * @param {string} phone - User's phone number
 * @param {string} userMsg - User's message
 * @returns {Promise<string>} - Response message
 */
export async function startHouseQuoteFlow(phone, userMsg) {
  try {
    const memory = await recall(phone);
    console.info("[Quote Flow] Starting quote flow for", phone, "with message:", userMsg);
    
    // If this is a new quote request, start with coverage type
    if (!memory.quoteStage) {
      console.info("[Quote Flow] New quote request, starting with coverage type");
      await remember(phone, 'quoteStage', QUOTE_STAGES.COVERAGE_TYPE);
      return await sendQuoteStep(phone, QUOTE_STAGES.COVERAGE_TYPE);
    }
    
    // Handle existing quote flow based on current stage
    switch (memory.quoteStage) {
      case QUOTE_STAGES.COVERAGE_TYPE:
        // Store coverage type and move to property type
        await remember(phone, 'coverageType', userMsg);
        await remember(phone, 'quoteStage', QUOTE_STAGES.PROPERTY_TYPE);
        return await sendQuoteStep(phone, QUOTE_STAGES.PROPERTY_TYPE);
        
      case QUOTE_STAGES.PROPERTY_TYPE:
        // Store property type and move to settlement
        await remember(phone, 'propertyType', userMsg);
        await remember(phone, 'quoteStage', QUOTE_STAGES.SETTLEMENT);
        return await sendQuoteStep(phone, QUOTE_STAGES.SETTLEMENT);
        
      case QUOTE_STAGES.SETTLEMENT:
        // Store settlement and move to street
        await remember(phone, 'settlement', userMsg);
        await remember(phone, 'quoteStage', QUOTE_STAGES.STREET);
        return await sendWhatsAppMessage(phone, "📝 *מה שם הרחוב?*\n\nהזן את שם הרחוב של הנכס:");
        
      case QUOTE_STAGES.STREET:
        // Store street and move to house number
        await remember(phone, 'street', userMsg);
        await remember(phone, 'quoteStage', QUOTE_STAGES.HOUSE_NUMBER);
        return await sendWhatsAppMessage(phone, "🏠 *מה מספר הבית?*\n\nהזן את מספר הבית:");
        
      case QUOTE_STAGES.HOUSE_NUMBER:
        // Store house number and move to postal code
        await remember(phone, 'houseNumber', userMsg);
        await remember(phone, 'quoteStage', QUOTE_STAGES.POSTAL_CODE);
        return await sendWhatsAppMessage(phone, "📮 *מה המיקוד?*\n\nהזן את מספר המיקוד של הנכס:");
        
      case QUOTE_STAGES.POSTAL_CODE:
        // Store postal code and complete the flow
        await remember(phone, 'postalCode', userMsg);
        await remember(phone, 'quoteStage', QUOTE_STAGES.COMPLETED);
        
        // Send completion message
        const completionMsg = `✅ *תודה על המידע!*\n\nאני אכין עבורך הצעת מחיר מותאמת אישית בהתבסס על המידע שסיפקת:\n\n` +
          `📦 *סוג כיסוי:* ${memory.coverageType}\n` +
          `🏠 *סוג נכס:* ${memory.propertyType}\n` +
          `📍 *מיקום:* ${memory.settlement}, ${memory.street} ${memory.houseNumber}\n` +
          `📮 *מיקוד:* ${memory.postalCode}\n\n` +
          `אני אשלח לך את ההצעה בקרוב.`;
        
        return await sendWhatsAppMessage(phone, completionMsg);
        
      default:
        console.error("[Quote Flow] Unknown quote stage:", memory.quoteStage);
        return await sendWhatsAppMessage(phone, "מצטער, אירעה שגיאה בתהליך. אנא התחל מחדש.");
    }
  } catch (error) {
    console.error("[Quote Flow] Error in quote flow:", error);
    return await sendWhatsAppMessage(phone, "מצטער, אירעה שגיאה בתהליך. אנא נסה שוב מאוחר יותר.");
  }
}

// Stage 1: ID Number
async function handleIdNumber(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askIdNumber(phone);
  }
  
  // Validate ID number (basic validation - 9 digits)
  const idPattern = /^\d{9}$/;
  if (!idPattern.test(userMsg.trim())) {
    return "אנא הזן תעודת זהות תקינה (9 ספרות).";
  }
  
  // Save ID and move to next stage
  await remember(phone, 'quoteData.idNumber', userMsg.trim());
  await remember(phone, 'quoteStage', QUOTE_STAGES.START_DATE);
  
  return await askStartDate(phone);
}

async function askIdNumber(phone) {
  const message = `🆔 *מה מספר תעודת הזהות שלך?*

אנא הזן מספר תעודת זהות בן 9 ספרות.`;
  await sendWhatsAppMessage(phone, message);
  return message;
}

// Stage 2: Start Date
async function handleStartDate(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askStartDate(phone);
  }
  
  // Validate date format dd/mm/yyyy
  const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!datePattern.test(userMsg.trim())) {
    return "אנא הזן תאריך בפורמט dd/mm/yyyy (לדוגמה: 15/12/2024).";
  }
  
  // Additional date validation
  const [day, month, year] = userMsg.trim().split('/').map(Number);
  const date = new Date(year, month - 1, day);
  
  if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
    return "אנא הזן תאריך תקין בפורמט dd/mm/yyyy.";
  }
  
  // Check if date is not in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) {
    return "תאריך תחילת הביטוח לא יכול להיות בעבר. אנא הזן תאריך עתידי.";
  }
  
  // Save date and move to next stage
  await remember(phone, 'quoteData.startDate', userMsg.trim());
  await remember(phone, 'quoteStage', QUOTE_STAGES.COVERAGE_TYPE);
  
  return await askCoverageType(phone);
}

async function askStartDate(phone) {
  const message = `📅 *מאיזה תאריך תרצה שהביטוח יתחיל?*

אנא הזן תאריך בפורמט dd/mm/yyyy (לדוגמה: 15/12/2024)`;
  await sendWhatsAppMessage(phone, message);
  return message;
}

// Stage 3: Coverage Type
async function handleCoverageType(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askCoverageType(phone);
  }
  
  // Check for list message IDs first
  let coverageType = null;
  let selectedOptionText = '';
  
  if (userMsg.includes('structure_and_contents')) {
    coverageType = 'structure_and_contents';
    selectedOptionText = 'מבנה ותכולה';
  } else if (userMsg.includes('structure_only_mortgaged')) {
    coverageType = 'structure_only_mortgaged';
    selectedOptionText = 'מבנה בלבד משועבד';
  } else if (userMsg.includes('structure_only')) {
    coverageType = 'structure_only';
    selectedOptionText = 'מבנה בלבד';
  } else if (userMsg.includes('contents_only')) {
    coverageType = 'contents_only';
    selectedOptionText = 'תכולה בלבד';
  } else {
    // Fallback to text matching
    const selectedOption = Object.keys(COVERAGE_OPTIONS).find(option => 
      userMsg.includes(option) || userMsg.includes(option.replace(/\s+/g, ''))
    );
    
    if (selectedOption) {
      coverageType = COVERAGE_OPTIONS[selectedOption];
      selectedOptionText = selectedOption;
    }
  }
  
  if (!coverageType) {
    return await askCoverageType(phone);
  }
  
  // Save coverage type and set restrictions
  await remember(phone, 'quoteData.coverageType', coverageType);
  await remember(phone, 'quoteData.coverageTypeText', selectedOptionText);
  
  // Apply logic based on coverage type
  if (coverageType === 'structure_only_mortgaged') {
    // Disable extra chapters for mortgaged structure only
    await remember(phone, 'quoteData.restrictions.disableContents', true);
    await remember(phone, 'quoteData.restrictions.disableCyber', true);
    await remember(phone, 'quoteData.restrictions.disableTerror', true);
    await remember(phone, 'quoteData.restrictions.disableBusiness', true);
    await remember(phone, 'quoteData.restrictions.disableEmployers', true);
  } else if (coverageType === 'structure_only') {
    await remember(phone, 'quoteData.restrictions.disableContents', true);
  } else if (coverageType === 'contents_only') {
    await remember(phone, 'quoteData.restrictions.disableStructure', true);
  }
  
  await remember(phone, 'quoteStage', QUOTE_STAGES.PROPERTY_TYPE);
  return await askPropertyType(phone);
}

async function askCoverageType(phone) {
  const headerText = "📦 *איזה סוג כיסוי אתה מחפש?*";
  const bodyText = "בחר את סוג הכיסוי המתאים עבורך:";
  const buttonText = "בחר סוג כיסוי";
  
  const sections = [
    {
      title: "אפשרויות כיסוי",
      rows: [
        {
          id: "structure_and_contents",
          title: "מבנה ותכולה",
          description: "כיסוי מלא למבנה ולתכולה"
        },
        {
          id: "structure_only",
          title: "מבנה בלבד",
          description: "כיסוי למבנה בלבד"
        },
        {
          id: "contents_only",
          title: "תכולה בלבד",
          description: "כיסוי לתכולה בלבד"
        },
        {
          id: "structure_only_mortgaged",
          title: "מבנה בלבד משועבד",
          description: "כיסוי למבנה משועבד"
        }
      ]
    }
  ];
  
  await sendWhatsAppListMessage(phone, headerText, bodyText, buttonText, sections);
  return `${headerText}\n\n${bodyText}`;
}

// Stage 4: Property Type
async function handlePropertyType(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askPropertyType(phone);
  }
  
  // Check for list message IDs first
  let propertyType = null;
  let selectedOptionText = '';
  
  if (userMsg.includes('private')) {
    propertyType = 'private_house';
    selectedOptionText = 'בית פרטי';
  } else if (userMsg.includes('ground')) {
    propertyType = 'shared_ground_floor';
    selectedOptionText = 'משותף קומת קרקע';
  } else if (userMsg.includes('first_buyer')) {
    propertyType = 'shared_first_buyer';
    selectedOptionText = 'משותף קונה ראשונה';
  } else if (userMsg.includes('middle')) {
    propertyType = 'shared_middle_floor';
    selectedOptionText = 'משותף קומת ביניים';
  } else if (userMsg.includes('top')) {
    propertyType = 'shared_top_floor';
    selectedOptionText = 'משותף קומה אחרונה';
  } else {
    // Fallback to text matching
    const selectedOption = Object.keys(PROPERTY_OPTIONS).find(option => 
      userMsg.includes(option) || userMsg.includes(option.replace(/\s+/g, ''))
    );
    
    if (selectedOption) {
      propertyType = PROPERTY_OPTIONS[selectedOption];
      selectedOptionText = selectedOption;
    }
  }
  
  if (!propertyType) {
    return await askPropertyType(phone);
  }
  
  // Save property type
  await remember(phone, 'quoteData.propertyType', propertyType);
  await remember(phone, 'quoteData.propertyTypeText', selectedOptionText);
  
  // Apply logic: if private house, skip floors question later
  if (propertyType === 'private_house') {
    await remember(phone, 'quoteData.skipFloorsQuestion', true);
  }
  
  await remember(phone, 'quoteStage', QUOTE_STAGES.SETTLEMENT);
  return await askSettlement(phone);
}

async function askPropertyType(phone) {
  const headerText = "🏠 *מה סוג הנכס שלך?*";
  const bodyText = "בחר את סוג הנכס המתאים:";
  const buttonText = "בחר סוג נכס";
  
  const sections = [
    {
      title: "אפשרויות",
      rows: [
        {
          id: "private",
          title: "בית פרטי",
          description: "בית פרטי עצמאי"
        },
        {
          id: "ground",
          title: "משותף קומת קרקע",
          description: "דירה בקומת קרקע"
        },
        {
          id: "first_buyer",
          title: "משותף קונה ראשונה",
          description: "דירה של קונה ראשונה"
        },
        {
          id: "middle",
          title: "משותף קומת ביניים",
          description: "דירה בקומת ביניים"
        },
        {
          id: "top",
          title: "משותף קומה אחרונה",
          description: "דירה בקומה עליונה"
        }
      ]
    }
  ];
  
  await sendWhatsAppListMessage(phone, headerText, bodyText, buttonText, sections);
  return `${headerText}\n\n${bodyText}`;
}

// Stage 5: Settlement
async function handleSettlement(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askSettlement(phone);
  }
  
  // Basic validation - not empty and reasonable length
  const settlement = userMsg.trim();
  if (settlement.length < 2 || settlement.length > 50) {
    return "אנא הזן שם יישוב תקין.";
  }
  
  await remember(phone, 'quoteData.settlement', settlement);
  await remember(phone, 'quoteStage', QUOTE_STAGES.STREET);
  
  return await askStreet(phone);
}

async function askSettlement(phone) {
  const message = `📍 *באיזה יישוב נמצא הנכס?*

אנא הזן את שם היישוב (לדוגמה: תל אביב)`;
  await sendWhatsAppMessage(phone, message);
  return message;
}

// Stage 6: Street
async function handleStreet(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askStreet(phone);
  }
  
  const street = userMsg.trim();
  if (street.length < 2 || street.length > 100) {
    return "אנא הזן שם רחוב תקין.";
  }
  
  await remember(phone, 'quoteData.street', street);
  await remember(phone, 'quoteStage', QUOTE_STAGES.HOUSE_NUMBER);
  
  return await askHouseNumber(phone);
}

async function askStreet(phone) {
  const message = `🛣️ *מה שם הרחוב?*

אנא הזן את שם הרחוב (לדוגמה: דיזנגוף)`;
  await sendWhatsAppMessage(phone, message);
  return message;
}

// Stage 7: House Number
async function handleHouseNumber(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askHouseNumber(phone);
  }
  
  const houseNumber = userMsg.trim();
  // Allow numbers with letters (like 15א)
  if (!/^\d+[א-ת]?$/.test(houseNumber)) {
    return "אנא הזן מספר בית תקין (למשל: 15 או 15א).";
  }
  
  await remember(phone, 'quoteData.houseNumber', houseNumber);
  await remember(phone, 'quoteStage', QUOTE_STAGES.POSTAL_CODE);
  
  return await askPostalCode(phone);
}

async function askHouseNumber(phone) {
  const message = `🏠 *מה מספר הבית?*

אנא הזן את מספר הבית (לדוגמה: 15 או 15א)`;
  await sendWhatsAppMessage(phone, message);
  return message;
}

// Stage 8: Postal Code
async function handlePostalCode(phone, userMsg) {
  if (!userMsg || userMsg.trim() === '') {
    return await askPostalCode(phone);
  }
  
  // Validate Israeli postal code (7 digits)
  const postalPattern = /^\d{7}$/;
  if (!postalPattern.test(userMsg.trim())) {
    return "אנא הזן מיקוד תקין (7 ספרות).";
  }
  
  await remember(phone, 'quoteData.postalCode', userMsg.trim());
  await remember(phone, 'quoteStage', QUOTE_STAGES.COMPLETED);
  
  return await completeStage1(phone);
}

async function askPostalCode(phone) {
  const message = `📮 *מה המיקוד של הנכס?*

אנא הזן מיקוד בן 7 ספרות (לדוגמה: 6801234)`;
  await sendWhatsAppMessage(phone, message);
  return message;
}

// Complete Stage 1
async function completeStage1(phone) {
  const memory = await recall(phone);
  const quoteData = memory.quoteData || {};
  
  const summary = `✅ *השלב הראשון הושלם בהצלחה!*

הנה סיכום הפרטים שמסרת:

┌─────────────────────────────┐
│ 📋 *פרטים בסיסיים*         │
├─────────────────────────────┤
│ 🆔 תעודת זהות: ${quoteData.idNumber}     │
│ 📅 תאריך תחילה: ${quoteData.startDate}   │
│ 🏠 סוג כיסוי: ${quoteData.coverageTypeText} │
│ 🏘️ סוג נכס: ${quoteData.propertyTypeText}   │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 🏠 *כתובת הנכס*            │
├─────────────────────────────┤
│ 🏙️ יישוב: ${quoteData.settlement}        │
│ 🛣️ רחוב: ${quoteData.street}            │
│ 🏠 מספר: ${quoteData.houseNumber}        │
│ 📮 מיקוד: ${quoteData.postalCode}        │
└─────────────────────────────┘

🎯 *השלב הבא:*
שאלות על פרטי הנכס והכיסויים הנוספים

┌─────────────────────┐
│ ✅ הפרטים נכונים    │
│ המשך לשלב הבא       │
└─────────────────────┘

┌─────────────────────┐
│ ✏️ תקן פרטים        │
│ חזור לתחילת השלב    │
└─────────────────────┘

💬 *האם הפרטים נכונים ואתה מוכן להמשיך?*`;

  await sendWhatsAppMessage(phone, summary);
  return summary;
} 