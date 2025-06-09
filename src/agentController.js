import fs from 'fs/promises';
import axios from 'axios';
import { lookupRelevantQAs } from '../services/vectorSearch.js';
import { getHistory, appendExchange, updateCustomer, extractCustomerInfo } from "../services/memoryService.js";
import { buildSalesResponse, intentDetect } from "../services/salesTemplates.js";
import { smartAnswer } from "../services/ragChain.js";
import { sendWapp } from '../services/twilioService.js';
import { setTimeout } from 'timers/promises';

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.78;
const PRIMARY_MODEL = 'text-embedding-3-small';
const FALLBACK_MODEL = 'text-embedding-ada-002';

// Timeout constants
const OPENAI_TIMEOUT = 20000; // 20 seconds for OpenAI calls
const RAG_TIMEOUT = 10000;    // 10 seconds for RAG operations
const DB_TIMEOUT = 10000;     // 10 seconds for database operations

// Load knowledge base once at startup
let KNOWLEDGE = [];
try {
  const knowledgePath = new URL('../insurance_knowledge.json', import.meta.url);
  const rawData = await fs.readFile(knowledgePath, 'utf8');
  const insuranceKnowledgeBase = JSON.parse(rawData);
  KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa;
  console.log(`✅ Loaded ${KNOWLEDGE.length} knowledge base entries`);
} catch (e) {
  console.error('⚠️  Failed to load knowledge base:', e.message);
  KNOWLEDGE = [];
}

// GPT-4o based semantic question answering with timeout
export async function semanticLookup(userMsg, memory = {}) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OpenAI API key not found in environment variables");
    return "מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.";
  }

  try {
    // RAG BEGIN before building messages:
    const matches = await Promise.race([
      lookupRelevantQAs(userMsg, 8, 0.60),
      setTimeout(RAG_TIMEOUT).then(() => {
        console.warn('[semanticLookup] RAG lookup timeout');
        return [];
      })
    ]);

    const preview = matches ? matches.slice(0, 50) : "";
    if (!matches) console.warn("[semanticLookup] No FAQ match found");
    let contextBlock = matches
      .filter(m => m.question != null && m.answer != null)
      .map(m => `שאלה: ${m.question}\nתשובה: ${m.answer}`)
      .join('\n\n');
    if (contextBlock.length / 4 > 1500) { contextBlock = contextBlock.slice(0, 6000); }
    const baseSystemPrompt = `אתה דוני, סוכן ביטוח דירות וירטואלי. דבר בעברית בגוף ראשון. אתה סוכן ביטוח דירות מקצועי, אדיב ומוכוון מכירות. תפקידך לענות על שאלות בנושא ביטוח דירה בצורה מקצועית, ידידותית ומקיפה, תוך שמירה על טון מכירתי ומעודד פעולה.

\nכל תשובה שלך חייבת:
  1. להיות בעברית תקינה ומקצועית
  2. להיות מנוסחת בצורה ידידותית, מכבדת ובטון אישי ונעים
  3. להתייחס ישירות לשאלה שנשאלה
  4. לכלול את כל המידע הרלוונטי והחשוב
  5. להיות מדויקת מבחינה מקצועית
  6. לכלול קריאה לפעולה (CTA) מתאימה בסוף התשובה
  7. להדגיש את הערך והיתרונות של ביטוח דירה
  
\nיש לך גישה לרשימת שאלות ותשובות שכיחות. עליך:
  1. להשתמש בתשובה המתאימה ביותר מהרשימה כבסיס לתשובה שלך, אך לנסח אותה מחדש בסגנון אישי וייחודי משלך, שתרגיש אותנטית וטבעית ללקוח
  2. אם אין תשובה מתאימה ברשימה, עליך לענות בעצמך בצורה מקצועית, עניינית ואישית
  3. לוודא שהתשובה שלמה, מכסה את כל ההיבטים החשובים של השאלה, ומשדרת ביטחון ומקצועיות ללקוח
  4. להוסיף בסוף כל תשובה קריאה לפעולה מתאימה (למשל: "אשמח להכין עבורך הצעת מחיר מותאמת אישית", "בואו נבדוק יחד את האפשרויות המתאימות לך", וכו')

אם אין לך מידע מספיק או שאתה לא בטוח בתשובה, אמור זאת בכנות ובידידותיות, והצע ללקוח לבדוק את העניין יחד איתך. תמיד נסה להפוך כל אינטראקציה להזדמנות מכירה, תוך שמירה על מקצועיות ואמינות.`;

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
          .filter(m => m.question != null) // Filter out entries with null questions
          .map(m => ({ q: m.question.slice(0,40)+'…', score: m.score.toFixed(2) })));
    } else {
      console.log('[RAG] no KB match → fallback');
    }
    // RAG-TRACE END

    // Call OpenAI with timeout
    const response = await Promise.race([
      axios.post(
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
          },
          timeout: OPENAI_TIMEOUT // Set axios timeout
        }
      ),
      setTimeout(OPENAI_TIMEOUT).then(() => {
        throw new Error('OpenAI API timeout');
      })
    ]);

    const answer = response.data.choices[0].message.content.trim();
    console.log("GPT-4o response:", answer);
    return answer;
  } catch (error) {
    if (error.message === 'OpenAI API timeout') {
      console.error("[semanticLookup] OpenAI API timeout");
      // Don't return fallback immediately, let the caller handle it
      throw error;
    }
    console.error("Error calling GPT-4o:", error.response?.data || error.message);
    throw error;
  }
}

