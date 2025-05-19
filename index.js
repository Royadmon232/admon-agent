/*
============================
WhatsApp Home Insurance Bot (Node.js, OpenAI GPT)
============================

This file implements a WhatsApp Business bot for home insurance in Hebrew, using Node.js and OpenAI GPT-4/4o.

Step-by-step process:
1. Loads environment variables from .env (never hardcoded secrets).
2. Sets up an Express server to handle WhatsApp webhook verification and incoming messages.
3. Verifies the webhook with Meta/Facebook (GET /webhook).
4. Receives WhatsApp messages (POST /webhook), sends them to OpenAI, and replies to the sender.
5. All incoming and outgoing messages are printed to the console for debugging.

Meta/Facebook/WhatsApp setup required:
- You must configure a WhatsApp Business App in Meta for Developers (https://developers.facebook.com/).
- Set up a webhook URL in the WhatsApp App dashboard, and use the verify token you set in your .env as WHATSAPP_VERIFY_TOKEN.
- You need a WhatsApp Business Phone Number ID and an API token (see Meta's WhatsApp Cloud API docs).
- Outgoing messages require a pre-approved message template if you want to send messages outside the 24-hour window. For simple replies within 24 hours, no template is needed.
- More info: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/
*/

import express from "express";
import axios from "axios";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import stringSimilarity from "string-similarity";
import fs from "fs";
import { semanticLookup } from './agentController.js';

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY missing – running in knowledge-only mode');
}

const app = express();
app.use(express.static('public'));

app.use(cors());
app.use(bodyParser.json());

// Load all secrets from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// =============================
// SYSTEM_PROMPT: Simulate a Real Insurance Agent (Advanced)
// =============================
/*
This SYSTEM_PROMPT instructs GPT to fully simulate a real, trusted, and professional home insurance agent in Hebrew.
The agent should:
- Ask relevant and thoughtful clarifying questions about the client's home, needs, and concerns (such as address, apartment size, valuables, security features, etc.).
- Explain the different coverage options, benefits, and limitations in a clear, human, and personalized way.
- Always respond in fluent, natural Hebrew, with empathy, professionalism, and personal attention.
- Never give generic, robotic, or irrelevant answers; each reply should sound like it comes from a real expert.
- Offer to help with the full insurance process: from initial questions, through detailed explanation, to sending a personalized quote and follow-up.
- If the agent cannot answer, say that they will check and get back to the customer.

הסוכן צריך:
- לשאול שאלות הבהרה רלוונטיות (כתובת, שטח, תכולה, אמצעי מיגון וכו').
- להסביר הבדלים בין סוגי כיסויים, יתרונות ומגבלות, בצורה ברורה ואישית.
- לענות תמיד בעברית תקינה, בגובה העיניים, עם יחס אישי ואמפתי.
- להימנע לחלוטין מתשובות רובוטיות או כלליות.
- להציע ללוות את הלקוח לאורך כל התהליך, כולל הצעת מחיר מותאמת.
- אם אין לך תשובה – אמור שתבדוק ותחזור.
*/
const SYSTEM_PROMPT = `אתה סוכן ביטוח דירות מקצועי ומנוסה.\nענה תמיד בעברית תקינה, בגובה העיניים, ותן שירות אישי ואמפתי.\nשאל שאלות רלוונטיות (כתובת, שטח, תכולה, אמצעי מיגון), הסבר הבדלים בין סוגי כיסויים, ופשט מידע בצורה מובנת ללקוח.\nאם יש התלבטות, תרגיע ותסביר בביטחון.\nאם אין לך תשובה – אמור שתבדוק ותחזור.\nהימנע לחלוטין מתשובות רובוטיות או כלליות.`;

// =============================
// Conversation Memory (Contextual Chat)
// =============================
/*
This section implements a simple, user-specific conversation memory mechanism.
- For each WhatsApp user (by phone number), we store the last 5–10 message pairs (user and agent) in an in-memory object.
- For every new OpenAI request, we send the last few exchanges as part of the conversation history ("messages" array) so GPT can maintain context and answer more naturally and intelligently.
- This allows multiple users to chat in parallel without mixing up their conversations.
- All responses remain polite, professional, and in clear Hebrew, following the SYSTEM_PROMPT.

מנגנון זיכרון שיחה:
- לכל משתמש נשמרים 5–10 זוגות הודעות אחרונות (משתמש וסוכן) בזיכרון זמני (in-memory).
- בכל פנייה ל-GPT, נשלחות ההודעות האחרונות כדי לשמור על רצף שיחה טבעי.
- הזיכרון הוא פר משתמש (לפי מספר טלפון), כך שניתן לנהל שיחות מקבילות.
*/

