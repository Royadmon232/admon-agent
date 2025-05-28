import 'dotenv/config';  // ensures DATABASE_URL loaded
import "./vectorIndexer.js";
import { runMetadataMigration } from './utils/dbUtils.js';
import { initializeChain } from './services/ragChain.js';

/*
============================
WhatsApp Home Insurance Bot (Node.js)
============================

This file implements a WhatsApp Business bot for home insurance in Hebrew, using Node.js.

Step-by-step process:
1. Loads environment variables from .env (never hardcoded secrets).
2. Sets up an Express server to handle WhatsApp webhook verification and incoming messages.
3. Verifies the webhook with Meta/Facebook (GET /webhook).
4. Receives WhatsApp messages (POST /webhook), processes them through agentController.js, and replies to the sender.
5. All incoming and outgoing messages are printed to the console for debugging.

Meta/Facebook/WhatsApp setup required:
- You must configure a WhatsApp Business App in Meta for Developers (https://developers.facebook.com/).
- Set up a webhook URL in the WhatsApp App dashboard, and use the verify token you set in your .env as WHATSAPP_VERIFY_TOKEN.
- You need a WhatsApp Business Phone Number ID and an API token (see Meta's WhatsApp Cloud API docs).
- Outgoing messages require a pre-approved message template if you want to send messages outside the 24-hour window. For simple replies within 24 hours, no template is needed.
- More info: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/
*/

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";
import { handleMessage, sendWhatsAppMessage } from './agentController.js';
import { sendWapp, smsFallback } from "./services/twilioService.js";

const app = express();
app.use(express.static('public'));
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Load all secrets from environment variables
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// =============================
// SYSTEM_PROMPT: Simulate a Real Insurance Agent (Advanced)
// =============================
const SYSTEM_PROMPT = `אתה סוכן ביטוח דירות מקצועי ומנוסה.\nענה תמיד בעברית תקינה, בגובה העיניים, ותן שירות אישי ואמפתי.\nשאל שאלות רלוונטיות (כתובת, שטח, תכולה, אמצעי מיגון), הסבר הבדלים בין סוגי כיסויים, ופשט מידע בצורה מובנת ללקוח.\nאם יש התלבטות, תרגיע ותסביר בביטחון.\nאם אין לך תשובה – אמור שתבדוק ותחזור.\nהימנע לחלוטין מתשובות רובוטיות או כלליות.`;

// =============================
// Conversation Memory (Contextual Chat)
// =============================
const conversationMemory = {};
const MEMORY_LIMIT = 10; // Number of message pairs to keep per user

// =============================
// Home Insurance Knowledge Base (RAG)
// =============================
const insuranceKnowledgeBase = JSON.parse(
  fs.readFileSync("./insurance_knowledge.json", "utf8"),
);
const KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa
  .filter((r) => Array.isArray(r.embedding))
  .map((r) => ({ q: r.question, a: r.answer, v: r.embedding }));

// =============================
// Dynamic Questionnaire & Needs Analysis
// =============================
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

