import { smartAnswer } from './ragChain.js';
import { intentDetect, buildSalesResponse, chooseCTA } from './salesTemplates.js';

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