// In-memory conversation history: { [userPhone: string]: Array<{role: 'user'|'assistant', content: string}> }
const conversationMemory = {};
const MEMORY_LIMIT = 10; // Number of message pairs to keep per user

// =============================
// Home Insurance Knowledge Base (RAG)
// =============================
/*
This section defines a small, structured knowledge base with relevant home insurance data (coverage definitions, exclusions, benefits, FAQs, etc.).
- The knowledge base is defined as an in-file array of objects (can be moved to a JSON file or database in the future).
- When a user asks a factual or specific question, the bot first tries to find a clear answer in the knowledge base before asking GPT (Retrieval-Augmented Generation, RAG).
- If a match is found, the answer is combined with GPT's conversational skills (passed as context to GPT).
- If not, GPT answers based on conversation history and SYSTEM_PROMPT.

בסיס ידע מובנה:
- מוגדר כמערך אובייקטים בקובץ (ניתן להרחיב לקובץ JSON או מסד נתונים בהמשך).
- אם המשתמש שואל שאלה עובדתית/ספציפית, תחילה נבדוק אם יש תשובה ברורה בבסיס הידע.
- אם נמצאה תשובה, נשלב אותה עם היכולות השיחיות של GPT (נעביר אותה כ-context).
- אם לא, GPT יענה כרגיל.
*/

const insuranceKnowledgeBase = JSON.parse(
  fs.readFileSync("./insurance_knowledge.json", "utf8"),
);
const KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa
  .filter((r) => Array.isArray(r.embedding))
  .map((r) => ({ q: r.question, a: r.answer, v: r.embedding }));

// =============================
// Dynamic Questionnaire & Needs Analysis
// =============================
/*
This section implements a dynamic questionnaire system for needs analysis.
- For each user, we track which key information (address, apartment size, valuables, etc.) has been collected in their session memory.
- The bot detects missing info and asks only the next relevant questions, not always the same script.
- Avoids repeating questions and personalizes the flow according to user answers.
- Each answer is stored in the user's session memory.

שאלון דינמי וניתוח צרכים:
- לכל משתמש ננסה לחלץ תשובות מההודעה לשדות הצרכים, ונשמור ב-userSessionData.
- אם חסר מידע, נשאל רק את השאלה הבאה הרלוונטית.
*/

// Define the key info fields for insurance needs analysis
const NEEDS_FIELDS = [
  { key: "address", question: "מהי כתובת הדירה שברצונך לבטח?" },
  { key: "apartmentSize", question: 'מהו גודל הדירה במ"ר?' },
  {
    key: "valuables",
    question:
      "האם יש ברשותך חפצים יקרי ערך (כגון תכשיטים, יצירות אמנות, ציוד יקר)?",
  },
  {
    key: "security",
    question:
      "האם קיימים אמצעי מיגון מיוחדים בדירה (אזעקה, מצלמות, דלתות ביטחון)?",
  },
  { key: "residents", question: "כמה דיירים מתגוררים בדירה?" },
];

// In-memory user session data: { [userPhone: string]: { [field]: value } }
const userSessionData = {};

// Helper: Check which info fields are missing for a user
function getNextMissingField(userId) {
  const session = userSessionData[userId] || {};
  for (const field of NEEDS_FIELDS) {
    if (!session[field.key]) {
      return field;
    }
  }
  return null;
}

