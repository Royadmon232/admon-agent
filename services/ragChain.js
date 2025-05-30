import { ConversationalRetrievalQAChain } from 'langchain/chains';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  ConversationSummaryBufferMemory,
  ConversationEntityMemory,
  CombinedMemory
} from "langchain/memory";
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
אתה דוני, סוכן ביטוח דירות מנוסה. דבר בעברית חמה ומשכנעת.

<ידע רלוונטי>
{context}
</ידע רלוונטי>

שאלה:
{question}

הנחיות:
1. פתח במשפט קבלת-פנים אישי (אם יש שם – השתמש בו)
2. הסבר בבירור את ההבדלים או הכיסויים, כולל דוגמאות
3. הוסף ערך שיווקי (יתרון ללקוח, קריאה לפעולה)
4. סיים בקריאה ידידותית

ענֵה עד ‎220‎ מילים.
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
let entityMem = null;  // Add this to track entity memory

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

    // Initialize memory components
    const summaryMem = new ConversationSummaryBufferMemory({
      llm,
      maxTokenLimit: 1200,
      memoryKey: 'chat_history',
      inputKey: 'question',
      outputKey: 'text'
    });

    entityMem = new ConversationEntityMemory({
      llm,
      entityExtractionPrompt:
        "Return as JSON any personal facts (name, phone, address, coverage-type, licence-plate, etc.). If none, return {}.",
      memoryKey: 'entities',
      inputKey: 'question',
      outputKey: 'text'
    });

    const memory = new CombinedMemory({ 
      memories: [summaryMem, entityMem] 
    });

    // Create the conversational retrieval chain
    chain = ConversationalRetrievalQAChain.fromLLM(
      llm,
      vectorStore.asRetriever({
        k: 8,                     // higher recall
        searchType: "similarity"  // disable any score threshold
      }),
      {
        memory,
        prompt,
        returnSourceDocuments: true,
        verbose: false,
        questionGeneratorTemplate:
          "Use these facts & summary to build one refined search query.\nFacts: {entities}\nSummary: {chat_history}\nQuestion: {question}"
      }
    );

    // Add a safe debug listener only if the chain supports .on()
    if (typeof chain?.on === "function") {
      chain.on("retrieverEnd", ({ documents }) =>
        console.debug("[RAG] Top docs:", documents.map(d => d.metadata.id))
      );
    }

    console.log('✅ LangChain RAG chain initialized successfully');
  } catch (error) {
    console.error('⚠️ Failed to initialize LangChain RAG chain:', error.message);
    chain = null;
  }
}

// Initialize on module load
// initializeChain(); // Commented out - now called from index.js

/* ----- helper: split incoming Hebrew/English text into max-5 questions ----- */
function splitQuestions(text) {
  return text
    .split(/[?؟]|[\n\.](?=\s*[^.\n]+[?؟])/g)   // detect ? or line-break+punc
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 5);                              // safety cap at 5
}
/* -------------------------------------------------------------------------- */

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
    // Build context from memory (for backward compatibility)
    let context = '';
    if (memory.firstName) context += ` לקוח בשם ${memory.firstName}.`;
    if (memory.city) context += ` גר בעיר ${memory.city}.`;
    if (memory.homeValue) context += ` ערך דירתו ${memory.homeValue}₪.`;

    // Add context to the text for processing
    const fullText = text + context;

    /* ① break one message into separate questions */
    const questions = splitQuestions(fullText);
    const answers   = [];

    /* ② run the RAG chain for each question */
    for (const q of questions) {
      const res = await chain.call({
        question: q
      });
      if (res?.text) answers.push(res.text.trim());
    }

    /* ③ if we have answers, ask GPT-4o to merge them in a marketing tone */
    if (answers.length > 1) {
      const merged = await llm.call([new HumanMessage(`
Combine the following answers into one friendly, marketing-oriented Hebrew reply.
Keep it professional and clear; do **not** mention these bullet separators.

---
${answers.join("\n---\n")}
---
`)]);
      console.info("[LangChain] Smart multi-answer generated");
      return merged.content.trim();
    }

    /* If only one answer or no split, return the single answer */
    if (answers.length === 1) {
      console.info('[LangChain] Smart answer generated');
      return answers[0];
    }

    /* fallback to single-question flow if split detected nothing */
    const res = await chain.call({ 
      question: fullText
    });
    return res?.text?.trim() || null;

  } catch (error) {
    console.error('[LangChain] Error generating smart answer:', error.message);
    return null;
  }
}

// Export entity memory for controller use
export { entityMem }; 