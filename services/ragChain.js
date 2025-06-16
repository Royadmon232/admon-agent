import { createRetrievalChain } from 'langchain/chains/retrieval';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate, ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import pg from 'pg';
import 'dotenv/config';
import kbConfig from '../src/insuranceKbConfig.js';
import { normalize } from '../utils/normalize.js';
import { splitQuestions } from '../utils/splitQuestions.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { safeCall } from '../src/utils/safeCall.js';

// Load sales templates
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templatesPath = join(process.cwd(), 'marketing_templates.json');

console.info(`[RAG] Loading templates from: ${templatesPath}`);

let salesTemplates;
try {
  salesTemplates = JSON.parse(readFileSync(templatesPath, 'utf8'));
  console.info('[RAG] Successfully loaded marketing templates');
} catch (error) {
  console.error('[RAG] Error loading marketing templates:', error.message);
  // Fallback to default templates if file not found
  salesTemplates = {
    LEAD: [
      "ביטוח דירה מגן על ההשקעה הכי חשובה שלך מפני נזקי מים, גניבה ואש",
      "פוליסת ביטוח דירה איכותית יכולה לחסוך לך עשרות אלפי שקלים בעת נזק"
    ],
    DEFAULT: [
      "אני כאן לעזור לך להבין את האפשרויות השונות לביטוח דירה",
      "כל מקרה הוא ייחודי ואני אתאים את ההמלצות לצרכים שלך"
    ]
  };
  console.info('[RAG] Using fallback templates');
}

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

/**
 * Direct search in insurance_qa table to get answers
 * @param {string} question - User question
 * @param {number} limit - Maximum number of results
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {Promise<Array>} Array of {question, answer, similarity} objects
 */
