import { ChatOpenAI } from "@langchain/openai";

/** Returns an array of individual user questions (strings). */
export async function splitQuestions(text) {
  const llm = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0 });
  const prompt = [
    { role: "system", content: "You are a helper that extracts separate user questions from one message. Return JSON array of strings, no prose." },
    { role: "user", content: text }
  ];
  const { content } = await llm.invoke(prompt);
  try {
    return JSON.parse(content);
  } catch {
    return [text]; // fall-back: treat whole thing as one question
  }
} 