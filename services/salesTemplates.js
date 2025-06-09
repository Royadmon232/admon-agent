import templates from "../marketing_templates.json" with { type: "json" };

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
    /כמה עולה/,
    /תוכל להסביר/,
    /אשמח לדעת/,
    /מה היתרונות/,
    /מה חשוב לדעת/,
    /איזה ביטוח/,
    /מה מומלץ/,
    /צריך ביטוח/,
    /מחפש ביטוח/,
    /רוצה לדעת/,
    /אפשר להסביר/,
    /מה התנאים/,
    /מה המחיר/,
    /איך זה עובד/,
    /מה ההבדל/,
    /מה חשוב/,
    /מה כדאי/
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
    /בזבוז כסף/,
    /חבל על הכסף/,
    /זה לא הכרחי/,
    /אני לא בטוח/,
    /אולי אחר כך/,
    /אני חושב על זה/,
    /זול יותר/,
    /אין לי כסף/,
    /זה יקר מדי/,
    /יותר מדי כסף/,
    /לא רוצה לשלם/,
    /זה לא משתלם/,
    /אני אחכה/,
    /אולי בהמשך/,
    /אני אבדוק/
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
    /בואו נקבע/,
    /מתי אפשר/,
    /איך מתחילים/,
    /אני מעוניין/,
    /בואו נסגור/,
    /אני מסכים/,
    /בואו נדבר/,
    /בוא נעשה/,
    /אני רוצה להתחיל/,
    /בוא נתקדם/,
    /אני רוצה להמשיך/,
    /בואו נמשיך/,
    /אני רוצה להצטרף/,
    /בואו נחתום/,
    /אני רוצה לקנות/,
    /בואו נסגור עסקה/,
    /אני רוצה להזמין/
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
 * @param {object} memory - User memory object with optional firstName, city, homeValue
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
  
  // Replace placeholders with user data if available
  if (memory.firstName) {
    response = response.replace(/\{\{name\}\}/g, memory.firstName);
  } else {
    // Remove {{name}} placeholder if no firstName available
    response = response.replace(/\{\{name\}\},?\s*/g, '');
  }
  
  // Add city-specific content if available
  if (memory.city) {
    response = response.replace(/\{\{city\}\}/g, memory.city);
  }
  
  // Add home value specific content if available
  if (memory.homeValue) {
    const value = parseInt(memory.homeValue);
    if (!isNaN(value)) {
      if (value > 2000000) {
        response = response.replace(/\{\{home_value\}\}/g, 'נכס יוקרתי');
      } else if (value > 1000000) {
        response = response.replace(/\{\{home_value\}\}/g, 'נכס בעל ערך');
      } else {
        response = response.replace(/\{\{home_value\}\}/g, 'נכס');
      }
    }
  }
  
  // Add emoji if not present
  if (!response.includes('📱') && !response.includes('💪') && !response.includes('🏠') && 
      !response.includes('💰') && !response.includes('🤝') && !response.includes('⭐')) {
    response += ' 💪';
  }
  
  return response;
} 