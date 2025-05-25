import templates from "../marketing_templates.json" assert { type: "json" };

/**
 * Detects user intent based on Hebrew text patterns
 * @param {string} text - User input text
 * @returns {string} Intent type: 'lead_gen' | 'price_pushback' | 'close' | 'default'
 */
export function intentDetect(text) {
  const lowerText = text.toLowerCase();
  
  // Lead generation patterns - interest in insurance
  const leadPatterns = [
    /ביטוח/,
    /פוליסה/,
    /כיסוי/,
    /הצעת מחיר/,
    /מעוניין/,
    /רוצה לבטח/,
    /איך מבטחים/,
    /מה כולל/,
    /כמה עולה/
  ];
  
  // Price objection patterns
  const pricePatterns = [
    /יקר/,
    /יקרה/,
    /יקרים/,
    /יקרות/,
    /מחיר גבוה/,
    /עולה הרבה/,
    /יותר מדי/,
    /לא שווה/,
    /לא צריך/,
    /מיותר/,
    /בזבוז כסף/
  ];
  
  // Closing/action patterns
  const closePatterns = [
    /בואו נתחיל/,
    /אני מוכן/,
    /בסדר/,
    /נעשה את זה/,
    /איך ממשיכים/,
    /מה השלב הבא/,
    /תכין לי הצעה/,
    /אני רוצה/,
    /בואו נקבע/
  ];
  
  // Check patterns in order of priority
  if (closePatterns.some(pattern => pattern.test(lowerText))) {
    return 'close';
  }
  
  if (pricePatterns.some(pattern => pattern.test(lowerText))) {
    return 'price_pushback';
  }
  
  if (leadPatterns.some(pattern => pattern.test(lowerText))) {
    return 'lead_gen';
  }
  
  return 'default';
}

/**
 * Builds a sales response based on intent and user memory
 * @param {string} intent - The detected intent
 * @param {object} memory - User memory object with optional firstName
 * @returns {string} Formatted sales response
 */
export function buildSalesResponse(intent, memory = {}) {
  let templateArray;
  
  // Map intent to template array
  switch (intent) {
    case 'lead_gen':
      templateArray = templates.LEAD;
      break;
    case 'price_pushback':
      templateArray = templates.OBJECTION;
      break;
    case 'close':
      templateArray = templates.CLOSE;
      break;
    case 'default':
    default:
      templateArray = templates.DEFAULT;
      break;
  }
  
  // Pick a random template from the array
  const randomIndex = Math.floor(Math.random() * templateArray.length);
  let response = templateArray[randomIndex];
  
  // Replace {{name}} placeholder with firstName if available
  if (memory.firstName) {
    response = response.replace(/\{\{name\}\}/g, memory.firstName);
  } else {
    // Remove {{name}} placeholder if no firstName available
    response = response.replace(/\{\{name\}\},?\s*/g, '');
  }
  
  return response;
} 