// Helper: Try to extract answers from user message (simple keyword/value matching for demo)
function extractFieldValue(fieldKey, userMessage) {
  // This can be replaced with NLP or regex for more advanced extraction
  if (fieldKey === "address" && userMessage.match(/רחוב|כתובת|עיר|מספר/)) {
    return userMessage;
  }
  if (fieldKey === "apartmentSize" && userMessage.match(/\d+\s?מ"ר|גודל|שטח/)) {
    const match = userMessage.match(/(\d+)\s?מ"ר/);
    return match ? match[1] : userMessage;
  }
  if (
    fieldKey === "valuables" &&
    userMessage.match(/(כן|לא|תכשיט|יקר|אמנות|ציוד)/)
  ) {
    return userMessage;
  }
  if (
    fieldKey === "security" &&
    userMessage.match(/אזעקה|מצלמה|ביטחון|מיגון/)
  ) {
    return userMessage;
  }
  if (
    fieldKey === "residents" &&
    userMessage.match(/\d+\s?(דייר|אנשים|נפשות)/)
  ) {
    const match = userMessage.match(/(\d+)\s?(דייר|אנשים|נפשות)/);
    return match ? match[1] : userMessage;
  }
  return null;
}

// =============================
// Intelligent Offer Recommendation
// =============================
/*
After collecting all relevant details from the user, the bot uses a simple formula to recommend the most suitable home insurance coverage and quote.
- The recommendation logic can be replaced with an external API/calculator in the future.
- The bot explains to the user why this coverage is recommended, in a friendly and professional tone.
- Optionally, provides a summary as a message (PDF generation can be added later).

המלצה חכמה על הצעה:
- לאחר איסוף כל הפרטים, הבוט ממליץ על כיסוי מתאים ומחיר משוער לפי נוסחה פשוטה (או API חיצוני בעתיד).
- ההסבר ללקוח ברור, מקצועי ואישי.
- ניתן להוסיף בהמשך יצירת PDF.
*/

// Simple formula for demo: calculate quote based on apartment size, valuables, and security
function calculateInsuranceQuote(session) {
  let base = 1000; // base price in NIS
  if (session.apartmentSize) {
    const size = parseInt(session.apartmentSize, 10);
    if (!isNaN(size)) base += size * 10;
  }
  if (session.valuables && /כן|תכשיט|יקר|אמנות|ציוד/.test(session.valuables)) {
    base += 500;
  }
  if (session.security && /אזעקה|מצלמה|ביטחון|מיגון/.test(session.security)) {
    base -= 200;
  }
  return Math.max(base, 800); // minimum price
}

function buildRecommendationMessage(session, quote) {
  // Build a friendly, professional summary in Hebrew
  let summary = `בהתבסס על הפרטים שמסרת, אני ממליץ על כיסוי ביטוח דירה הכולל:
`;
  summary += `• כתובת: ${session.address || "לא צוינה"}
`;
  summary += `• גודל דירה: ${session.apartmentSize || "לא צוין"} מ"ר
`;
  summary += `• חפצים יקרי ערך: ${session.valuables || "לא צוינו"}
`;
  summary += `• אמצעי מיגון: ${session.security || "לא צוינו"}
`;
  summary += `• מספר דיירים: ${session.residents || "לא צוין"}
`;
  summary += `
הכיסוי המומלץ כולל הגנה מפני נזקי מים, גניבה, אש, צד ג' ועוד, בהתאמה אישית לצרכים שלך.
`;
  summary += `המחיר המשוער: כ-₪${quote} לשנה (המחיר עשוי להשתנות בהתאם לפרטים נוספים או הרחבות).
`;
  summary += `
אם תרצה לקבל הצעת מחיר מסודרת או לשוחח עם סוכן, אשמח לעזור!`;
  return summary;
}

// =============================
// Human Agent Escalation & Feedback
// =============================
/*
This section allows the user to request a human agent at any point.
- Detects messages like "I want to speak with a human" or "I need further help" (in Hebrew and English).
- When detected, provides contact details or a polite message about transferring to a human agent.
- After every completed conversation (after recommendation), asks the user for feedback about the bot and the insurance advice.

הסלמה לנציג אנושי ומשוב:
- המשתמש יכול לבקש לדבר עם נציג אנושי בכל שלב (הודעה כמו "אני רוצה לדבר עם נציג" או "אני צריך עזרה נוספת").
- במקרה כזה, תישלח הודעה עם פרטי יצירת קשר או הודעה מנומסת על העברת השיחה.
- לאחר כל שיחה שהושלמה (לאחר המלצה), תישלח בקשה למשוב מהמשתמש.
*/

// Keywords/phrases to detect human agent request (expand as needed)
const HUMAN_AGENT_KEYWORDS = [
  "נציג אנושי",
  "נציג",
  "סוכן אנושי",
  "סוכן",
  "אני רוצה לדבר עם נציג",
  "אני צריך עזרה נוספת",
  "I want to speak with a human",
  "human agent",
  "representative",
  "need further help",
  "talk to a person",
];

// Contact details for escalation (customize as needed)
const HUMAN_AGENT_CONTACT =
  "תוכל ליצור קשר עם סוכן אנושי בטלפון: 03-1234567 או במייל: agent@example.com";

// Helper: Detect if user wants a human agent
function isHumanAgentRequest(message) {
  const normalized = message.toLowerCase();
  return HUMAN_AGENT_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
}

// =============================
// Session and Data Privacy
// =============================
/*
This section ensures all user data (chat history, answers, quotes) is handled securely and in accordance with privacy laws (GDPR, Israeli regulations).
- Only relevant, minimal data is kept in memory for the session.
- If persistent storage is added, it should be encrypted and comply with privacy regulations.
- Users can request to delete all their data ("forget me" request), and the code structure supports this.

פרטיות נתונים ומחיקת מידע:
- נשמר רק מידע הכרחי, בזיכרון זמני.
- אם יתווסף אחסון קבוע, עליו להיות מוצפן ובהתאם לחוקי פרטיות.
- ניתן למחוק את כל נתוני המשתמש לפי בקשה ("שכח אותי").
*/

// Helper: Detect "forget me" requests (expand as needed)
const FORGET_ME_KEYWORDS = [
  "שכח אותי",
  "מחק את כל המידע",
  "delete my data",
  "forget me",
  "erase my data",
  "מחק אותי",
];
function isForgetMeRequest(message) {
  const normalized = message.toLowerCase();
  return FORGET_ME_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
}

const QUOTE_TRIGGERS = [
  "הצעת מחיר", "כמה עולה", "ביטוח דירה", "מבקש הצעת", "offer", "quote"
];

function isQuoteIntent(text) {
  const lowerText = text.toLowerCase(); // Normalize for case-insensitive matching
  return QUOTE_TRIGGERS.some(t => lowerText.includes(t.toLowerCase()));
}

// =============================
// Core Message Processing Logic
// =============================
async function processMessage(userMessageText, fromId, simulateMode = false) {
  let replyToSend = "";

  // Ensure conversationMemory and userSessionData for 'fromId' exist
  if (!conversationMemory[fromId]) {
    conversationMemory[fromId] = [{ role: "system", content: SYSTEM_PROMPT }];
  }
  if (!userSessionData[fromId]) {
    userSessionData[fromId] = {}; // .stage will be added here if quote intent is detected
  }

  // Path 1: Data Privacy - Handle "forget me" requests
  if (isForgetMeRequest(userMessageText)) {
    delete conversationMemory[fromId];
    delete userSessionData[fromId];
    replyToSend = "כל המידע שלך נמחק מהמערכת בהתאם לבקשתך. אם תרצה להתחיל שיחה חדשה, אשמח לעזור!";
    if (!simulateMode && WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend}`);
      await axios.post(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        { messaging_product: "whatsapp", to: fromId, text: { body: replyToSend } },
        { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
      );
    } else if (!simulateMode) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (WhatsApp send skipped due to missing config)`);
    }
    if (simulateMode) return replyToSend; else return;
  }

  // Path 2: Human Agent Escalation
  if (isHumanAgentRequest(userMessageText)) {
    replyToSend = `אני כאן כדי לעזור, אך כמובן שאפשר גם לדבר עם סוכן אנושי.\n${HUMAN_AGENT_CONTACT}`;
    conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
    if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
      conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
    }
    if (!simulateMode && WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend}`);
      await axios.post(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        { messaging_product: "whatsapp", to: fromId, text: { body: replyToSend } },
        { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
      );
    } else if (!simulateMode) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (WhatsApp send skipped due to missing config)`);
    }
    if (simulateMode) return replyToSend; else return;
  }

  // Common: Add user message to conversation memory (after early exits)
  conversationMemory[fromId].push({ role: "user", content: userMessageText });
  if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
    conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
  }

  // 0. Normalise user input
  const clean = userMessageText.trim();

  // Path 3: Primary RAG / Quote Intent Detection (if not already in questionnaire)
  // 1. if user is NOT already in quote flow --> try FAQ RAG first
  if (userSessionData[fromId].stage === undefined) { /* not in questionnaire */
    // 1a. semantic RAG
    let faqAnswer = await semanticLookup(clean);

    // 1b. lexical fallback
    if (!faqAnswer && stringSimilarity && insuranceKnowledgeBase.insurance_home_il_qa) {
      const qs = insuranceKnowledgeBase.insurance_home_il_qa.map(r => r.question);
      const { bestMatch } = stringSimilarity.findBestMatch(clean, qs);
      if (bestMatch.rating >= 0.75) {
        faqAnswer = insuranceKnowledgeBase.insurance_home_il_qa[bestMatch.bestMatchIndex].answer;
      }
    }

    // 1c. if found – send / return it immediately
    if (faqAnswer) {
      replyToSend = faqAnswer;
      conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
      if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
        conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
      }
      if (simulateMode) return replyToSend;

      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (from FAQ RAG)`);
      if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
        await axios.post(
          `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
          { messaging_product: "whatsapp", to: fromId, text: { body: replyToSend } },
          { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
        );
      } else {
        console.log("WhatsApp send skipped for FAQ RAG due to missing config");
      }
      return; // stop, don't start questionnaire
    }

    // 1d. if not FAQ but text shows quote intent → init questionnaire
    if (isQuoteIntent(clean)) {
      userSessionData[fromId].stage = 0; // start Q-flow
      // Fall through to questionnaire logic below
    }
    // If no FAQ and no quote intent, and stage is still undefined,
    // it will fall through to the OpenAI GPT call (Path 5, now Path 6).
  }

  // Path 4: Dynamic Questionnaire & Offer Recommendation (if in questionnaire flow)
  if (userSessionData[fromId].stage !== undefined) {
    // Try to extract answers from the current userMessageText
    for (const field of NEEDS_FIELDS) {
      if (!userSessionData[fromId][field.key]) {
        const value = extractFieldValue(field.key, userMessageText); // Use original userMessageText
        if (value) {
          userSessionData[fromId][field.key] = value;
          // If a value was extracted, we might have fulfilled the current question.
          // The nextField check below will determine if we need to ask another or recommend.
        }
      }
    }

    const nextField = getNextMissingField(fromId);
    if (nextField) {
      replyToSend = nextField.question;
      conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
      if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
        conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
      }
      if (simulateMode) return replyToSend;
      
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (Questionnaire)`);
      if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
        await axios.post(
          `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
          { messaging_product: "whatsapp", to: fromId, text: { body: replyToSend } },
          { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
        );
      } else {
        console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (Questionnaire - WhatsApp send skipped)`);
      }
      return; // Asked a question, stop processing
    }

    // If no nextField, all fields are filled. Proceed to recommendation.
    const quote = calculateInsuranceQuote(userSessionData[fromId]);
    const summary = buildRecommendationMessage(userSessionData[fromId], quote);
    replyToSend = summary;
    conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
    if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
      conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
    }
    
    // Consider resetting or managing stage: delete userSessionData[fromId].stage;
    // For now, if recommendation is given, further messages from this user will restart FAQ RAG.

    if (!simulateMode && WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (Recommendation)`);
      await axios.post(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        { messaging_product: "whatsapp", to: fromId, text: { body: replyToSend } },
        { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
      );
      const feedbackMsg = "אשמח לדעת מה דעתך על השירות שקיבלת מהבוט ועל ההמלצה לביטוח הדירה. האם יש משהו שנוכל לשפר?";
      // Also add feedbackMsg to conversation memory if desired
      console.log(`[OUTGOING] To: ${fromId} | Message: ${feedbackMsg} (Feedback Request)`);
      await axios.post(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        { messaging_product: "whatsapp", to: fromId, text: { body: feedbackMsg } },
        { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
      );
    } else if (!simulateMode) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (Recommendation - WhatsApp send skipped)`);
      if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
         console.log("Feedback message would also have been sent.");
      }
    }
    if (simulateMode) return replyToSend; // Simulation only returns primary summary
    else return; // Sent recommendation and feedback, stop processing
  }
  
  // Path 5: REMOVED - Original RAG logic (semanticLookup, lexical fallback)
  // This was:
  // let kbAnswer = await semanticLookup(userMessageText);
  // ... lexical fallback ...
  // if (kbAnswer) { /* send and return */ }
  // This is now handled by Path 3 if stage is undefined.

  // Path 6: OpenAI GPT call (if no other path handled the message)
  // This is reached if:
  // - Not in questionnaire flow (stage is undefined) AND
  // - FAQ RAG (Path 3a-3c) did NOT find an answer AND
  // - Quote intent (Path 3d) was NOT detected.
  try {
    const openaiRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o", // Ensure this model is appropriate and available
        messages: conversationMemory[fromId], // Send full history including system prompt
        max_tokens: 300,
        temperature: 0.7,
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
    );
    const gptReplyContent = openaiRes.data.choices?.[0]?.message?.content?.trim();
    if (gptReplyContent) {
      replyToSend = gptReplyContent;
      conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
      if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
        conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
      }
    } else {
      replyToSend = "מצטער, לא הצלחתי לעבד את בקשתך כרגע. נסה שוב מאוחר יותר."; // Default error
       conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
       if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
        conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
      }
    }
  } catch (error) {
    console.error("Error calling OpenAI:", error?.response?.data || error.message);
    replyToSend = "אני מתנצל, נתקלתי בשגיאה בעת עיבוד בקשתך מול שירות הבינה המלאכותית. אנא נסה שוב בעוד מספר רגעים.";
    // Log this error reply to conversation memory as well
    conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
    if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
      conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
    }
  }
  
  if (!simulateMode && replyToSend && WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend}`);
    await axios.post(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to: fromId, text: { body: replyToSend } },
      { headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" } }
    );
  } else if (!simulateMode && replyToSend) {
    console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (WhatsApp send skipped due to missing config)`);
  }

  // When called in "simulate" mode, just return the reply string
  if (simulateMode) {
    return replyToSend;
  }
  // If not in simulate mode, function has already sent the message or logged. No explicit return needed.
}

// =============================
// 1. WhatsApp Webhook Verification (GET /webhook)
// =============================
// Meta/Facebook will call this endpoint when you set up your webhook in the WhatsApp App dashboard.
// You must provide the same verify token (WHATSAPP_VERIFY_TOKEN) in both Meta and your .env file.
app.get("/webhook", (req, res) => {
  const verify_token = WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// =============================
// Local Web Chat Simulator Endpoint
// =============================
// Helper function for lexical matching
async function lexicalLookup(text) {
  if (!stringSimilarity || !insuranceKnowledgeBase.insurance_home_il_qa) return null;
  
  try {
    const qs = insuranceKnowledgeBase.insurance_home_il_qa.map(r => r.question);
    const { bestMatch } = stringSimilarity.findBestMatch(text, qs);
    if (bestMatch.rating >= 0.75) {
      return insuranceKnowledgeBase.insurance_home_il_qa[bestMatch.bestMatchIndex].answer;
    }
  } catch (e) {
    console.error('Lexical lookup failed:', e.message);
  }
  return null;
}

app.post('/simulate', async (req, res) => {
  try {
    const text = req.body?.text?.trim();
    if (!text) return res.status(400).send('empty_message'); // Send string

    let answer = await semanticLookup(text);
    if (!answer) {
      // Ensure lexicalLookup is the one defined in this file, or ensure agentController.lexicalFallback is used if intended
      // Assuming lexicalLookup is the local one based on context:
      answer = await lexicalLookup(text); 
    }

    if (answer) {
      res.send(answer); // Send the answer string directly
    } else {
      // Send a user-friendly message if no answer is found.
      res.send('לא מצאתי תשובה מתאימה לשאלתך. נסה לנסח מחדש או לשאול שאלה אחרת.'); 
    }
  } catch (e) {
    console.error('Unhandled /simulate error:', e);
    // Send a user-friendly error message as a string.
    res.status(500).send('אירעה שגיאה פנימית בעיבוד הבקשה. אנא נסה שוב בעוד מספר רגעים.');
  }
});

// =============================
// 2. WhatsApp Message Handler (POST /webhook)
// =============================
// Meta/Facebook will POST incoming WhatsApp messages to this endpoint.
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages)) {
      // Not an error, could be other webhook events. Respond 200 OK.
      return res.sendStatus(200);
    }

    for (const message of messages) {
      const from = message.from; // WhatsApp user phone number
      const userMessageContent = message.text?.body; // Incoming text

      if (!userMessageContent || !from) {
        // console.log("Skipping message without content or sender.");
        continue;
      }
      console.log(`[INCOMING] From: ${from} | Message: ${userMessageContent}`);
      
      // Call the refactored processing logic
      // The processMessage function now handles sending the reply or returning it for simulation
      await processMessage(userMessageContent, from, false); 
    }
    res.sendStatus(200);
  } catch (error) {
    console.error(
      "Error handling webhook:",
      error?.response?.data || error.message,
    );
    res.sendStatus(500); // Send 500 for unhandled errors in the webhook processor
  }
});

// =============================
// 5. Start the Express server
// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
