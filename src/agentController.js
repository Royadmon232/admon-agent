import fs from 'fs/promises';
import axios from 'axios';
import { lookupRelevantQAs } from '../services/vectorSearch.js';
import { getHistory, appendExchange, updateCustomer, extractCustomerInfo } from "../services/memoryService.js";
import { buildSalesResponse, intentDetect, chooseCTA } from "../services/salesTemplates.js";
import { smartAnswer } from "../services/ragChain.js";
import { sendWapp } from '../services/twilioService.js';
import { normalize } from "../utils/normalize.js";
import { splitQuestions } from "../utils/splitQuestions.js";
import { safeCall } from './utils/safeCall.js';

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.65;
const PRIMARY_MODEL = 'text-embedding-3-small';
const FALLBACK_MODEL = 'text-embedding-ada-002';
const MAX_CONTEXT_LENGTH = 100000;

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
    if (intent === "greeting") {
      const greetingResponse = buildSalesResponse("greeting", customer);
      
      await appendExchange(phone, normalizedMsg, greetingResponse, {
        intent: "greeting",
        timestamp: new Date().toISOString()
      });
      
      return greetingResponse;
    }
    
    // Split questions using GPT-4o
    const questions = await splitQuestions(normalizedMsg);
    console.info("[handleMessage] Split into questions:", questions.length);
    
    const answers = [];
    
    // Process each question
    for (const question of questions) {
      console.info(`[handleMessage] Processing question: "${question}"`);
      let answer = null;
      
      // 1. First, check if this question relates to conversation memory
      if (history.length > 0) {
        console.info("[handleMessage] Checking conversation memory...");
        answer = await safeCall(
          () => smartAnswer(question, history),
          { fallback: () => null }
        );
        
        if (answer) {
          console.info("[handleMessage] Found answer in conversation memory");
          answers.push(answer);
          continue;
        }
      }
      
      // 2. If no answer from memory, try RAG (vector search)
      console.info("[handleMessage] No answer in memory, trying RAG vector search...");
      const relevantQAs = await safeCall(
        () => lookupRelevantQAs(question, SEMANTIC_THRESHOLD),
        { fallback: () => [] }
      );
      
      if (relevantQAs && relevantQAs.length > 0) {
        console.info(`[handleMessage] Found ${relevantQAs.length} RAG matches`);
        answer = await safeCall(
          () => smartAnswer(question, history, relevantQAs),
          { fallback: () => null }
        );
      }
      
      // 3. If still no answer, use GPT-4o general knowledge
      if (!answer) {
        console.info("[handleMessage] No RAG matches, using GPT-4o general knowledge...");
        answer = await safeCall(
          () => smartAnswer(question, []), // Empty history to force general knowledge
          { fallback: () => 'מצטער, אני בודק וחוזר אליך מיד.' }
        );
      }
      
      // 4. If GPT fails, use safe default
      if (!answer) {
        answer = 'מצטער, אני בודק וחוזר אליך מיד.';
      }
      
      answers.push(answer);
    }
    
    // Build final response
    let finalResponse = answers.length === 1 
      ? answers[0] 
      : answers.map((a, i) => `${i + 1}. ${a}`).join("\n\n");
    
    // Add CTA based on intent if appropriate
    if (intent === 'lead_gen' || intent === 'info_gathering' || intent === 'close') {
      const cta = chooseCTA(intent, customer);
      if (cta) {
        finalResponse = `${finalResponse}\n\n${cta}`;
      }
    }
    
    // Add sales template if appropriate
    if (intent !== 'close' && !finalResponse.includes('לחצו כאן') && !finalResponse.includes('בואו נקבע')) {
      const salesTemplate = await buildSalesResponse(intent, { ...customer, history });
      if (salesTemplate && !finalResponse.includes(salesTemplate)) {
        finalResponse = `${finalResponse}\n\n${salesTemplate}`;
      }
    }
    
    // Ensure response doesn't exceed context length
    if (finalResponse.length > MAX_CONTEXT_LENGTH) {
      console.warn('[handleMessage] Response exceeds max length, truncating');
      finalResponse = finalResponse.substring(0, MAX_CONTEXT_LENGTH - 100) + '...';
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

// Helper function to find similar previous questions
function findSimilarPreviousQuestion(question, history, threshold = 0.65) {
  if (!history || history.length === 0) return null;
  
  // Get user messages from history
  const userMessages = history
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content);
  
  // Find most similar previous question
  let maxSimilarity = 0;
  let mostSimilar = null;
  
  for (const prevQuestion of userMessages) {
    const similarity = calculateTextSimilarity(question, prevQuestion);
    if (similarity > maxSimilarity && similarity >= threshold) {
      maxSimilarity = similarity;
      mostSimilar = prevQuestion;
    }
  }
  
  return mostSimilar;
}

// Helper function to calculate text similarity
function calculateTextSimilarity(text1, text2) {
  // Simple implementation - can be replaced with more sophisticated similarity
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
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


