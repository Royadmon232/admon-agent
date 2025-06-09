import templates from "../marketing_templates.json" with { type: "json" };

// Add CTA templates
const CTA_TEMPLATES = {
  PRICE_INQUIRY: [
    "תרצה שאכין לך הצעת מחיר מותאמת אישית? 💼",
    "אשמח לבנות לך תוכנית ביטוח שמתאימה בדיוק לצרכים שלך. מה דעתך?",
    "בוא נבדוק יחד איזו פוליסה תתאים לך במחיר הטוב ביותר. מעוניין?"
  ],
  GENERAL_INFO: [
    "יש לך שאלות נוספות? אשמח להסביר הכל בצורה ברורה 😊",
    "רוצה לשמוע על האפשרויות המתאימות לך? אני כאן בשבילך",
    "אם תרצה, אוכל להכין לך הצעה מפורטת. מה אומר?"
  ],
  FOLLOW_UP: [
    "נשמח לקבוע שיחה קצרה להמשך התהליך. מתי נוח לך?",
    "אני יכול ליצור איתך קשר טלפוני לסיום התהליך. מה המספר שלך?",
    "בוא נתקדם! איך הכי נוח לך שניצור קשר?"
  ]
};

/**
 * Detects user intent based on Hebrew text patterns
 * @param {string} text - User input text
 * @returns {string} Intent type: 'greeting' | 'lead_gen' | 'price_pushback' | 'close' | 'default'
 */
export function intentDetect(text) {
  const lowerText = text.toLowerCase();
  
  // Check for greeting first
  const greetingRegex = /^(שלום|היי|הי|hi|hello|hey|בוקר טוב|צהריים טובים|ערב טוב)[.!? ]*$/i;
  if (greetingRegex.test(lowerText.trim())) return "greeting";

  // Follow-up patterns
  const followUpPatterns = [
    /^(תוכל|יכול|אפשר) להסביר/,
    /^מה (זאת אומרת|הכוונה)/,
    /^(עוד|יותר) (פרטים|מידע|הסבר)/,
    /^(לא|כן),? אבל/,
    /^ו(מה|איך|כמה|מתי|איפה|למה)/,
    /^בנוסף/,
    /^גם/,
    /^אז/,
    /^למה/,
    /^איך בדיוק/,
    /^תן לי דוגמה/,
    /^הסבר/,
    /^פרט/
  ];
  
  if (followUpPatterns.some(pattern => pattern.test(lowerText))) {
    console.debug('[IntentDetect] Follow-up detected:', lowerText);
    return 'follow_up';
  }

  // Information gathering - when bot should ask questions
  const infoGatheringPatterns = [
    /רוצה לקבל הצעה/,
    /מעוניין בהצעת מחיר/,
    /כמה זה עולה/,
    /מה המחיר/,
    /תן לי הצעה/,
    /אני רוצה לבדוק/
  ];
  
  if (infoGatheringPatterns.some(pattern => pattern.test(lowerText))) {
    console.debug('[IntentDetect] Info gathering detected:', lowerText);
    return 'info_gathering';
  }

  // Lead generation patterns - interest in insurance
  const leadPatterns = [
    /מעוניין/,
    /רוצה לשמוע/,
    /מחפש ביטוח/,
    /צריך ביטוח/,
    /אשמח לקבל/,
    /תוכל להסביר/,
    /מה כולל/,
    /איזה כיסויים/,
    /מה הביטוח מכסה/,
    /interested/i,
    /looking for insurance/i,
    /need insurance/i
  ];

  // Price objection patterns
  const priceObjectionPatterns = [
    /יקר/,
    /מחיר גבוה/,
    /עולה הרבה/,
    /לא שווה/,
    /יותר מדי כסף/,
    /אין לי תקציב/,
    /expensive/i,
    /cost too much/i,
    /high price/i
  ];

  // Close patterns - ready to proceed
  const closePatterns = [
    /בוא נתקדם/,
    /איך מתחילים/,
    /רוצה להתחיל/,
    /מוכן להירשם/,
    /איך נוכל להמשיך/,
    /מה השלב הבא/,
    /בואו נסגור/,
    /אני מסכים/,
    /let's proceed/i,
    /ready to start/i,
    /sign up/i,
    /next step/i
  ];

  // Frustration or negative sentiment
  const frustrationPatterns = [
    /לא מבין/,
    /מבלבל/,
    /לא עונה לי/,
    /עזוב/,
    /לא מעוניין/,
    /תפסיק/,
    /די/,
    /חבל על הזמן/
  ];
  
  if (frustrationPatterns.some(pattern => pattern.test(lowerText))) {
    console.debug('[IntentDetect] Frustration detected:', lowerText);
    return 'frustration';
  }

  // Check patterns in priority order
  if (closePatterns.some(pattern => pattern.test(lowerText))) {
    console.debug('[IntentDetect] Close intent detected:', lowerText);
    return 'close';
  }
  
  if (priceObjectionPatterns.some(pattern => pattern.test(lowerText))) {
    console.debug('[IntentDetect] Price objection detected:', lowerText);
    return 'price_pushback';
  }
  
  if (leadPatterns.some(pattern => pattern.test(lowerText))) {
    console.debug('[IntentDetect] Lead generation detected:', lowerText);
    return 'lead_gen';
  }
  
  console.debug('[IntentDetect] Default intent for:', lowerText);
  return 'default';
}