async function searchInsuranceQA(question, limit = 10, threshold = 0.65) {
  try {
    // Get embedding for the question
    const questionEmbedding = await safeCall(() => embeddings.embedQuery(question), { fallback: () => [] });
    
    // Query the database directly with cosine similarity
    const result = await pool.query(`
      SELECT 
        question,
        answer,
        1 - (embedding <=> $1::vector) as similarity
      FROM insurance_qa
      WHERE 1 - (embedding <=> $1::vector) > $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [questionEmbedding, threshold, limit]);
    
    console.info(`[RAG] Direct DB search found ${result.rows.length} matches for: "${question}"`);
    
    return result.rows.map(row => ({
      question: row.question,
      answer: row.answer,
      similarity: row.similarity
    }));
  } catch (error) {
    console.error('[RAG] Error in direct DB search:', error);
    return [];
  }
}

// Initialize the RAG chain
export async function initializeChain() {
  try {
    // Initialize PGVector store using external DATABASE_URL
    // Note: Using pure vector similarity search without metadata filtering
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
        
          metadataColumnName: null // Explicitly disable metadata
        },
        filter: {}, // Force embedding-only search with empty filter
        distanceStrategy: 'cosine' // Use cosine similarity for vector comparison
      }
    );

    // Create modern prompt template with anti-hallucination
    const chatPrompt = ChatPromptTemplate.fromTemplate(`
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי. דבר בעברית בגוף ראשון.

הנחיות לטון ושפה:
- פנה ללקוח בשמו הפרטי כשידוע ("{{name}}, אשמח להסביר...")
- השתמש בלשון חמה, אישית ומזמינה תוך שמירה על מקצועיות
- הפגן אמפתיה ודאגה כנה ("אני מבין את החששות שלך, זה טבעי...")
- השתמש בביטויים מעודדים וחיוביים
- פנה ללקוח בגוף שני נוכח (את/ה)
- אל תציג את עצמך כבוט או AI - אתה סוכן ביטוח אמיתי

הנחיות חשובות:
- השתמש אך ורק במידע המופיע בהקשר למטה
- אל תמציא או תנחש נתונים שאינם מופיעים במפורש
- אם אין מספיק מידע, אמור "אבדוק את הנושא ואחזור אליך"
- אל תענה על שאלות שאינן קשורות לביטוח דירה

הקשר (מידע מהמאגר):
{context}

שאלה: {input}

תן תשובה מקצועית, ידידותית ומקיפה בעברית המבוססת על המידע בהקשר בלבד.
אם המידע בהקשר לא מספיק, אמור זאת בצורה מקצועית.
בסוף התשובה, אם מתאים, הוסף קריאה לפעולה חמה ומזמינה.
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
          scoreThreshold: 0.65
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

// Ensure the vector store table has the required columns
(async () => {
  try {
    await pool.query(`
      DO $$ 
      BEGIN
        -- Add metadata column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = '${kbConfig.tableName}' 
          AND column_name = 'metadata'
        ) THEN
          ALTER TABLE ${kbConfig.tableName} 
          ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
        END IF;
      END $$;
    `);
    console.log('✅ Vector store table structure verified');
  } catch (err) {
    console.error('⚠️ Failed to verify vector store table structure:', err.message);
  }
})();

// Removed local splitQuestions function - using the GPT-4o based one from utils/splitQuestions.js

/**
 * Merge answers with GPT-4o for natural, marketing-oriented Hebrew response
 * @param {Array} answerGroups - Array of {question, answers} objects
 * @param {string} originalQuestion - Original user question
 * @param {string} historyContext - Conversation history context
 * @returns {Promise<string>} Merged answer
 */
async function mergeAnswersWithGPT(answerGroups, originalQuestion, historyContext = '') {
  const systemPrompt = `אתה דוני, סוכן ביטוח דירות וירטואלי. דבר בעברית בגוף ראשון. אתה סוכן ביטוח דירות מקצועי ואדיב. תפקידך לענות על שאלות בנושא ביטוח דירה בצורה מקצועית, ידידותית ומקיפה.

כל תשובה שלך חייבת:
  1. להיות בעברית תקינה ומקצועית
  2. להיות מנוסחת בצורה ידידותית, מכבדת ובטון אישי ונעים
  3. להתייחס ישירות לשאלה שנשאלה
  4. לכלול את כל המידע הרלוונטי והחשוב
  5. להיות מדויקת מבחינה מקצועית

קיבלת מידע רלוונטי מהמאגר שלנו. עליך:
  1. לשלב את המידע הרלוונטי בתשובה אחת מקיפה וקוהרנטית
  2. לנסח בסגנון אישי וייחודי משלך, שתרגיש אותנטית וטבעית ללקוח
  3. אם אין מספיק מידע לחלק מהשאלה, השלם מהידע שלך
  4. לוודא שהתשובה שלמה ומשדרת ביטחון ומקצועיות`;

  let contextBlock = '';
  for (const group of answerGroups) {
    if (group.answers && group.answers.length > 0) {
      contextBlock += `\nשאלה: ${group.question}\n`;
      contextBlock += `מידע רלוונטי:\n${group.answers.join('\n')}\n`;
    } else {
      contextBlock += `\nשאלה: ${group.question}\n`;
      contextBlock += `מידע רלוונטי: אין מידע ספציפי במאגר - יש לענות מהידע הכללי\n`;
    }
  }

  const userPrompt = `השאלה המקורית של הלקוח: ${originalQuestion}\n\nמידע שנמצא במאגר:\n${contextBlock}\n\n${historyContext}\n\nאנא תן תשובה מקיפה ומקצועית לשאלת הלקוח.`;

  try {
    const response = await safeCall(() => llm.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]), { fallback: () => ({ content: 'מצטער, אני בודק וחוזר אליך מיד.' }) });
    
    return response.content.trim();
  } catch (error) {
    console.error('[LangChain] Error merging answers with GPT:', error);
    throw error;
  }
}

/**
 * Detect if a question is a follow-up to the previous conversation
 * @param {string} text - User question
 * @param {Array} history - Conversation history
 * @returns {Promise<boolean>} True if it's a follow-up question
 */
async function isFollowUpQuestion(text, history) {
  if (!history || history.length === 0) return false;
  
  // Common Hebrew follow-up patterns
  const followUpPatterns = [
    /^(תוכל|יכול|אפשר) להסביר/i,
    /^מה (זאת אומרת|הכוונה)/i,
    /^(עוד|יותר) (פרטים|מידע|הסבר)/i,
    /^(לא|כן),? אבל/i,
    /^ו(מה|איך|כמה|מתי|איפה|למה)/i,
    /^בנוסף/i,
    /^גם/i,
    /^אז/i,
    /^למה/i,
    /^איך בדיוק/i,
    /^תן לי דוגמה/i,
    /^הסבר/i,
    /^פרט/i
  ];
  
  // Check if the question matches follow-up patterns
  const normalized = text.trim();
  return followUpPatterns.some(pattern => pattern.test(normalized));
}

/**
 * Calculate text similarity using cosine similarity on word vectors
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @returns {number} Similarity score (0-1)
 */
function calculateTextSimilarity(text1, text2) {
  const words1 = normalize(text1).split(/\s+/);
  const words2 = normalize(text2).split(/\s+/);
  
  // Create frequency maps
  const freq1 = {};
  const freq2 = {};
  
  words1.forEach(word => freq1[word] = (freq1[word] || 0) + 1);
  words2.forEach(word => freq2[word] = (freq2[word] || 0) + 1);
  
  // Get all unique words
  const allWords = [...new Set([...words1, ...words2])];
  
  // Calculate dot product and magnitudes
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  
  allWords.forEach(word => {
    const f1 = freq1[word] || 0;
    const f2 = freq2[word] || 0;
    dotProduct += f1 * f2;
    magnitude1 += f1 * f1;
    magnitude2 += f2 * f2;
  });
  
  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);
  
  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Check if a similar question was already asked and return the previous answer
 * @param {string} question - Current question
 * @param {Array} history - Conversation history
 * @param {number} similarityThreshold - Minimum similarity to consider a match (default 0.65)
 * @returns {object|null} Previous answer if found, null otherwise
 */
function findSimilarPreviousQuestion(question, history, similarityThreshold = 0.65) {
  if (!history || history.length === 0) return null;
  
  const normalizedQuestion = normalize(question);
  
  for (let i = history.length - 1; i >= 0; i--) {
    const exchange = history[i];
    if (exchange.user) {
      const normalizedPrevQuestion = normalize(exchange.user);
      const similarity = calculateTextSimilarity(normalizedQuestion, normalizedPrevQuestion);
      
      if (similarity >= similarityThreshold) {
        console.info(`[RAG] Found similar previous question with similarity ${similarity.toFixed(2)}`);
        return {
          previousQuestion: exchange.user,
          previousAnswer: exchange.bot,
          similarity: similarity
        };
      }
    }
  }
  
  return null;
}

/**
 * Get smart answer using LangChain RAG
 * @param {string} question - User question
 * @param {Array} context - Array of conversation history objects with user/bot properties
 * @param {Array} ragResults - Optional pre-fetched RAG results
 * @returns {Promise<string|null>} Answer or null if not available
 */
export async function smartAnswer(question, context = [], ragResults = null) {
  console.info(`[smartAnswer] Starting analysis for: "${question}"`);
  console.info(`[smartAnswer] Context has ${context.length} previous exchanges`);
  console.info(`[smartAnswer] RAG results provided: ${ragResults ? 'yes' : 'no'}`);

  console.debug('[RAG] Normalized question:', question);
  console.debug('[RAG] Using column:', kbConfig.embeddingColumnName);
  console.debug('[RAG] Context length:', context.length);

  // Check for greetings first - only if this is the first message
  if (context.length === 0 && /^(היי|שלום|צהריים|ערב טוב)/i.test(question.trim())) {
    console.debug('[RAG] Detected greeting - returning standard response');
    return "שלום! אני דוני, סוכן ביטוח דירות. שמח לעזור לך 😊 איך אוכל לעזור?";
  }

  try {
    // Build conversation history for prompt
    const conversationHistory = context.map(msg => `User: ${msg.user}\nBot: ${msg.bot}`).join('\n');
    
    // If we have context and no RAG results, check if this question relates to conversation memory
    if (context.length > 0 && !ragResults) {
      console.info('[smartAnswer] Checking if question relates to conversation memory...');
      
      const memoryCheckPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי.

בדוק את היסטוריית השיחה הבאה וקבע:
1. האם השאלה הנוכחית קשורה למשהו שנאמר בשיחה הקודמת?
2. האם יש בהיסטוריה מספיק מידע כדי לענות על השאלה?

אם התשובה לשתי השאלות היא כן, ענה על השאלה בהתבסס על ההיסטוריה.
אם לא, החזר בדיוק את הטקסט: "NO_CONTEXT_MATCH"

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}`;

      const messages = [
        { role: 'system', content: memoryCheckPrompt },
        { role: 'user', content: 'בדוק אם השאלה קשורה להיסטוריה וענה בהתאם.' }
      ];

      const response = await safeCall(() => llm.invoke(messages), { fallback: () => ({ content: 'NO_CONTEXT_MATCH' }) });
      const responseText = response.content.trim();
      
      if (responseText !== 'NO_CONTEXT_MATCH') {
        console.info('[smartAnswer] Question relates to conversation memory, returning context-based answer');
        return responseText;
      }
      
      console.info('[smartAnswer] Question does not relate to conversation memory');
      return null; // Signal to try RAG
    }
    
    // If RAG results were provided, use them to generate answer
    if (ragResults && ragResults.length > 0) {
      console.info('[smartAnswer] Using provided RAG results to generate answer');
      
      const ragContext = ragResults.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n');
      
      const ragPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי. דבר בעברית בגוף ראשון.

השתמש במידע הבא מהמאגר כדי לענות על השאלה:
${ragContext}

${conversationHistory ? `היסטוריית השיחה:\n${conversationHistory}\n` : ''}

שאלה: ${question}

ענה בצורה מקצועית, ידידותית ומקיפה בהתבסס על המידע מהמאגר.
אם המידע לא מספיק, השלם מהידע הכללי שלך על ביטוח דירות.`;

      const messages = [
        { role: 'system', content: ragPrompt },
        { role: 'user', content: 'ענה על השאלה בהתבסס על המידע מהמאגר.' }
      ];

      const response = await safeCall(() => llm.invoke(messages), { fallback: () => ({ content: 'מצטער, אני בודק וחוזר אליך מיד.' }) });
      return response.content.trim();
    }
    
    // No context and no RAG results - use general knowledge
    if (context.length === 0 && !ragResults) {
      console.info('[smartAnswer] No context or RAG results, using general knowledge');
      
      const generalPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי. דבר בעברית בגוף ראשון.

ענה על השאלה הבאה בצורה מקצועית וידידותית:
${question}

חשוב:
- אל תמציא נתונים ספציפיים או מחירים
- ענה בצורה כללית על סמך הידע הבסיסי על ביטוח דירות
- אם אינך בטוח, אמור "אצטרך לבדוק את הפרטים המדויקים"`;

      const messages = [
        { role: 'system', content: generalPrompt },
        { role: 'user', content: 'ענה על השאלה בצורה מקצועית.' }
      ];

      const response = await safeCall(() => llm.invoke(messages), { fallback: () => ({ content: 'מצטער, אני בודק וחוזר אליך מיד.' }) });
      return response.content.trim();
    }
    
    return null;
    
  } catch (error) {
    console.error('[smartAnswer] Error:', error);
    return null;
  }
}

/**
 * Merge answers with GPT-4o using custom system prompt
 * @param {Array} answerGroups - Array of {question, answers} objects
 * @param {string} originalQuestion - Original user question
 * @param {string} systemPrompt - System prompt with context
 * @returns {Promise<string>} Merged answer
 */
async function mergeAnswersWithGPTWithContext(answerGroups, originalQuestion, systemPrompt) {
  let contextBlock = '';
  let hasAnswers = false;
  
  for (const group of answerGroups) {
    if (group.answers && group.answers.length > 0) {
      contextBlock += `\nשאלה: ${group.question}\n`;
      contextBlock += `מידע רלוונטי:\n${group.answers.join('\n')}\n`;
      hasAnswers = true;
    } else {
      contextBlock += `\nשאלה: ${group.question}\n`;
      contextBlock += `מידע רלוונטי: אין מידע ספציפי במאגר - יש לענות מהידע הכללי\n`;
    }
  }

  const userPrompt = hasAnswers 
    ? `השאלה המקורית של הלקוח: ${originalQuestion}\n\nמידע שנמצא במאגר:\n${contextBlock}\n\nאנא תן תשובה מקיפה ומקצועית לשאלת הלקוח.`
    : `השאלה המקורית של הלקוח: ${originalQuestion}\n\nלא נמצא מידע ספציפי במאגר שלנו. אנא ענה מהידע הכללי שלך בצורה מקצועית ומקיפה.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ].filter(m => m && typeof m === 'object' && m.content);

  try {
    const response = await safeCall(() => llm.invoke(messages), { fallback: () => ({ content: 'מצטער, אני בודק וחוזר אליך מיד.' }) });
    return response.content.trim();
  } catch (error) {
    console.error('[LangChain] Error merging answers with GPT:', error);
    throw error;
  }
} 