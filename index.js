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

import express from 'express';
import axios from 'axios';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import stringSimilarity from 'string-similarity';
import insuranceKnowledgeBase from './insurance_knowledge.json' assert { type: 'json' };

dotenv.config();

const app = express();
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

// =============================
// Helper: Find answer in knowledge base
// =============================
/*
Searches the knowledge base for a relevant answer based on the user's message.
מחפש תשובה רלוונטית בבסיס הידע לפי הודעת המשתמש.
*/
function findKnowledgeBaseAnswer(userMessage) {
  /*
    Knowledge Base Lookup with Fuzzy Matching (RAG)
    ------------------------------------------------
    This function checks the insurance knowledge base for a close match to the user's message using fuzzy string matching.
    If a match above the similarity threshold is found, returns the answer from the knowledge base.
    Otherwise, returns null to let GPT handle the response.
    פונקציה זו בודקת האם יש שאלה דומה בבסיס הידע באמצעות השוואה "מטושטשת" (fuzzy).
    אם נמצאה התאמה מעל סף הדמיון, מוחזרת התשובה מבסיס הידע.
    אם לא, הפנייה תעבור ל-GPT כרגיל.
  */
  const threshold = 0.7; // Similarity threshold (0-1)
  const userText = userMessage.replace(/["'.,!?\-]/g, '').toLowerCase();
  const questions = insuranceKnowledgeBase.map(entry => entry.question.replace(/["'.,!?\-]/g, '').toLowerCase());
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(userText, questions);
  if (bestMatch.rating >= threshold) {
    return insuranceKnowledgeBase[bestMatchIndex].answer;
  }
  return null;
}

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
- לכל משתמש נשמר אילו פרטי מידע נאספו (כתובת, שטח, תכולה, תכשיטים וכו').
- הבוט מזהה מה חסר ושואל רק את השאלה הבאה הרלוונטית.
- לא חוזר על שאלות שכבר נענו, ומתאים את השיחה לתשובות המשתמש.
- כל תשובה נשמרת בזיכרון הסשן של המשתמש.
*/

// Define the key info fields for insurance needs analysis
const NEEDS_FIELDS = [
  { key: 'address', question: 'מהי כתובת הדירה שברצונך לבטח?' },
  { key: 'apartmentSize', question: 'מהו גודל הדירה במ"ר?' },
  { key: 'valuables', question: 'האם יש ברשותך חפצים יקרי ערך (כגון תכשיטים, יצירות אמנות, ציוד יקר)?' },
  { key: 'security', question: 'האם קיימים אמצעי מיגון מיוחדים בדירה (אזעקה, מצלמות, דלתות ביטחון)?' },
  { key: 'residents', question: 'כמה דיירים מתגוררים בדירה?' }
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
  if (fieldKey === 'address' && userMessage.match(/רחוב|כתובת|עיר|מספר/)) {
    return userMessage;
  }
  if (fieldKey === 'apartmentSize' && userMessage.match(/\d+\s?מ"ר|גודל|שטח/)) {
    const match = userMessage.match(/(\d+)\s?מ"ר/);
    return match ? match[1] : userMessage;
  }
  if (fieldKey === 'valuables' && userMessage.match(/(כן|לא|תכשיט|יקר|אמנות|ציוד)/)) {
    return userMessage;
  }
  if (fieldKey === 'security' && userMessage.match(/אזעקה|מצלמה|ביטחון|מיגון/)) {
    return userMessage;
  }
  if (fieldKey === 'residents' && userMessage.match(/\d+\s?(דייר|אנשים|נפשות)/)) {
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
  summary += `• כתובת: ${session.address || 'לא צוינה'}
`;
  summary += `• גודל דירה: ${session.apartmentSize || 'לא צוין'} מ"ר
`;
  summary += `• חפצים יקרי ערך: ${session.valuables || 'לא צוינו'}
`;
  summary += `• אמצעי מיגון: ${session.security || 'לא צוינו'}
`;
  summary += `• מספר דיירים: ${session.residents || 'לא צוין'}
`;
  summary += `
הכיסוי המומלץ כולל הגנה מפני נזקי מים, גניבה, אש, צד ג' ועוד, בהתאמה אישית לצרכים שלך.
`;
  summary += `המחיר המשוער: כ-₪${quote} לשנה (המחיר עשוי להשתנות בהתאם לפרטים נוספים או הרחבות).
`;
  summary += `
אם תרצה לקבל הצעת מחיר מסודרת או לשוחח עם סוכן, אשמח לעזור!`
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
  'נציג אנושי', 'נציג', 'סוכן אנושי', 'סוכן', 'אני רוצה לדבר עם נציג', 'אני צריך עזרה נוספת',
  'I want to speak with a human', 'human agent', 'representative', 'need further help', 'talk to a person'
];

// Contact details for escalation (customize as needed)
const HUMAN_AGENT_CONTACT = 'תוכל ליצור קשר עם סוכן אנושי בטלפון: 03-1234567 או במייל: agent@example.com';

// Helper: Detect if user wants a human agent
function isHumanAgentRequest(message) {
  const normalized = message.toLowerCase();
  return HUMAN_AGENT_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
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
  'שכח אותי', 'מחק את כל המידע', 'delete my data', 'forget me', 'erase my data', 'מחק אותי'
];
function isForgetMeRequest(message) {
  const normalized = message.toLowerCase();
  return FORGET_ME_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
}

// =============================
// 1. WhatsApp Webhook Verification (GET /webhook)
// =============================
// Meta/Facebook will call this endpoint when you set up your webhook in the WhatsApp App dashboard.
// You must provide the same verify token (WHATSAPP_VERIFY_TOKEN) in both Meta and your .env file.
app.get('/webhook', (req, res) => {
  const verify_token = WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// =============================
// 2. WhatsApp Message Handler (POST /webhook)
// =============================
// Meta/Facebook will POST incoming WhatsApp messages to this endpoint.
// This handler processes each message, sends it to OpenAI, and replies to the user.
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    if (!messages || !Array.isArray(messages)) {
      return res.sendStatus(200);
    }
    for (const message of messages) {
      const from = message.from; // WhatsApp user phone number
      const userMessage = message.text?.body; // Incoming text
      if (!userMessage || !from) continue;
      console.log(`[INCOMING] From: ${from} | Message: ${userMessage}`);

      // =============================
      // Data Privacy: Handle "forget me" requests
      // =============================
      /*
      If the user requests to delete all their data, erase their session and chat history.
      אם המשתמש מבקש "שכח אותי" או מחיקת מידע, כל המידע שלו יימחק.
      */
      if (isForgetMeRequest(userMessage)) {
        delete conversationMemory[from];
        delete userSessionData[from];
        // Optionally, delete from persistent storage if implemented
        const forgetMsg = 'כל המידע שלך נמחק מהמערכת בהתאם לבקשתך. אם תרצה להתחיל שיחה חדשה, אשמח לעזור!';
        if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: forgetMsg }
            },
            {
              headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          console.log('WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set. Skipping WhatsApp reply.');
        }
        continue; // Skip further processing for this message
      }

      // =============================
      // Human Agent Escalation: Detect and respond
      // =============================
      /*
      If the user requests a human agent, provide contact details and skip further bot processing for this message.
      אם המשתמש מבקש נציג אנושי, נשלח פרטי יצירת קשר ונדלג על המשך טיפול בוט.
      */
      if (isHumanAgentRequest(userMessage)) {
        const escalationMsg = `אני כאן כדי לעזור, אך כמובן שאפשר גם לדבר עם סוכן אנושי.\n${HUMAN_AGENT_CONTACT}`;
        conversationMemory[from].push({ role: 'assistant', content: escalationMsg });
        if (conversationMemory[from].length > MEMORY_LIMIT * 2) {
          conversationMemory[from] = conversationMemory[from].slice(-MEMORY_LIMIT * 2);
        }
        if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: escalationMsg }
            },
            {
              headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          console.log('WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set. Skipping WhatsApp reply.');
        }
        continue; // Skip further processing for this message
      }

      // =============================
      // Conversation Memory: Retrieve and update user history
      // =============================
      if (!conversationMemory[from]) {
        conversationMemory[from] = [];
      }
      conversationMemory[from].push({ role: 'user', content: userMessage });
      if (conversationMemory[from].length > MEMORY_LIMIT * 2) {
        conversationMemory[from] = conversationMemory[from].slice(-MEMORY_LIMIT * 2);
      }

      // =============================
      // Dynamic Questionnaire: Store answers and ask next relevant question
      // =============================
      /*
      For each user, try to extract answers to needs fields from their message.
      Store answers in userSessionData. If info is missing, ask only the next relevant question.
      לכל משתמש ננסה לחלץ תשובות מההודעה לשדות הצרכים, ונשמור ב-userSessionData.
      אם חסר מידע, נשאל רק את השאלה הבאה הרלוונטית.
      */
      if (!userSessionData[from]) userSessionData[from] = {};
      for (const field of NEEDS_FIELDS) {
        if (!userSessionData[from][field.key]) {
          const value = extractFieldValue(field.key, userMessage);
          if (value) {
            userSessionData[from][field.key] = value;
          }
        }
      }
      const nextField = getNextMissingField(from);
      if (nextField) {
        // Ask only the next relevant question (in Hebrew, polite and professional)
        const question = nextField.question;
        conversationMemory[from].push({ role: 'assistant', content: question });
        if (conversationMemory[from].length > MEMORY_LIMIT * 2) {
          conversationMemory[from] = conversationMemory[from].slice(-MEMORY_LIMIT * 2);
        }
        // Send the question directly, skip GPT for this turn
        if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: question }
            },
            {
              headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          console.log('WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set. Skipping WhatsApp reply.');
        }
        continue; // Skip to next message, don't call GPT until all info is collected
      }

      // =============================
      // Offer Recommendation: After all info is collected
      // =============================
      /*
      Once all required info is collected, recommend a suitable coverage and quote.
      לאחר איסוף כל הפרטים, הבוט ממליץ על כיסוי מתאים ומחיר משוער.
      */
      const allFieldsFilled = NEEDS_FIELDS.every(f => userSessionData[from][f.key]);
      if (allFieldsFilled) {
        const quote = calculateInsuranceQuote(userSessionData[from]);
        const summary = buildRecommendationMessage(userSessionData[from], quote);
        conversationMemory[from].push({ role: 'assistant', content: summary });
        if (conversationMemory[from].length > MEMORY_LIMIT * 2) {
          conversationMemory[from] = conversationMemory[from].slice(-MEMORY_LIMIT * 2);
        }
        if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: summary }
            },
            {
              headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          // =============================
          // Feedback Request: After recommendation
          // =============================
          /*
          After sending the recommendation, ask the user for feedback about the bot and the insurance advice.
          לאחר שליחת ההמלצה, נבקש מהמשתמש משוב על השירות.
          */
          const feedbackMsg = 'אשמח לדעת מה דעתך על השירות שקיבלת מהבוט ועל ההמלצה לביטוח הדירה. האם יש משהו שנוכל לשפר?';
          await axios.post(
            `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: feedbackMsg }
            },
            {
              headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          console.log('WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set. Skipping WhatsApp reply.');
        }
        continue; // Skip GPT for this turn, as the recommendation is sent directly
      }

      // =============================
      // RAG: Check knowledge base before GPT
      // =============================
      /*
      Retrieval-Augmented Generation (RAG) Flow:
      ------------------------------------------
      1. When a user message arrives, the bot first checks the structured knowledge base (insurance_knowledge.json) for a close match using fuzzy string matching.
      2. If a relevant answer is found (above the similarity threshold), the bot:
         - Sends the answer directly to the user (in clear, professional Hebrew, as required by SYSTEM_PROMPT),
         - Appends a short reference: '(מתוך מאגר הידע הרשמי)' to indicate the answer is from the official knowledge base,
         - Logs the Q&A to the user's conversation memory for context,
         - Skips the GPT call for this turn.
      3. If no match is found, the bot proceeds as usual to GPT, maintaining all conversation memory and features.
      
      הרחבה על זרימת RAG:
      -------------------
      1. הבוט בודק תחילה את מאגר הידע המובנה (insurance_knowledge.json) באמצעות השוואה מטושטשת.
      2. אם נמצאה תשובה רלוונטית, היא נשלחת למשתמש בעברית תקינה ומקצועית, עם הפניה '(מתוך מאגר הידע הרשמי)', ונשמרת בזיכרון השיחה.
      3. אם לא, הבוט פונה ל-GPT כרגיל.
      */
      let knowledgeBaseAnswer = findKnowledgeBaseAnswer(userMessage);
      let conversationHistory;
      if (knowledgeBaseAnswer) {
        // Add reference to knowledge base answers
        const kbReply = `${knowledgeBaseAnswer} (מתוך מאגר הידע הרשמי)`;
        conversationMemory[from].push({ role: 'assistant', content: kbReply });
        if (conversationMemory[from].length > MEMORY_LIMIT * 2) {
          conversationMemory[from] = conversationMemory[from].slice(-MEMORY_LIMIT * 2);
        }
        if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: kbReply }
            },
            {
              headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          console.log('WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set. Skipping WhatsApp reply.');
        }
        continue; // Skip GPT for this turn, as the answer is from the knowledge base
      } else {
        conversationHistory = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...conversationMemory[from]
        ];
      }

      // =============================
      // 3. Send user message and history to OpenAI GPT-4/4o
      // =============================
      const openaiRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: conversationHistory,
          max_tokens: 300,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const gptReply = openaiRes.data.choices?.[0]?.message?.content?.trim();
      console.log(`[OUTGOING] To: ${from} | Message: ${gptReply}`);

      conversationMemory[from].push({ role: 'assistant', content: gptReply });
      if (conversationMemory[from].length > MEMORY_LIMIT * 2) {
        conversationMemory[from] = conversationMemory[from].slice(-MEMORY_LIMIT * 2);
      }

      // =============================
      // 4. Send reply to WhatsApp user
      // =============================
      // This uses the WhatsApp Cloud API. You must have a WhatsApp Business Phone Number ID and API token.
      // Configure these in your Meta for Developers dashboard.
      // If you want to send messages outside the 24-hour window, you must use a pre-approved message template (see Meta docs).
      if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
        await axios.post(
          `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: 'whatsapp',
            to: from,
            text: { body: gptReply }
          },
          {
            headers: {
              'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } else {
        console.log('WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set. Skipping WhatsApp reply.');
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling webhook:', error?.response?.data || error.message);
    res.sendStatus(500);
  }
});

// =============================
// 5. Start the Express server
// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 