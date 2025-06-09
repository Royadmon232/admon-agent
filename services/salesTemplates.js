import templates from "../marketing_templates.json" with { type: "json" };

/**
 * Detects user intent based on Hebrew text patterns
 * @param {string} text - User input text
 * @returns {string} Intent type: 'greeting' | 'lead_gen' | 'price_pushback' | 'close' | 'default'
 */
export function intentDetect(text) {
  const lowerText = text.toLowerCase();
  
  // Check for greeting first
  const greetingRegex = /^(שלום|היי|הי|hi|hello|hey)[.!? ]*$/i;
  if (greetingRegex.test(lowerText.trim())) return "greeting";
  
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
    case 'greeting':
      // Simple, friendly greeting response without marketing content
      if (memory.firstName) {
        return `שלום ${memory.firstName}! אני דוני, סוכן ביטוח דירות. איך אוכל לעזור לך היום? 🤝`;
      } else {
        return "שלום! אני דוני, סוכן ביטוח דירות. איך אוכל לעזור לך היום? 🤝";
      }
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
  
  // Track which placeholders were found and replaced
  const foundPlaceholders = {
    name: false,
    city: false,
    home_value: false
  };
  
  // Replace placeholders with user data if available
  if (memory.firstName) {
    response = response.replace(/\{\{name\}\}/g, memory.firstName);
    foundPlaceholders.name = true;
  } else {
    // Remove {{name}} placeholder if no firstName available
    response = response.replace(/\{\{name\}\},?\s*/g, '');
  }
  
  // Add city-specific content if available
  if (memory.city) {
    response = response.replace(/\{\{city\}\}/g, memory.city);
    foundPlaceholders.city = true;
  } else {
    // Replace city placeholder with a general term
    response = response.replace(/\{\{city\}\}/g, 'האזור שלך');
  }
  
  // Add home value specific content if available
  if (memory.homeValue) {
    const value = parseInt(memory.homeValue);
    if (!isNaN(value)) {
      let replacement;
      if (value > 2000000) {
        replacement = 'נכס יוקרתי';
      } else if (value > 1000000) {
        replacement = 'נכס בעל ערך';
      } else {
        replacement = 'נכס';
      }
      response = response.replace(/\{\{home_value\}\}/g, replacement);
      foundPlaceholders.home_value = true;
    } else {
      // Invalid home value, use general term
      response = response.replace(/\{\{home_value\}\}/g, 'הנכס');
    }
  } else {
    // No home value, use general term
    response = response.replace(/\{\{home_value\}\}/g, 'הנכס');
  }
  
  // Log any remaining placeholders that weren't replaced
  const remainingPlaceholders = response.match(/\{\{[^}]+\}\}/g);
  if (remainingPlaceholders) {
    console.warn('[SalesTemplates] Unhandled placeholders found:', {
      template: response,
      placeholders: remainingPlaceholders,
      memory: memory
    });
    
    // Replace any remaining placeholders with general terms
    response = response.replace(/\{\{[^}]+\}\}/g, 'הנכס');
  }
  
  // Add emoji if not present
  if (!response.includes('📱') && !response.includes('💪') && !response.includes('🏠') && 
      !response.includes('💰') && !response.includes('🤝') && !response.includes('⭐')) {
    response += ' 💪';
  }
  
  // Log successful placeholder replacements
  console.debug('[SalesTemplates] Placeholder replacements:', {
    found: foundPlaceholders,
    memory: memory,
    finalResponse: response
  });
  
  // Clean empty placeholders
  const clean = (tpl, key, replacement = "") =>
    tpl.replace(new RegExp(`\\\{\{${key}\\\}\}`, "g"), replacement);

  response = clean(response, "name", memory?.firstName || "");
  response = clean(response, "city", memory?.city || "");
  response = clean(response, "home_value", memory?.homeValue || "");

  // Collapse double spaces
  response = response.replace(/\s{2,}/g, " ").trim();
  
  return response;
} 