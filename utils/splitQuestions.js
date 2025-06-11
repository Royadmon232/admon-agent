import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.1,
});

/** Returns an array of individual user questions (strings). */
export async function splitQuestions(text) {
  try {
    const response = await model.invoke([
      {
        role: "system",
        content: `אתה מומחה לזיהוי שאלות בהודעות טקסט.
        עליך לזהות אם יש יותר משאלה אחת בהודעה.
        החזר מערך של שאלות נפרדות.
        אם יש רק שאלה אחת, החזר מערך עם שאלה אחת.
        אם אין שאלות, החזר מערך ריק.`
      },
      {
        role: "user",
        content: text
      }
    ]);

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