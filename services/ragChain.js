import { ConversationalRetrievalQAChain } from 'langchain/chains';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate } from '@langchain/core/prompts';
import pg from 'pg';
import 'dotenv/config';

// Initialize PostgreSQL pool
const pool = new pg.Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT
});

// Initialize OpenAI components
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'text-embedding-3-small'
});

const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o',
  temperature: 0.7
});

// Custom prompt template for Hebrew insurance responses
const qaPrompt = PromptTemplate.fromTemplate(`
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי. דבר בעברית בגוף ראשון.

הקשר: {context}

שאלה: {question}

תן תשובה מקצועית, ידידותית ומקיפה בעברית. התייחס ישירות לשאלה וכלול את כל המידע הרלוונטי.
`);

let vectorStore = null;
let chain = null;

// Initialize the RAG chain
async function initializeChain() {
  try {
    // Initialize PGVector store
    vectorStore = await PGVectorStore.initialize(embeddings, {
      postgresConnectionOptions: {
        user: process.env.PGUSER,
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: process.env.PGPORT
      },
      tableName: 'insurance_qa',
      columns: {
        idColumnName: 'id',
        vectorColumnName: 'embedding',
        contentColumnName: 'question',
        metadataColumnName: 'metadata'
      }
    });

    // Create the conversational retrieval chain
    chain = ConversationalRetrievalQAChain.fromLLM(
      llm,
      vectorStore.asRetriever({
        k: 5,
        searchType: 'similarity'
      }),
      {
        qaTemplate: qaPrompt,
        returnSourceDocuments: true
      }
    );

    console.log('✅ LangChain RAG chain initialized successfully');
  } catch (error) {
    console.error('⚠️ Failed to initialize LangChain RAG chain:', error.message);
    chain = null;
  }
}

// Initialize on module load
initializeChain();

/**
 * Get smart answer using LangChain RAG
 * @param {string} text - User question
 * @param {object} memory - User memory context
 * @returns {Promise<string|null>} Answer or null if not available
 */
export async function smartAnswer(text, memory = {}) {
  if (!chain) {
    console.warn('[LangChain] Chain not initialized, skipping');
    return null;
  }

  try {
    // Build context from memory
    let context = '';
    if (memory.firstName) context += ` לקוח בשם ${memory.firstName}.`;
    if (memory.city) context += ` גר בעיר ${memory.city}.`;
    if (memory.homeValue) context += ` ערך דירתו ${memory.homeValue}₪.`;

    // Get chat history from memory (simplified)
    const chatHistory = memory.lastMsg ? [
      { role: 'human', content: memory.lastMsg },
      { role: 'ai', content: 'הבנתי' }
    ] : [];

    // Query the chain
    const response = await chain.call({
      question: text + context,
      chat_history: chatHistory
    });

    if (response && response.text) {
      console.info('[LangChain] Smart answer generated');
      return response.text.trim();
    }

    return null;
  } catch (error) {
    console.error('[LangChain] Error generating smart answer:', error.message);
    return null;
  }
} 