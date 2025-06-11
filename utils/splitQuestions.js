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
      new SystemMessage(`אתה מומחה לזיהוי שאלות בהודעות טקסט.
        עליך לזהות אם יש יותר משאלה אחת בהודעה.
        החזר מערך של שאלות נפרדות.
        אם יש רק שאלה אחת, החזר מערך עם שאלה אחת.
        אם אין שאלות, החזר מערך ריק.`),
      new HumanMessage(text)
    ];

    const response = await model.invoke(messages);
    const questions = response.content
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0);

    return questions;
  } catch (error) {
    console.error('Error in splitQuestions:', error);
    // Return the original text as a single question in case of error
    return [text];
  }
} 