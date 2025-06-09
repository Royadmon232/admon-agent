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
import { withTimeout } from '../utils/llmTimeout.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

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
  modelName: 'text-embedding-ada-002'
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
          contentColumnName: kbConfig.contentColumnName,
          metadataColumnName: null // Explicitly disable metadata
        },
        filter: {}, // Force embedding-only search with empty filter
        distanceStrategy: 'cosine' // Use cosine similarity for vector comparison
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
          scoreThreshold: 0.70
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

/**
 * Split questions if multiple questions are detected
 * @param {string} text - User input text
 * @returns {string[]} Array of individual questions
 */
function splitQuestions(text) {
  // Split by question marks, periods followed by capital letters, or common Hebrew question patterns
  const patterns = [
    /\?/g,
    /\./g,
    /\n/g,
    /ו(?=מה|איך|כמה|מתי|איפה|למה|האם)/g // Hebrew 'and' before question words
  ];
  
  let questions = [text];
  
  for (const pattern of patterns) {
    const newQuestions = [];
    for (const q of questions) {
      const splits = q.split(pattern).map(s => s.trim()).filter(s => s.length > 5);
      if (splits.length > 1) {
        newQuestions.push(...splits);
      } else {
        newQuestions.push(q);
      }
    }
    questions = newQuestions;
  }
  
  // Remove duplicates and empty strings
  return [...new Set(questions.filter(q => q && q.trim().length > 5))];
}

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
    const response = await withTimeout(
      llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]),
      20000
    );
    
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
 * Get smart answer using LangChain RAG
 * @param {string} question - User question
 * @param {Array} context - Array of conversation history objects with user/bot properties
 * @returns {Promise<string|null>} Answer or null if not available
 */
