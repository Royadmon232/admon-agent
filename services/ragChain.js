import { createRetrievalChain } from 'langchain/chains/retrieval';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate, ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import pg from 'pg';
import 'dotenv/config';
import kbConfig from '../src/insuranceKbConfig.js';
import { normalize } from '../utils/normalize.js';

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

    // Create modern prompt template
    const chatPrompt = ChatPromptTemplate.fromTemplate(`
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי. דבר בעברית בגוף ראשון.
הקשר: {context}
שאלה: {input}

תן תשובה מקצועית, ידידותית ומקיפה בעברית. התייחס לשאלה וכולל את כל המידע הרלוונטי.
`);

    // Create document chain
    const documentChain = await createStuffDocumentsChain({
      llm,
      prompt: chatPrompt
    });

    // Create the conversational retrieval chain
    chain = await createRetrievalChain({
      combineDocsChain: documentChain,
      retriever: vectorStore.asRetriever({
        k: 8,
        searchType: 'similarity',
        searchKwargs: {
          minScore: 0.60  // Explicitly set threshold to 0.60 to allow more results
        }
      })
    });

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

    // Normalize the question before querying
    const normalizedQuestion = normalize(text + context);

    // Query the chain with new API
    const response = await chain.invoke({
      input: normalizedQuestion
    });

    if (response && response.answer) {
      console.info('[LangChain] Smart answer generated');
      return response.answer.trim();
    }

    return null;
  } catch (error) {
    console.error('[LangChain] Error generating smart answer:', error.message);
    return null;
  }
} 