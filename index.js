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
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { semanticLookup } from './agentController.js';

dotenv.config();

const app = express();
app.use(express.static('public'));
app.use(cors());
app.use(bodyParser.json());

// Load all secrets from environment variables
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// =============================
// Conversation Memory (Contextual Chat)
// =============================
const conversationMemory = {};
const MEMORY_LIMIT = 10; // Number of message pairs to keep per user

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
// WhatsApp Webhook Handlers
// =============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const { body } = req;

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const phone_number_id =
          body.entry[0].changes[0].value.metadata.phone_number_id;
        const from = body.entry[0].changes[0].value.messages[0].from;
        const msg_body = body.entry[0].changes[0].value.messages[0].text.body;

        console.log("📱 Incoming message:", msg_body);

        // Get AI response
        const aiResponse = await semanticLookup(msg_body);
        if (!aiResponse) {
          console.error("❌ No AI response");
          return res.sendStatus(500);
        }

        // Send response back to WhatsApp
        const response = await fetch(
          `https://graph.facebook.com/v17.0/${phone_number_id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: from,
              text: { body: aiResponse },
            }),
          }
        );

        if (!response.ok) {
          console.error("❌ WhatsApp API error:", await response.text());
          return res.sendStatus(500);
        }

        console.log("✅ Response sent:", aiResponse);
        res.sendStatus(200);
      } else {
        res.sendStatus(404);
      }
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.sendStatus(500);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
