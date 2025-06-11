import fs from 'fs/promises';
import axios from 'axios';
import { lookupRelevantQAs } from '../services/vectorSearch.js';
import { getHistory, appendExchange, updateCustomer, extractCustomerInfo } from "../services/memoryService.js";
import { buildSalesResponse, intentDetect, chooseCTA } from "../services/salesTemplates.js";
import { smartAnswer } from "../services/ragChain.js";
import { sendWapp } from '../services/twilioService.js';
import { normalize } from "../utils/normalize.js";
import { splitQuestions } from "../utils/splitQuestions.js";

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.78;
const PRIMARY_MODEL = 'text-embedding-3-small';
const FALLBACK_MODEL = 'text-embedding-ada-002';

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
    const answer = await smartAnswer(userMsg, memory.conversationHistory || []);
    return answer || null;
  } catch (error) {
    console.error('[semanticLookup] Error:', error);
    return null;
  }
}

// Main message handler
export async function handleMessage(phone, userMsg) {
  try {
    const normalizedMsg = normalize(userMsg);
    console.info("[handleMessage] New message:", { phone, msg: normalizedMsg });
    
    // Load memory and history
    const memoryData = await getHistory(phone);
    const history = memoryData.history || [];
    const existingCustomer = memoryData.customer || {};
    
    // Extract new customer info from current message
    const newCustomerInfo = await extractCustomerInfo(normalizedMsg);
    
    // Merge existing and new customer info
    const customer = { ...existingCustomer, ...newCustomerInfo };
    
    // Prepare context for API
    const context = history;
    
    // Detect intent
    const intent = intentDetect(normalizedMsg);
    console.info("[handleMessage] Detected intent:", intent);
    
    // Extract and save customer info if available
    await updateCustomer(phone, {
      city: customer.city,
      first_name: customer.firstName,
      last_name: customer.lastName,
      home_value: customer.homeValue,
      stage: customer.stage || 'engaged'
    });
    
    // Handle greeting immediately
    if (intent === "greeting" && context.length === 0) {
      const greetingResponse = customer.firstName 
        ? `שלום ${customer.firstName}! אני דוני, סוכן ביטוח דירות. שמח לעזור לך 😊 איך אוכל לעזור?`
        : "שלום! אני דוני, סוכן ביטוח דירות. שמח לעזור לך 😊 איך אוכל לעזור?";
      
      await appendExchange(phone, normalizedMsg, greetingResponse, {
        intent: "greeting",
        timestamp: new Date().toISOString()
      });
      
      return greetingResponse;
    }
    
    // Split questions using GPT-4o
    const questions = await splitQuestions(normalizedMsg);
    console.info("[handleMessage] Split into questions:", questions.length);
    console.info("[handleMessage] Questions:", questions);
    
    const answers = [];
    
    // Process each question
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.info(`[handleMessage] Processing question ${i + 1}/${questions.length}: "${question}"`);
      
      // Try RAG first
      let answer;
      try {
        answer = await smartAnswer(question, context);
        console.info(`[handleMessage] Got answer for question ${i + 1}`);
      } catch (error) {
        console.error('[handleMessage] RAG error:', error);
        answer = `מצטער, אני לא בטוח לגבי התשובה לשאלה זו. אשמח לבדוק ולחזור אליך עם מידע מדויק.`;
      }
      
      if (answer) {
        answers.push(answer);
      } else {
        // Fallback response if no answer
        console.warn(`[handleMessage] No answer for question ${i + 1}, using fallback`);
        answers.push("מצטער, אני לא בטוח לגבי התשובה לשאלה זו. אשמח לבדוק ולחזור אליך עם מידע מדויק.");
      }
    }
    
    // Build final response
    let finalResponse;
    
    if (answers.length === 1) {
      finalResponse = answers[0];
    } else {
      // Multiple answers - format as numbered list
      finalResponse = answers.map((a, i) => `${i + 1}. ${a}`).join("\n\n");
    }
    
    // Add CTA based on intent if appropriate
    if (intent === 'lead_gen' || intent === 'info_gathering' || intent === 'close') {
      const cta = chooseCTA(intent, customer);
      if (cta && !finalResponse.includes(cta)) {
        finalResponse = `${finalResponse}\n\n${cta}`;
      }
    }
    
    // Add sales template if appropriate
    if (intent !== 'close' && !finalResponse.includes('לחצו כאן') && !finalResponse.includes('בואו נקבע')) {
      const salesTemplate = await buildSalesResponse(intent, { ...customer, history: context });
      if (salesTemplate && !finalResponse.includes(salesTemplate)) {
        finalResponse = `${finalResponse}\n\n${salesTemplate}`;
      }
    }
    
    // Log the response construction
    console.info("[Response Construction]:", {
      intent,
      questionsCount: questions.length,
      responseLength: finalResponse.length
    });
    
    // Append exchange to conversation history
    await appendExchange(phone, normalizedMsg, finalResponse, {
      intent,
      timestamp: new Date().toISOString()
    });
    
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

// Process message with intent detection and memory management
export async function processMessage(text, memory = {}) {
  try {
    // Detect intent first
    const intent = intentDetect(text);
    memory.intent = intent;

    // Handle greeting intent immediately
    if (intent === "greeting") {
      const name = memory?.firstName ? `, ${memory.firstName}` : "";
      return {
        response: `היי${name}! אני דוני 😊 אני כאן לעזור לך עם כל שאלה לגבי ביטוח דירה. איך אוכל לעזור?`,
        memory: memory
      };
    }

    // Handle frustration - show empathy and reset
    if (intent === "frustration") {
      const frustrationResponse = buildSalesResponse(memory);
      return {
        response: frustrationResponse,
        memory: { ...memory, stage: 'needs_support' }
      };
    }

    // Handle info gathering - start collecting information
    if (intent === "info_gathering") {
      const infoResponse = buildSalesResponse(memory);
      return {
        response: infoResponse,
        memory: { ...memory, stage: 'collecting_info' }
      };
    }

    // Handle follow-up questions - use context heavily
    if (intent === "follow_up") {
      // Always use RAG for follow-ups but with context emphasis
      let response = await smartAnswer(text, memory.conversationHistory || []);
      
      // Add a follow-up acknowledgment if needed
      const followUpPrefix = buildSalesResponse(memory);
      if (followUpPrefix && !response.startsWith(followUpPrefix)) {
        response = `${followUpPrefix}\n\n${response}`;
      }
      
      return {
        response: response,
        memory: memory
      };
    }

    // Handle price pushback with immediate objection handling
    if (intent === "price_pushback") {
      // Build objection response
      const objectionResponse = buildSalesResponse({ ...memory, intent: 'price_pushback' });
      return {
        response: objectionResponse,
        memory: { ...memory, stage: 'hesitant' }
      };
    }

    // Handle close intent - move to closing stage
    if (intent === "close") {
      const closeResponse = buildSalesResponse({ ...memory, intent: 'close' });
      return {
        response: closeResponse,
        memory: { ...memory, stage: 'ready_to_close' }
      };
    }

    // For other intents, continue with RAG
    let response = await smartAnswer(text, memory.conversationHistory || []);
    
    // Add CTA if appropriate (not for follow-ups or frustration)
    if (intent !== "follow_up" && intent !== "frustration") {
      const cta = chooseCTA(intent, memory);
      if (cta) {
        response = `${response}\n\n${cta}`;
      }
    }

    // Update stage based on intent
    let updatedMemory = { ...memory };
    if (intent === "lead_gen" && memory.stage === "new") {
      updatedMemory.stage = "interested";
    }
    
    return {
      response: response,
      memory: updatedMemory
    };
  } catch (error) {
    console.error('[AgentController] Error processing message:', error);
    const name = memory?.firstName ? ` ${memory.firstName}` : "";
    return {
      response: `מצטער${name}, אירעה שגיאה. אשמח לעזור לך עם שאלות על ביטוח דירה. בוא ננסה שוב 😊`,
      memory: memory
    };
  }
}

