import fs from 'fs/promises';
import axios from 'axios';
import { lookupRelevantQAs } from './services/vectorSearch.js';
import { recall, remember, updateCustomer } from "./services/memoryService.js";
import { buildSalesResponse, intentDetect } from "./services/salesTemplates.js";
import { smartAnswer } from "./services/ragChain.js";
import { startHouseQuoteFlow } from "./houseQuoteFlow.js";

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
  let contextBlock = matches.map(m => `שאלה: ${m.question}\nתשובה: ${m.answer}`).join('\n\n');
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
      matches.map(m => ({ q: m.question.slice(0,40)+'…', score: m.score.toFixed(2) })));
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
    // Check for quote request at the very top
    const quotePatterns = [
      /אני רוצה הצעת מחיר/i,
      /מעוניין בביטוח דירה/i,
      /שלח לי טופס ביטוח/i,
      /רוצה לבטח את הדירה/i,
      /כמה עולה ביטוח דירה/i,
      /הצעת מחיר/i,
      /כמה עולה/i,
      /מחיר.*ביטוח/i,
      /ביטוח.*מחיר/i,
      /רוצה.*הצעה/i,
      /מעוניין.*הצעה/i,
      /מה המחיר/i,
      /כמה זה עולה/i,
      /רוצה לבטח/i,
      /מעוניין בביטוח/i
    ];
    
    const isQuoteRequest = quotePatterns.some(pattern => pattern.test(userMsg));
    if (isQuoteRequest) {
      console.info("[Quote Flow] Quote request detected, starting quote flow");
      return await startHouseQuoteFlow(phone, userMsg);
    }

    // Extract name if present
    if (/^(?:אני|שמי)\s+([^\s]+)/i.test(userMsg)) {
      const name = RegExp.$1;
      await updateCustomer(phone, { first_name: name });
    }

    // Get memory and detect intent
    const memory = await recall(phone);
    console.info("[Memory Loaded]:", memory);
    
    // Check if user is already in quote flow
    if (memory.quoteStage && memory.quoteStage !== 'stage1_completed') {
      console.info("[Quote Flow] User is in quote flow, routing to quote handler");
      const quoteResponse = await startHouseQuoteFlow(phone, userMsg);
      return quoteResponse;
    }
    
    // Check for quote confirmation flow
    const isConfirmation = detectConfirmation(userMsg);
    
    // Handle quote confirmation flow
    if (memory.awaitingQuoteConfirmation && isConfirmation) {
      // User confirmed, clear the flag and start quote form
      await remember(phone, 'awaitingQuoteConfirmation', null);
      await remember(phone, 'quoteStage', 'id_number'); // Initialize quote flow
      
      const confirmationReply = "✅ *מעולה!*\n\nבואו נתחיל בתהליך הצעת המחיר. אני אשאל אותך כמה שאלות קצרות כדי להכין עבורך הצעה מותאמת אישית.\n\n🚀 *מתחילים עכשיו...*";
      await sendWhatsAppMessage(phone, confirmationReply);
      
      // Start the house quote flow
      const quoteResponse = await startHouseQuoteFlow(phone, "");
      
      return confirmationReply;
    }
    
    if (isQuoteRequest && !memory.awaitingQuoteConfirmation) {
      // User wants a quote but hasn't confirmed yet
      await remember(phone, 'awaitingQuoteConfirmation', true);
      
      const confirmationMsg = "האם אתה מאשר להתחיל תהליך של הצעת מחיר לביטוח דירה?";
      
      // Send message with quick reply button
      await sendWhatsAppMessageWithButton(phone, confirmationMsg, "אני מאשר", "CONFIRM_START_QUOTE");
      return confirmationMsg;
    }
    
    const intent = intentDetect(userMsg);
    console.info("[Intent Detected]:", intent);
    
    // Get response from RAG or sales
    const ragAns = await smartAnswer(userMsg, memory) || await semanticLookup(userMsg, memory);
    console.info("[LangChain RAG used]:", !!ragAns);
    let reply = ragAns;
    if (!ragAns) {
      if (intent === 'lead_gen') reply = buildSalesResponse('lead_gen', memory);
      else if (intent === 'price_pushback') reply = buildSalesResponse('objection', memory);
      else if (intent === 'close') reply = buildSalesResponse('close', memory);
      else reply = buildSalesResponse('default', memory);
      console.info("[Sales fallback triggered]:", reply);
    }

    // Remember the message
    await remember(phone, 'lastMsg', userMsg);
    console.info("[Memory Updated] lastMsg saved:", userMsg);

    // Send response via WhatsApp
    await sendWhatsAppMessage(phone, reply);
    
    return reply;
  } catch (error) {
    console.error("Error handling message:", error);
    const errorMsg = "מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.";
    await sendWhatsAppMessage(phone, errorMsg);
    return errorMsg;
  }
}

// Helper function to detect quote intent
function detectQuoteIntent(userMsg) {
  const quotePatterns = [
    /אני רוצה הצעת מחיר/i,
    /כמה עולה ביטוח דירה/i,
    /מעוניין לבטח את הדירה/i,
    /טופס ביטוח/i,
    /הצעת מחיר/i,
    /כמה עולה/i,
    /מחיר.*ביטוח/i,
    /ביטוח.*מחיר/i,
    /רוצה.*הצעה/i,
    /מעוניין.*הצעה/i,
    /מה המחיר/i,
    /כמה זה עולה/i,
    /רוצה לבטח/i,
    /מעוניין בביטוח/i
  ];
  
  return quotePatterns.some(pattern => pattern.test(userMsg));
}

// Helper function to detect confirmation
function detectConfirmation(userMsg) {
  const confirmationPatterns = [
    /אני מאשר/i,
    /מאשר/i,
    /כן/i,
    /בסדר/i,
    /אוקיי/i,
    /ok/i,
    /בואו נתחיל/i,
    /אני מוכן/i,
    /נעשה את זה/i,
    /CONFIRM_START_QUOTE/i
  ];
  
  return confirmationPatterns.some(pattern => pattern.test(userMsg));
}

// WhatsApp message sending function
export async function sendWhatsAppMessage(to, message) {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error("❌ WhatsApp API configuration missing");
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { 
        messaging_product: "whatsapp", 
        to: to, 
        text: { body: message } 
      },
      { 
        headers: { 
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`, 
          "Content-Type": "application/json" 
        } 
      }
    );
  } catch (error) {
    console.error("Error sending WhatsApp message:", error.response?.data || error.message);
    throw error;
  }
}

// WhatsApp message sending function with quick reply button
export async function sendWhatsAppMessageWithButton(to, message, buttonTitle, buttonPayload) {
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
        type: "button",
        body: {
          text: message
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: buttonPayload,
                title: buttonTitle
              }
            }
          ]
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
    
    console.log(`✅ Sent WhatsApp message with button to ${to}`);
  } catch (error) {
    console.error("Error sending WhatsApp message with button:", error.response?.data || error.message);
    // Fallback to regular message if button fails
    console.log("🔄 Falling back to regular message...");
    await sendWhatsAppMessage(to, `${message}\n\n[${buttonTitle}]`);
  }
}

