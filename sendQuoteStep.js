import { sendWapp } from './services/twilioService.js';

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
 * @returns {Promise<string>} - Response message
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
  const message = `📦 *איזה סוג כיסוי אתה מחפש?*

בחר את סוג הכיסוי המתאים עבורך:

1. מבנה בלבד
2. תכולה בלבד
3. מבנה ותכולה
4. מבנה בלבד משועבד

הקלד את המספר המתאים או את שם האפשרות.`;
  
  await sendWapp(phone, message);
  return message;
}

/**
 * Sends interactive buttons for property type selection
 */
async function sendPropertyTypeButtons(phone) {
  const message = `🏠 *מה סוג הנכס שלך?*

בחר את סוג הנכס המתאים:

1. בית פרטי
2. משותף קומת קרקע
3. משותף קונה ראשונה
4. משותף קומת ביניים
5. משותף קומה אחרונה

הקלד את המספר המתאים או את שם האפשרות.`;
  
  await sendWapp(phone, message);
  return message;
}

/**
 * Sends an interactive list message for settlement selection
 */
async function sendSettlementList(phone) {
  const message = `📍 *באיזה יישוב נמצא הנכס?*

בחר את היישוב מהרשימה או הזן יישוב אחר:

1. תל אביב - תל אביב - יפו
2. ירושלים - בירת ישראל
3. חיפה - עיר הכרמל

הקלד את המספר המתאים או את שם היישוב.`;
  
  await sendWapp(phone, message);
  return message;
}

// Encapsulate the logic in a function to fix the illegal return statement
async function handleQuoteFlow(phone, userMsg, memory) {
  if (memory.quoteStage && memory.quoteStage !== 'stage1_completed') {
    console.info('[Quote Flow] User is in quote flow stage:', memory.quoteStage);
    const quoteResponse = await startHouseQuoteFlow(phone, userMsg);
    await sendWapp(phone, quoteResponse);
    return 'Quote form sent successfully via WhatsApp.';
  }

  const isQuoteRequest = quotePatterns.some(pattern => {
    const matches = pattern.test(normalizedMsg);
    if (matches) {
      console.info(`[Quote Flow] Quote pattern matched: ${pattern} for message: "${normalizedMsg}"`);
    }
    return matches;
  });

  const isConfirmation = detectConfirmation(normalizedMsg);
  if (memory.awaitingQuoteConfirmation && isConfirmation) {
    // User confirmed, clear the flag and start quote form
    await remember(phone, 'awaitingQuoteConfirmation', null);
    await remember(phone, 'quoteStage', 'id_number');
    // ...
  }

  const answer = await smartAnswer(normalizedMsg, memory) 
    || await semanticLookup(normalizedMsg, memory)
    || await salesFallback(normalizedMsg, memory);
} 