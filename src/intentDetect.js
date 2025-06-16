export function detectIntent(msg) {
  const normalizedMsg = msg.toLowerCase().trim();
  
  // Greeting patterns
  const greetingPatterns = [
    'שלום',
    'היי',
    'הי',
    'בוקר טוב',
    'ערב טוב',
    'צהריים טובים'
  ];
  
  // Thank you patterns
  const thankYouPatterns = [
    'תודה',
    'תודה רבה',
    'תודה לך',
    'תודה לך רבות',
    'מעריך',
    'מעריכה'
  ];
  
  // Small talk patterns
  const smallTalkPatterns = [
    'מה שלומך',
    'מה נשמע',
    'מה קורה',
    'מה המצב',
    'מה חדש',
    'איך הולך',
    'מה שלומך היום'
  ];
  
  // Check for greetings
  if (greetingPatterns.some(pattern => normalizedMsg.includes(pattern))) {
    console.log('[IntentDetect] Greeting detected:', msg);
    return 'greeting';
  }
  
  // Check for thank you messages
  if (thankYouPatterns.some(pattern => normalizedMsg.includes(pattern))) {
    console.log('[IntentDetect] Thank you detected:', msg);
    return 'thank_you';
  }
  
  // Check for small talk
  if (smallTalkPatterns.some(pattern => normalizedMsg.includes(pattern))) {
    console.log('[IntentDetect] Small talk detected:', msg);
    return 'small_talk';
  }
  
  // Check for lead generation
  if (normalizedMsg.includes('ביטוח') || 
      normalizedMsg.includes('פוליסה') || 
      normalizedMsg.includes('כיסוי') ||
      normalizedMsg.includes('הרחבה')) {
    console.log('[IntentDetect] Lead generation detected:', msg);
    return 'lead_gen';
  }
  
  // Check for follow-up
  if (normalizedMsg.includes('ומה') || 
      normalizedMsg.includes('ואם') || 
      normalizedMsg.includes('ואיך') ||
      normalizedMsg.includes('ואפשר')) {
    console.log('[IntentDetect] Follow-up detected:', msg);
    return 'follow_up';
  }
  
  // Default intent
  console.log('[IntentDetect] Default intent for:', msg);
  return 'default';
} 