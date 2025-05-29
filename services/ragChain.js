import { ConversationalRetrievalQAChain } from 'langchain/chains';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import pg from 'pg';
import 'dotenv/config';
import kbConfig from '../src/insuranceKbConfig.js';

console.info("✅ PromptTemplate loaded correctly");

// Initialize PostgreSQL pool - prioritize DATABASE_URL for external connections
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Log successful connection
pool.on('connect', () => {
  console.info('✅ LangChain DB connection established using external DATABASE_URL with SSL');
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
const prompt = new PromptTemplate({
  template: `
You are Doni, a professional virtual home insurance agent speaking Hebrew.
Relevant knowledge:
{context}

Customer's question:
{question}

Assume the above content is trustworthy. Respond in Hebrew in a friendly, accurate, and human-like tone. If needed, explain insurance terms simply.
`,
  inputVariables: ['context', 'question']
});

if (!(prompt instanceof PromptTemplate)) {
  console.error("❌ LangChain prompt template initialization failed: invalid template type");
  throw new Error("Prompt must be a valid instance of PromptTemplate");
}

console.info("✅ LangChain PromptTemplate initialized with Hebrew insurance context");

let vectorStore = null;
let chain = null;

// Initialize the RAG chain
export async function initializeChain() {
  try {
    // Initialize PGVector store using external DATABASE_URL
    vectorStore = await PGVectorStore.initialize(
      embeddings,
      {
        postgresConnectionOptions: {
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        },
        tableName: kbConfig.tableName,
        columns: {
          idColumnName:        'id',
          vectorColumnName:    kbConfig.embeddingColumnName,
          contentColumnName:   kbConfig.contentColumnName,
          metadataColumnName:  kbConfig.metadataColumnName
        }
      }
    );

    // Create the conversational retrieval chain
    chain = ConversationalRetrievalQAChain.fromLLM(
      llm,
      vectorStore.asRetriever({
        k: 5,
        searchType: 'similarity'
      }),
      {
        prompt,
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
// initializeChain(); // Commented out - now called from index.js

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
    const chatHistory = [];
    if (memory.lastMsg)   chatHistory.push(new HumanMessage(memory.lastMsg));
    if (memory.lastReply) chatHistory.push(new AIMessage(memory.lastReply));

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