import fs from 'fs/promises';
import axios from 'axios';
import { lookupRelevantQAs } from '../services/vectorSearch.js';
import * as memoryService from "../services/memoryService.js";
import { buildSalesResponse, chooseCTA } from "../services/salesTemplates.js";
import { smartAnswer } from "../services/ragChain.js";
import { sendWapp } from '../services/twilioService.js';
import { normalize } from "../utils/normalize.js";
import { splitQuestions } from "../utils/splitQuestions.js";
import { safeCall } from './utils/safeCall.js';
import { detectIntent } from "./intentDetect.js";

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
export async function handleMessage(phone, msg) {
  console.log('[handleMessage] New message:', { phone, msg });
  
  try {
    // Detect intent
    const intent = await detectIntent(msg);
    console.log('[handleMessage] Detected intent:', intent);
    
    // Update customer stage
    await memoryService.updateCustomer(phone, { stage: 'engaged' });
    
    // Split into questions
    const questions = await splitQuestions(msg);
    console.log('[handleMessage] Split into questions:', questions.length);
    
    // Load memory and history
    const memoryData = await memoryService.getHistory(phone);
    const history = memoryData.history || [];
    const existingCustomer = memoryData.customer || {};
    
    // Extract new customer info from current message
    const newCustomerInfo = await memoryService.extractCustomerInfo(msg);
    
    // Merge existing and new customer info
    const customer = { ...existingCustomer, ...newCustomerInfo };
    
    // If no questions found, use GPT-4o for general response
    if (questions.length === 0) {
      console.info("[handleMessage] No questions found, using GPT-4o for general response");
      const generalPrompt = `You are a friendly insurance agent named Dony. The user sent this message: "${msg}"
      Please provide a friendly, helpful response in Hebrew. If it's a greeting or small talk, respond naturally.
      If it's a question about insurance, explain that you're here to help with insurance-related questions.
      Keep the response concise and engaging.`;
      // Always pass history for context
      const answer = await safeCall(
        () => smartAnswer(generalPrompt, history),
        { fallback: () => 'מצטער, אני בודק וחוזר אליך מיד.' }
      );
      // Prevent duplicate greeting/self-intro
      if ((intent === 'greeting' || intent === 'small_talk') &&
          (answer.includes('שלום') || answer.includes('היי') || answer.includes('אני דוני'))
      ) {
        // Just return the LLM answer as is
        await memoryService.appendExchange(phone, msg, answer, {
          intent,
          timestamp: new Date().toISOString()
        });
        return {
          response: answer,
          intent
        };
      }
      // Otherwise, fallback to default logic
      await memoryService.appendExchange(phone, msg, answer, {
        intent,
        timestamp: new Date().toISOString()
      });
      return {
        response: answer,
        intent
      };
    }
    
    // Process each question
    const answers = [];
    for (const question of questions) {
      console.info(`[handleMessage] Processing question: "${question}"`);
      let answer = null;
      
      // Check if question is related to history
      const isRelatedToHistory = await safeCall(
        async () => {
          if (history.length === 0) return false;
          const checkPrompt = `Based on the conversation history below, determine if the current question is related to or continues from the previous conversation.
          
Conversation History:
${history.map(h => `User: ${h.user}\nBot: ${h.bot}`).join('\n\n')}

Current Question: ${question}

Answer with only "true" if related to previous conversation, or "false" if it's a completely new topic.`;
          // Always pass history for context
          const response = await smartAnswer(checkPrompt, history);
          return response && response.toLowerCase().includes('true');
        },
        { fallback: () => false }
      );
      
      console.info(`[handleMessage] Question related to history: ${isRelatedToHistory}`);
      
      if (isRelatedToHistory) {
        // Generate response based on conversation context
        answer = await safeCall(
          () => smartAnswer(question, history),
          { fallback: () => null }
        );
        console.info("[handleMessage] Generated answer from conversation context");
      }
      
      // Try RAG vector search
      if (!answer) {
        const relevantQAs = await safeCall(
          () => lookupRelevantQAs(question, 8, SEMANTIC_THRESHOLD),
          { fallback: () => [] }
        );
        
        if (relevantQAs && relevantQAs.length > 0) {
          console.info(`[handleMessage] Found ${relevantQAs.length} relevant QAs from vector search`);
          answer = await safeCall(
            () => smartAnswer(question, history, relevantQAs),
            { fallback: () => null }
          );
        } else {
          console.info("[handleMessage] No matches from RAG vector search");
        }
      }
      
      // If still no answer, use GPT-4o for general response
      if (!answer) {
        console.info("[handleMessage] Using GPT-4o for general response");
        const generalPrompt = `You are a friendly insurance agent named Dony. The user sent this message: "${question}"
        Please provide a friendly, helpful response in Hebrew. If it's a greeting or small talk, respond naturally.
        If it's a question about insurance, explain that you're here to help with insurance-related questions.
        Keep the response concise and engaging.`;
        // Always pass history for context
        answer = await safeCall(
          () => smartAnswer(generalPrompt, history),
          { fallback: () => 'מצטער, אני בודק וחוזר אליך מיד.' }
        );
      }
      
      // Final fallback
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
    
    // Append exchange to conversation history
    await memoryService.appendExchange(phone, msg, finalResponse, {
      intent,
      timestamp: new Date().toISOString()
    });
    
    return {
      response: finalResponse,
      intent
    };
    
  } catch (error) {
    console.error('[handleMessage] Error:', error);
    return {
      response: 'מצטער/ת, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה/י שוב או פנה/י אלינו בדרך אחרת.',
      intent: 'error'
    };
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
    const intent = detectIntent(text);
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


