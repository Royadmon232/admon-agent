import fs from 'fs/promises';
import axios from 'axios';
import { lookupRelevantQAs } from './services/vectorSearch.js';
import { recall, remember, updateCustomer } from "./services/memoryService.js";
import { buildSalesResponse, intentDetect } from "./services/salesTemplates.js";
import { smartAnswer } from "./services/ragChain.js";
import { sendWapp } from './services/twilioService.js';

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.78;
const PRIMARY_MODEL = 'text-embedding-3-small';
const FALLBACK_MODEL = 'text-embedding-ada-002';

// Load knowledge base once at startup
let KNOWLEDGE = [];
try {
  const knowledgePath = new URL('./insurance_knowledge.json', import.meta.url);
  const rawData = await fs.readFile(knowledgePath, 'utf8');
  const insuranceKnowledgeBase = JSON.parse(rawData);
  KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa;
  console.log(`✅ Loaded ${KNOWLEDGE.length} knowledge base entries`);
} catch (e) {
  console.error('⚠️  Failed to load knowledge base:', e.message);
  KNOWLEDGE = [];
}

// GPT-4o based semantic question answering
export async function semanticLookup(userMsg, memory = {}) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OpenAI API key not found in environment variables");
    return "מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.";
  }

  // RAG BEGIN before building messages:
  const matches = await lookupRelevantQAs(userMsg, 8, 0.60);
  let contextBlock = matches
    .filter(m => m && m.question && m.answer)  // Filter out null or incomplete matches
    .map(m => `שאלה: ${m.question}\nתשובה: ${m.answer}`)
    .join('\n\n');
  if (contextBlock.length / 4 > 1500) { contextBlock = contextBlock.slice(0, 6000); }
  const baseSystemPrompt = `אתה דוני, סוכן ביטוח דירות וירטואלי. דבר בעברית בגוף ראשון. אתה סוכן ביטוח דירות מקצועי ואדיב. תפקידך לענות על שאלות בנושא ביטוח דירה בצורה מקצועית, ידידותית ומקיפה.

\nכל תשובה שלך חייבת:
  1. להיות בעברית תקינה ומקצועית
  2. להיות מנוסחת בצורה ידידותית, מכבדת ובטון אישי ונעים
  3. להתייחס ישירות לשאלה שנשאלה
  4. לכלול את כל המידע הרלוונטי והחשוב
  5. להיות מדויקת מבחינה מקצועית
  
\nיש לך גישה לרשימת שאלות ותשובות שכיחות. עליך:
  1. להשתמש בתשובה המתאימה ביותר מהרשימה כבסיס לתשובה שלך, אך לנסח אותה מחדש בסגנון אישי וייחודי משלך, שתרגיש אותנטית וטבעית ללקוח
  2. אם אין תשובה מתאימה ברשימה, עליך לענות בעצמך בצורה מקצועית, עניינית ואישית
  3. לוודא שהתשובה שלמה, מכסה את כל ההיבטים החשובים של השאלה, ומשדרת ביטחון ומקצועיות ללקוח

אם אין לך מידע מספיק או שאתה לא בטוח בתשובה, אמור זאת בכנות ובידידותיות, והצע ללקוח לבדוק את העניין יחד איתך.`;

  const systemPrompt = matches.length
     ? `${baseSystemPrompt}\n\n${contextBlock}`
     : baseSystemPrompt;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMsg }
  ];
  // RAG END

  // RAG-TRACE BEGIN
  if (matches.length) {
    console.log('[RAG] top matches:',
      matches
        .filter(m => m && m.question)  // Filter out null or incomplete matches
        .map(m => ({ q: m.question.slice(0,40)+'…', score: m.score.toFixed(2) })));
  } else {
    console.log('[RAG] no KB match → fallback');
  }
  // RAG-TRACE END

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: messages,
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const answer = response.data.choices[0].message.content.trim();
    console.log("GPT-4o response:", answer);
    return answer;
  } catch (error) {
    console.error("Error calling GPT-4o:", error.response?.data || error.message);
    return "מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.";
  }
}

// Main message handler
export async function handleMessage(phone, userMsg) {
  try {
    console.info(`[DEBUG] Processing message: "${userMsg}" from ${phone}`);
    
    // Normalize user message for better pattern matching
    const normalizedMsg = userMsg.trim();
    
    // Get memory state
    const memory = await recall(phone);
    
    // Extract name if present
    if (/^(?:אני|שמי)\s+([^\s]+)/i.test(normalizedMsg)) {
      const name = RegExp.$1;
      await updateCustomer(phone, { first_name: name });
    }
    
    // Ensure RAG + GPT flow remains intact
    const intent = intentDetect(normalizedMsg);
    console.info("[Intent Detected]:", intent);

    // Get response from RAG or sales
    const answer =
      await smartAnswer(normalizedMsg, memory)
      || await semanticLookup(normalizedMsg, memory)
      || await buildSalesResponse(normalizedMsg, memory);
    
    // Remember the message
    await remember(phone, 'lastMsg', normalizedMsg);
    console.info("[Memory Updated] lastMsg saved:", normalizedMsg);

    return answer;
  } catch (error) {
    console.error("Error handling message:", error);
    const errorMsg = "מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.";
    return errorMsg;
  }
}

// WhatsApp message sending function
export async function sendWhatsAppMessage(to, message) {
  try {
    const result = await sendWapp(to, message);
    if (!result.success) {
      console.error("Error sending WhatsApp message:", result.error);
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    throw error;
  }
}

// WhatsApp message sending function with quick reply button
export async function sendWhatsAppMessageWithButton(to, message, buttonTitle, buttonPayload) {
  try {
    // Format message with button as text since Twilio doesn't support interactive buttons
    const formattedMessage = `${message}\n\n[${buttonTitle}]`;
    const result = await sendWapp(to, formattedMessage);
    
    if (result.success) {
      console.log(`✅ Sent WhatsApp message with button to ${to}`);
    } else {
      console.error("Error sending WhatsApp message with button:", result.error);
      // Fallback to regular message
      console.log("🔄 Falling back to regular message...");
      await sendWapp(to, `${message}\n\n[${buttonTitle}]`);
    }
  } catch (error) {
    console.error("Error sending WhatsApp message with button:", error);
    // Fallback to regular message
    console.log("🔄 Falling back to regular message...");
    await sendWapp(to, `${message}\n\n[${buttonTitle}]`);
  }
}