// Helper: Try to extract answers from user message
function extractFieldValue(fieldKey, userMessage) {
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
  let summary = `תבסס על הפרטים שמסרת, אני ממליץ על כיסוי ביטוח דירה הכולל:
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

const HUMAN_AGENT_CONTACT =
  "תוכל ליצור קשר עם סוכן אנושי בטלפון: 03-1234567 או במייל: agent@example.com";

function isHumanAgentRequest(message) {
  const lowerMessage = message.toLowerCase();
  return HUMAN_AGENT_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword.toLowerCase()),
  );
}

// =============================
// Session and Data Privacy
// =============================
const FORGET_ME_KEYWORDS = [
  "שכח אותי",
  "מחק את כל המידע",
  "delete my data",
  "forget me",
  "erase my data",
  "מחק אותי",
];

function isForgetMeRequest(message) {
  const lowerMessage = message.toLowerCase();
  return FORGET_ME_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword.toLowerCase()),
  );
}

const QUOTE_TRIGGERS = [
  "הצעת מחיר", "כמה עולה", "ביטוח דירה", "מבקש הצעת", "offer", "quote"
];

function isQuoteIntent(text) {
  const lowerText = text.toLowerCase();
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
    userSessionData[fromId] = {};
  }

  // Path 1: Data Privacy - Handle "forget me" requests
  if (isForgetMeRequest(userMessageText)) {
    delete conversationMemory[fromId];
    delete userSessionData[fromId];
    replyToSend = "כל המידע שלך נמחק מהמערכת בהתאם לבקשתך. אם תרצה להתחיל שיחה חדשה, אשמח לעזור!";
    if (!simulateMode) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend}`);
      await sendWhatsAppMessage(fromId, replyToSend);
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
    if (!simulateMode) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend}`);
      await sendWhatsAppMessage(fromId, replyToSend);
    }
    if (simulateMode) return replyToSend; else return;
  }

  // Common: Add user message to conversation memory
  conversationMemory[fromId].push({ role: "user", content: userMessageText });
  if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
    conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
  }

  // 0. Normalise user input
  const clean = userMessageText.trim();

  // Path 3: Primary RAG / Quote Intent Detection
  if (userSessionData[fromId].stage === undefined) {
    // Try FAQ RAG first
    let faqAnswer = await handleMessage(clean);

    if (faqAnswer) {
      replyToSend = faqAnswer;
      conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
      if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
        conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
      }
      if (simulateMode) return replyToSend;

      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (from FAQ)`);
      if (!simulateMode) {
        await sendWhatsAppMessage(fromId, replyToSend);
      }
      return;   // stop here – avoid fallback duplicates
    }

    // If not FAQ but text shows quote intent → init questionnaire
    if (isQuoteIntent(clean)) {
      userSessionData[fromId].stage = 0;
    }
  }

  // Path 4: Dynamic Questionnaire & Offer Recommendation
  if (userSessionData[fromId].stage !== undefined) {
    // Try to extract answers from the current userMessageText
    for (const field of NEEDS_FIELDS) {
      if (!userSessionData[fromId][field.key]) {
        const value = extractFieldValue(field.key, userMessageText);
        if (value) {
          userSessionData[fromId][field.key] = value;
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
      if (!simulateMode) {
        await sendWhatsAppMessage(fromId, replyToSend);
      }
      return;
    }

    // If no nextField, all fields are filled. Proceed to recommendation.
    const quote = calculateInsuranceQuote(userSessionData[fromId]);
    const summary = buildRecommendationMessage(userSessionData[fromId], quote);
    replyToSend = summary;
    conversationMemory[fromId].push({ role: "assistant", content: replyToSend });
    if (conversationMemory[fromId].length > MEMORY_LIMIT * 2) {
      conversationMemory[fromId] = conversationMemory[fromId].slice(-MEMORY_LIMIT * 2);
    }
    
    if (!simulateMode) {
      console.log(`[OUTGOING] To: ${fromId} | Message: ${replyToSend} (Recommendation)`);
      await sendWhatsAppMessage(fromId, replyToSend);
      
      const feedbackMsg = "אשמח לדעת מה דעתך על השירות שקיבלת מהבוט ועל ההמלצה לביטוח הדירה. האם יש משהו שנוכל לשפר?";
      console.log(`[OUTGOING] To: ${fromId} | Message: ${feedbackMsg} (Feedback Request)`);
      await sendWhatsAppMessage(fromId, feedbackMsg);
    }
    if (simulateMode) return replyToSend;
    else return;
  }
}

// =============================
// 1. WhatsApp Webhook Verification (GET /webhook)
// =============================
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
app.post('/simulate', async (req, res) => {
  try {
    const text = req.body?.text;
    if (!text) return res.status(400).json({ answer: 'הודעה ריקה התקבלה.' });

    const answer = await handleMessage(text);
    
    if (answer) {
      res.json({ answer: answer });
    } else {
      res.json({ answer: 'מצטער, לא מצאתי תשובה כרגע.' });
    }
  } catch (e) {
    console.error('Unhandled /simulate error:', e);
    res.status(500).json({ answer: 'אירעה שגיאה פנימית בעיבוד הבקשה. אנא נסה שוב בעוד מספר רגעים.' });
  }
});

// =============================
// 2. WhatsApp Message Handler (POST /webhook)
// =============================
app.post("/webhook", async (req, res) => {
  try {
    const { object, entry } = req.body;

    if (object === "whatsapp_business_account") {
      for (const ent of entry) {
        for (const change of ent.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const fromId = message.from;
              const text = req.body?.text || "";
              
              // Process the message
              await processMessage(text, fromId);
            }
          }
        }
      }
      res.status(200).send("OK");
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("Error in webhook:", error);
    res.sendStatus(500);
  }
});

