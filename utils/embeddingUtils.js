import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Generates an embedding for the given text using the OpenAI API.
 * @param {string} text - The text to embed.
 * @returns {Promise<Array<number>|null>} The embedding vector or null if an error occurs.
 */
export async function getEmbedding(text) {
  if (!text || typeof text !== 'string') {
    console.error('Invalid input text for embedding.');
    return null;
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.trim(), // OpenAI recommends trimming whitespace
    });

    if (response && response.data && response.data[0] && response.data[0].embedding) {
      return response.data[0].embedding;
    }
    console.error('Invalid response structure from OpenAI embeddings API:', response);
    return null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
} 