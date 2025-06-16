import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.1,
});

/** Returns an array of individual user questions (strings). */
export async function splitQuestions(text) {
  try {
    const messages = [
      new SystemMessage(`אתה מומחה לזיהוי וחילוץ שאלות מהודעות טקסט בעברית.
        
        משימתך:
        1. זהה אם יש יותר משאלה אחת בהודעה
        2. פצל את ההודעה לשאלות נפרדות
        3. שמור על הניסוח המקורי של כל שאלה
        
        סימנים לזיהוי מספר שאלות:
        - סימני שאלה (?)
        - מילות שאלה אחרי "ו" (ומה, ואיך, וכמה וכו')
        - נושאים שונים באותה הודעה
        - נקודה ואחריה אות גדולה
        - מעבר שורה בין שאלות
        
        החזר רק מערך JSON של השאלות, בפורמט:
        ["שאלה 1", "שאלה 2", ...]
        
        אם יש רק שאלה אחת, החזר מערך עם שאלה אחת.
        אם אין שאלות, החזר מערך ריק [].`),
      new HumanMessage(text)
    ];

    const response = await model.invoke(messages);
    
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(response.content);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(q => q && q.trim().length > 0);
        console.info(`[splitQuestions] Found ${filtered.length} questions (JSON format)`);
        return filtered;
      }
    } catch (jsonError) {
      // If not JSON, split by newlines
      const questions = response.content
        .split('\n')
        .map(q => q.replace(/^[\d\-\.\)]+\s*/, '').trim()) // Remove numbering
        .filter(q => q.length > 0 && !q.startsWith('[') && !q.endsWith(']'));
      
      if (questions.length > 0) {
        console.info(`[splitQuestions] Found ${questions.length} questions (text format)`);
        return questions;
      } else {
        console.info(`[splitQuestions] No questions detected, returning original text`);
        return [text];
      }
    }

    console.info(`[splitQuestions] Failed to parse response, returning original text`);
    return [text];
  } catch (error) {
    console.error('Error in splitQuestions:', error);
    // Return the original text as a single question in case of error
    return [text];
  }
} 