// Main message handler with improved error handling and timeouts
export async function handleMessage(phone, userMsg) {
  try {
    console.info(`[DEBUG] Processing message: "${userMsg}" from ${phone}`);
    
    // Normalize user message for better pattern matching
    const normalizedMsg = userMsg.trim();
    
    // Get conversation history and customer info with timeout
    const { history, customer } = await Promise.race([
      getHistory(phone),
      setTimeout(DB_TIMEOUT).then(() => {
        console.warn('[handleMessage] History retrieval timeout');
        return { history: [], customer: {} };
      })
    ]);
    
    // Extract and update customer info if present
    const customerInfo = extractCustomerInfo(normalizedMsg);
    if (customerInfo) {
      await Promise.race([
        updateCustomer(phone, customerInfo),
        setTimeout(DB_TIMEOUT).then(() => {
          console.warn('[handleMessage] Customer update timeout');
        })
      ]);
    }
    
    // Detect intent from the current message
    const intent = intentDetect(normalizedMsg);
    console.info("[Intent Detected]:", intent);

    // Handle greeting intent directly without RAG or marketing flow
    if (intent === 'greeting') {
      const greetingResponse = buildSalesResponse(intent, { ...customer, history: [] });
      
      // Append exchange to conversation history with timeout
      await Promise.race([
        appendExchange(phone, normalizedMsg, greetingResponse, {
          intent,
          timestamp: new Date().toISOString()
        }),
        setTimeout(DB_TIMEOUT).then(() => {
          console.warn('[handleMessage] History append timeout');
        })
      ]);
      
      return greetingResponse;
    }

    // Build context from history
    const context = history.map(exchange => ({
      user: exchange.user,
      bot: exchange.bot,
      timestamp: exchange.timestamp
    }));

    // Get base response from RAG or sales with timeout
    let baseResponse = '';
    try {
      if (intent === 'close') {
        // For closing intent, prioritize sales response
        baseResponse = await Promise.race([
          buildSalesResponse(intent, { ...customer, history: context }),
          setTimeout(RAG_TIMEOUT).then(() => {
            console.warn('[handleMessage] Sales response timeout');
            return null;
          })
        ]);
      } else {
        // For other intents, try RAG first
        try {
          baseResponse = await Promise.race([
            smartAnswer(normalizedMsg, context) ||
            semanticLookup(normalizedMsg, { ...customer, history: context }),
            setTimeout(RAG_TIMEOUT).then(() => {
              console.warn('[handleMessage] RAG response timeout');
              return null;
            })
          ]);
        } catch (error) {
          console.error('[handleMessage] RAG error:', error);
          // Try direct GPT response as fallback
          try {
            const gptResponse = await Promise.race([
              axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                  model: "gpt-4o",
                  messages: [
                    {
                      role: "system",
                      content: `אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי. דבר בעברית בגוף ראשון.
היסטוריית השיחה:
${context.map(exchange => `User: ${exchange.user}\nBot: ${exchange.bot}`).join('\n')}

השתמש בסגנון שיווקי-ייעוצי:
- הדגש את היתרונות והכיסויים האופציונליים
- השתמש בשפה משכנעת אך מקצועית
- הצג את עצמך כמומחה בתחום ביטוח הדירות
- השתמש בשפה אישית ונעימה
- הדגש את הערך והביטחון שהלקוח מקבל
- הימנע מחזרה על מידע שכבר נאמר בשיחה
- אל תציג את עצמך כבוט או AI - אתה סוכן ביטוח אמיתי`
                    },
                    { role: "user", content: normalizedMsg }
                  ],
                  temperature: 0.7,
                  max_tokens: 500
                },
                {
                  headers: {
                    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json"
                  },
                  timeout: OPENAI_TIMEOUT
                }
              ),
              setTimeout(OPENAI_TIMEOUT).then(() => {
                throw new Error('OpenAI API timeout');
              })
            ]);
            baseResponse = gptResponse.data.choices[0].message.content.trim();
          } catch (gptError) {
            console.error('[handleMessage] GPT fallback error:', gptError);
            baseResponse = null;
          }
        }
      }
    } catch (error) {
      console.error('[handleMessage] Error getting base response:', error);
      baseResponse = null;
    }

    // If no base response after all attempts, use sales template as last resort
    if (!baseResponse) {
      try {
        baseResponse = await Promise.race([
          buildSalesResponse(intent, { ...customer, history: context }),
          setTimeout(RAG_TIMEOUT).then(() => {
            console.warn('[handleMessage] Fallback sales response timeout');
            return "מצטער, המערכת עמוסה כרגע. אנא נסה שוב בעוד מספר דקות.";
          })
        ]);
      } catch (error) {
        console.error('[handleMessage] Fallback error:', error);
        baseResponse = "מצטער, המערכת עמוסה כרגע. אנא נסה שוב בעוד מספר דקות.";
      }
    }

    // Add sales template based on intent if not already a sales response
    let finalResponse = baseResponse;
    if (intent !== 'close' && !baseResponse.includes('לחצו כאן') && !baseResponse.includes('בואו נקבע')) {
      const salesTemplate = await Promise.race([
        buildSalesResponse(intent, { ...customer, history: context }),
        setTimeout(RAG_TIMEOUT).then(() => {
          console.warn('[handleMessage] Sales template timeout');
          return null;
        })
      ]);
      if (salesTemplate) {
        finalResponse = `${baseResponse}\n\n${salesTemplate}`;
      }
    }

    // Log the response construction
    console.info("[Response Construction]:", {
      intent,
      hasBaseResponse: !!baseResponse,
      hasSalesTemplate: finalResponse !== baseResponse,
      responseLength: finalResponse.length
    });
    
    // Append exchange to conversation history with timeout
    await Promise.race([
      appendExchange(phone, normalizedMsg, finalResponse, {
        intent,
        timestamp: new Date().toISOString()
      }),
      setTimeout(DB_TIMEOUT).then(() => {
        console.warn('[handleMessage] History append timeout');
      })
    ]);
    
    return finalResponse;
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