export async function smartAnswer(question, context = []) {
  if (!vectorStore) {
    console.warn('[LangChain] Vector store not initialized, skipping');
    return null;
  }

  console.debug('[RAG] Normalized question:', question);
  console.debug('[RAG] Using column:', kbConfig.embeddingColumnName);
  console.debug('[RAG] Context length:', context.length);

  // Check for greetings first - only if this is the first message
  if (context.length === 0 && /^(היי|שלום|צהריים|ערב טוב)/i.test(question.trim())) {
    console.debug('[RAG] Detected greeting - returning standard response');
    return "שלום! אני דוני, סוכן ביטוח דירות. איך אוכל לעזור?";
  }

  try {
    // Build conversation history for prompt
    const conversationHistory = context.map(msg => `User: ${msg.user}\nBot: ${msg.bot}`).join('\n');
    
    // Check if this is a follow-up question using GPT-4o
    const contextCheckPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי.
השתמש בהיסטוריית השיחה הבאה כדי לקבוע אם השאלה הנוכחית היא המשך לשיחה קודמת.
אם המשתמש שואל שאלת המשך (למשל "תסביר שוב"), ענה בהתבסס על ההקשר הקודם.
אם המשתמש שואל משהו חדש, התעלם מהקשר והפעל חיפוש וקטורי כרגיל.

חשוב:
- אל תחזור על מידע שכבר נאמר בשיחה
- אל תציג את עצמך שוב אם כבר הצגת את עצמך
- השתמש בשפה טבעית ומקצועית
- דבר בגוף ראשון
- הימנע מלומר שאתה בוט או AI

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}
`;

    // First, check if this is a follow-up question
    const isFollowUp = await isFollowUpQuestion(question, context);
    
    if (isFollowUp && context.length > 0) {
      // Follow-up detected - answer directly using context only
      console.info('[RAG] Follow-up question detected, using context only');
      
      const messages = [
        { role: 'system', content: contextCheckPrompt },
        { role: 'user', content: 'ענה על השאלה הנוכחית בהתבסס על ההיסטוריה. תן תשובה מקיפה בעברית.' }
      ].filter(m => m && typeof m === 'object' && m.content);

      const response = await withTimeout(
        llm.invoke(messages),
        20000
      );
      
      console.debug('[RAG] Generated follow-up response');
      return response.content.trim();
    }

    // Not a clear follow-up, proceed with vector search
    console.info('[RAG] Running vector search...');
    
    // Split questions if multiple detected
    const questions = splitQuestions(question);
    console.info(`[RAG] Processing ${questions.length} question(s)`);

    // Process each question with timeout protection
    let answerGroups = [];
    let foundAnswers = false;
    
    for (const q of questions) {
      try {
        const query = normalize(q);
        // First attempt with higher threshold
        let results = await withTimeout(
          vectorStore.similaritySearchWithScore(
            normalize(q),
            15,
            { scoreThreshold: 0.70 }
          ),
          5000
        );
        
        // If no results or low scores, try second attempt with lower threshold
        if (results.length === 0 || results[0][1] > 0.3) {
          console.debug('[RAG] First attempt failed, trying with lower threshold...');
          results = await withTimeout(
            vectorStore.similaritySearchWithScore(
              normalize(q),
              15,
              { scoreThreshold: 0.60 }
            ),
            5000
          );
        }
        
        // Log raw scores for debugging
        console.debug(`[RAG] Raw scores for "${q}":`, results.map(([doc, score]) => score.toFixed(4)));
        
        const answers = results
          .map(([doc, score]) => {
            const content = doc.pageContent || doc.content || '';
            console.debug(`[RAG] Match found - similarity: ${(1 - score).toFixed(4)}, content: ${content.slice(0, 50)}...`);
            return content;
          })
          .filter(answer => answer && answer.trim().length > 0);
        
        if (answers.length > 0) {
          foundAnswers = true;
          console.debug(`[RAG] Found ${answers.length} matches for question: ${q}`);
        } else {
          console.debug(`[RAG] No matches found for question: ${q}`);
        }
        
        answerGroups.push({
          question: q,
          answers: answers
        });
      } catch (error) {
        console.error(`[RAG] Error processing question "${q}":`, error);
        answerGroups.push({
          question: q,
          answers: []
        });
      }
    }

    // If no answers found, let GPT-4o answer directly
    if (!foundAnswers) {
      console.info('[RAG] No matches found, letting GPT-4o answer directly...');
      
      const gptPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי. אתה מדבר בעברית בגוף ראשון ומשתמש בסגנון שיווקי-ייעוצי.

${context.length === 0 ? 'התחל את התשובה במילים: "שלום! אני דוני, סוכן ביטוח דירות..."' : 'המשך את השיחה באופן טבעי, בלי להציג את עצמך שוב.'}

השתמש בסגנון שיווקי-ייעוצי:
- הדגש את היתרונות והכיסויים האופציונליים
- השתמש בשפה משכנעת אך מקצועית
- הצג את עצמך כמומחה בתחום ביטוח הדירות
- השתמש בשפה אישית ונעימה
- הדגש את הערך והביטחון שהלקוח מקבל
- הימנע מחזרה על מידע שכבר נאמר בשיחה
- אל תציג את עצמך כבוט או AI - אתה סוכן ביטוח אמיתי

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}

אנא תן תשובה מקיפה ומקצועית לשאלת הלקוח, תוך שימוש בידע הכללי שלך על ביטוח דירות.`;

      const messages = [
        { role: 'system', content: gptPrompt },
        { role: 'user', content: 'ענה על השאלה בצורה מקצועית ומקיפה.' }
      ].filter(m => m && typeof m === 'object' && m.content);

      const response = await withTimeout(
        llm.invoke(messages),
        20000
      );
      
      return response.content.trim();
    }

    // Merge answers with GPT-4o
    const systemPromptForMerge = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי. אתה מדבר בעברית בגוף ראשון ומשתמש בסגנון שיווקי-ייעוצי.

${context.length === 0 ? 'התחל את התשובה במילים: "שלום! אני דוני, סוכן ביטוח דירות..."' : 'המשך את השיחה באופן טבעי, בלי להציג את עצמך שוב.'}

השתמש בסגנון שיווקי-ייעוצי:
- הדגש את היתרונות והכיסויים האופציונליים
- השתמש בשפה משכנעת אך מקצועית
- הצג את עצמך כמומחה בתחום ביטוח הדירות
- השתמש בשפה אישית ונעימה
- הדגש את הערך והביטחון שהלקוח מקבל
- הימנע מחזרה על מידע שכבר נאמר בשיחה
- אל תציג את עצמך כבוט או AI - אתה סוכן ביטוח אמיתי

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}

נמצאו תשובות רלוונטיות במאגר. שלב אותן לתשובה מקיפה תוך שימוש בסגנון שיווקי-ייעוצי.`;

    const mergedAnswer = await withTimeout(
      mergeAnswersWithGPTWithContext(answerGroups, question, systemPromptForMerge),
      20000
    );
    
    console.info('[RAG] Smart answer generated');
    console.debug('[RAG] Response path:', foundAnswers ? 'langchain' : 'fallback');
    return mergedAnswer;
    
  } catch (error) {
    console.error('[RAG] Error in smartAnswer:', error);
    throw error;
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
    const response = await withTimeout(
      llm.invoke(messages),
      20000
    );
    return response.content.trim();
  } catch (error) {
    console.error('[LangChain] Error merging answers with GPT:', error);
    throw error;
  }
} 