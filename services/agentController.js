export async function processMessage(text, memory = {}) {
  try {
    // Detect intent first
    const intent = intentDetect(text);
    memory.intent = intent;

    // Handle greeting intent immediately
    if (intent === "greeting") {
      return {
        response: "היי! אני כאן לכל שאלה לגבי ביטוח דירה. איך אוכל לעזור?",
        memory: memory
      };
    }

    // Continue with RAG for non-greeting intents
    const response = await smartAnswer(text, memory.conversationHistory || []);
    
    return {
      response: response,
      memory: memory
    };
  } catch (error) {
    console.error('[AgentController] Error processing message:', error);
    return {
      response: "מצטער, אירעה שגיאה. אשמח לעזור לך עם שאלות על ביטוח דירה.",
      memory: memory
    };
  }
} 