// Templates for different intents
const INTENT_TEMPLATES = {
  follow_up: [
    "בטח, בוא נמשיך מאיפה שהפסקנו 😊",
    "כמובן! אשמח להרחיב על הנושא",
    "אין בעיה, אסביר בצורה אחרת"
  ],
  info_gathering: [
    "אשמח להכין לך הצעה מותאמת! כדי שאוכל לתת לך את המחיר המדויק, אצטרך כמה פרטים:\n- מה גודל הדירה?\n- באיזו עיר?\n- האם זו דירה בבעלותך או בשכירות?",
    "בשמחה! כדי להכין הצעת מחיר מדויקת, אשאל אותך כמה שאלות קצרות:\n- מה שווי הדירה המשוער?\n- כמה חדרים יש בדירה?\n- האם יש מערכות מיוחדות (מיזוג מרכזי, פאנלים סולאריים וכו')?",
    "מעולה! אכין לך הצעה אישית. רק כמה פרטים:\n- מה כתובת הנכס?\n- מתי נבנה הבניין?\n- האם היו נזקים בעבר?"
  ],
  frustration: [
    "אני מבין את התסכול שלך ומצטער על אי הנוחות. בוא ננסה בדרך אחרת - במה בדיוק אוכל לעזור לך?",
    "סליחה אם לא הייתי ברור. אני כאן כדי לעזור. איך אוכל להסביר טוב יותר?",
    "אני מתנצל אם המידע לא היה ברור. בוא נתחיל מחדש - מה השאלה העיקרית שלך?"
  ]
};

/**
 * Builds a sales response based on intent and user memory
 * @param {string} intent - The detected intent
 * @param {object} memory - User memory object with optional firstName, city, homeValue
 * @returns {string} Formatted sales response
 */
export function buildSalesResponse(intent, memory = {}) {
  // Handle greeting intent
  if (intent === "greeting") {
    const name = memory?.firstName ? `, ${memory.firstName}` : "";
    return `היי${name}! אני דוני 😊 אני כאן לעזור לך עם כל שאלה לגבי ביטוח דירה. איך אוכל לעזור?`;
  }

  // Handle specific intents with templates
  if (INTENT_TEMPLATES[intent]) {
    const templates = INTENT_TEMPLATES[intent];
    const template = templates[Math.floor(Math.random() * templates.length)];
    return template;
  }

  // Choose template based on memory state
  const chosenTemplate = chooseTemplate(memory);
  
  // Clean empty placeholders
  const clean = (tpl, key, replacement = "") =>
    tpl.replace(new RegExp(`\\\{\{${key}\\\}\}`, "g"), replacement);

  let response = chosenTemplate;
  response = clean(response, "name", memory?.firstName || "");
  response = clean(response, "city", memory?.city || "");
  response = clean(response, "home_value", memory?.homeValue || "");

  // Collapse double spaces
  response = response.replace(/\s{2,}/g, " ").trim();

  return response;
}

export function chooseCTA(intent, memory = {}) {
  // Choose appropriate CTA based on intent and context
  let ctaOptions = [];
  
  switch(intent) {
    case 'lead_gen':
      ctaOptions = CTA_TEMPLATES.PRICE_INQUIRY;
      break;
    case 'price_pushback':
      // Don't add another CTA on price objection
      return null;
    case 'close':
      ctaOptions = CTA_TEMPLATES.FOLLOW_UP;
      break;
    default:
      // For general questions, sometimes add a soft CTA
      if (Math.random() > 0.5) { // 50% chance
        ctaOptions = CTA_TEMPLATES.GENERAL_INFO;
      } else {
        return null;
      }
  }

  // Choose random CTA from options
  return ctaOptions[Math.floor(Math.random() * ctaOptions.length)];
} 