// =============================
// Local Web Chat Simulator Endpoint
// =============================
app.post('/simulate', async (req, res) => {
  const { message, from } = req.body; // Expects JSON: { "message": "...", "from": "..." }
  if (!message || !from) {
    return res.status(400).send("Missing message or from in request body.");
  }
  console.log(`SIMULATE: Received message: "${message}" from: ${from}`);
  try {
    const reply = await processMessage(message, from, true); // true for simulateMode
    res.send({ reply });
  } catch (error) {
    console.error("SIMULATE: Error processing message:", error);
    res.status(500).send("Error processing message");
  }
});

// Twilio Webhook Endpoint
app.post('/twilio/webhook', async (req, res) => {
  const messageText = req.body.Body;
  const senderPhoneWithPrefix = req.body.From; // e.g., 'whatsapp:+14155238886' or '+14155238886'

  console.log(`[Twilio] Received message from ${senderPhoneWithPrefix}: "${messageText}"`);

  if (!messageText || !senderPhoneWithPrefix) {
    console.error('[Twilio] Missing Body or From in webhook payload.');
    return res.status(400).send('Missing message body or sender phone.');
  }

  // Remove 'whatsapp:' prefix if present, as twilioService functions expect a plain E.164 number for 'to'
  const senderPhone = senderPhoneWithPrefix.replace(/^whatsapp:/i, '');

  try {
    const botResponse = await handleMessage(senderPhone, messageText);

    if (!botResponse || typeof botResponse !== 'string' || botResponse.startsWith("מצטער, אירעה שגיאה")) {
      console.error(`[Twilio] Failed to get valid response from handleMessage for: "${messageText}". Response: ${botResponse}`);
      // Optionally, send a generic error message back to the user if handleMessage failed
      // For now, just return 500 as the original plan was to return 500 on failure to get bot response
      return res.status(500).send('Failed to get bot response.');
    }

    console.log(`[Twilio] Bot response for ${senderPhone}: "${botResponse.substring(0, 60)}..."`);

    const wappResult = await sendWapp(senderPhone, botResponse);

    if (wappResult.success) {
      console.log(`[Twilio] Successfully sent WhatsApp reply to ${senderPhone}. SID: ${wappResult.sid}`);
      return res.status(200).type('text/xml').send('<Response/>'); // Twilio expects XML response for success
    } else {
      console.warn(`[Twilio] Failed to send WhatsApp reply to ${senderPhone}, attempting SMS fallback. Error: ${wappResult.error}`);
      const smsResult = await smsFallback(senderPhone, botResponse);
      if (smsResult.success) {
        console.log(`[Twilio] Successfully sent SMS fallback to ${senderPhone}. SID: ${smsResult.sid}`);
        return res.status(200).type('text/xml').send('<Response/>');
      } else {
        console.error(`[Twilio] Failed to send SMS fallback to ${senderPhone}. Error: ${smsResult.error}`);
        return res.status(500).send('Failed to send response via Twilio WhatsApp or SMS.');
      }
    }
  } catch (error) {
    console.error(`[Twilio] Unexpected error processing webhook for ${senderPhoneWithPrefix}:`, error);
    return res.status(500).send('Internal server error processing Twilio webhook.');
  }
});

// =============================
// Bootstrap & Server Start
// =============================
const PORT = process.env.PORT || 3000;

// TODO: remove after verified in all envs
await initializeChain();     // creates table if missing
await runMetadataMigration();   // now ADDs metadata column

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
