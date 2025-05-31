import { ConversationalRetrievalQAChain } from 'langchain/chains';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import pg from 'pg';
import 'dotenv/config';
import kbConfig from '../src/insuranceKbConfig.js';
import { normalize } from "../utils/normalize.js";

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
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי. דבר בעברית בגוף ראשון.
הקשר: {context}
שאלה: {question}

תן תשובה מקצועית, ידידותית ומקיפה בעברית. התייחס לשאלה וכולל את כל המידע הרלוונטי.
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
          idColumnName: kbConfig.idColumnName ?? 'id',
          vectorColumnName: kbConfig.embeddingColumnName,
          contentColumnName: kbConfig.contentColumnName
          
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
 * @param {string} question - User question
 * @param {string} context - User context
 * @returns {Promise<string|null>} Answer or null if not available
 */
export async function smartAnswer(question, context) {
  if (!chain) {
    console.warn('[LangChain] Chain not initialized, skipping');
    return null;
  }

  try {
    // Normalize the question
    const query = normalize(question);
    
    // Get relevant documents
    const results = await vectorStore.similaritySearchWithScore(
      query, 8, { minScore: 0.65 }
    );

    // Build context from memory
    let context = '';
    if (context.firstName) context += ` לקוח בשם ${context.firstName}.`;
    if (context.city) context += ` גר בעיר ${context.city}.`;
    if (context.homeValue) context += ` ערך דירתו ${context.homeValue}₪.`;

    // Get chat history from memory (simplified)
    const chatHistory = [];
    if (context.lastMsg)   chatHistory.push(new HumanMessage(context.lastMsg));
    if (context.lastReply) chatHistory.push(new AIMessage(context.lastReply));

    // Query the chain
    const response = await chain.call({
      question: query + context,
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