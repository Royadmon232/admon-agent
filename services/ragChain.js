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
import { withTimeout } from '../utils/llmTimeout.js';
import { splitQuestions } from '../utils/splitQuestions.js';
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
    const questionEmbedding = await embeddings.embedTextQuery(question);
    
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
    const response = await withTimeout(llm.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]), 20000);
    
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
 * @returns {Promise<string|null>} Answer or null if not available
 */
export async function smartAnswer(question, context = []) {
  console.info(`[smartAnswer] Starting analysis for: "${question}"`);
  console.info(`[smartAnswer] Context has ${context.length} previous exchanges`);

  console.debug('[RAG] Normalized question:', question);
  console.debug('[RAG] Using column:', kbConfig.embeddingColumnName);
  console.debug('[RAG] Context length:', context.length);

  // Check for greetings first - only if this is the first message
  if (context.length === 0 && /^(היי|שלום|צהריים|ערב טוב)/i.test(question.trim())) {
    console.debug('[RAG] Detected greeting - returning standard response');
    return "שלום! אני דוני, סוכן ביטוח דירות. שמח לעזור לך איך אוכל לעזור?";
  }

  // Check if question is out of scope
  const insuranceKeywords = ['ביטוח', 'פוליסה', 'כיסוי', 'דירה', 'נזק', 'תביעה', 'פרמיה', 'השתתפות'];
  const hasInsuranceContext = insuranceKeywords.some(keyword => question.includes(keyword));

  // If the message is clearly unrelated to insurance (small-talk, chit-chat, etc.) and there is no prior context,
  // let GPT-4o answer naturally instead of refusing.
  if (!hasInsuranceContext && context.length === 0) {
    console.info('[RAG] Detected small-talk / out-of-domain question – using GPT-4o friendly fallback');

    const messages = [
      new SystemMessage(`אתה נציג שירות מקצועי ונעים של חברת ביטוח.
      עליך לענות בצורה ידידותית ומקצועית לשאלות כלליות.
      אם השאלה לא קשורה לביטוח, ענה בצורה נעימה והצג את עצמך כנציג שירות.
      שמור על טון מקצועי אך ידידותי.
      תמיד סיים בהצעת עזרה בנושא ביטוח.`),
      new HumanMessage(question)
    ];

    try {
      const response = await withTimeout(llm.call(messages), 20000);
      return response.content.trim();
    } catch (err) {
      console.error('[RAG] GPT-4o fallback error:', err);
      // In worst-case, still provide graceful reply
      return 'הכל מצוין, תודה על ההתעניינות! איך אוכל לעזור לך בנושא ביטוח הדירה? 😊';
    }
  }

  try {
    // First check if this exact or similar question was already asked
    const similarPrevious = findSimilarPreviousQuestion(question, context);
    if (similarPrevious) {
      console.info('[RAG] Found similar previous question!');
      console.info(`[RAG] Previous Q: "${similarPrevious.previousQuestion}"`);
      console.info(`[RAG] Similarity: ${similarPrevious.similarity.toFixed(2)}`);
      console.info('[RAG] Reusing previous answer');
      return similarPrevious.previousAnswer;
    }
    
    // Build conversation history for prompt
    const conversationHistory = context.map(msg => `User: ${msg.user}\nBot: ${msg.bot}`).join('\n');
    
    // Check if this is a follow-up question using GPT-4o
    const contextCheckPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי.
השתמש בהיסטוריית השיחה הבאה כדי לקבוע אם השאלה הנוכחית היא המשך לשיחה קודמת.
אם המשתמש שואל שאלת המשך (למשל "תסביר שוב"), ענה בהתבסס על ההקשר הקודם.
אם המשתמש שואל משהו חדש, התעלם מהקשר והפעל חיפוש וקטורי כרגיל.

חשוב:
- אל תחזור על מידע שכבר נאמר בשיחה
- אל תציג את עצמך שוב אם כבר הצגת את עצמך
- השתמש בשפה טבעית, חמה ומקצועית
- דבר בגוף ראשון
- פנה ללקוח בשמו אם ידוע
- הפגן אמפתיה ודאגה
- הימנע מלומר שאתה בוט או AI

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}
`;

    // First, check if this is a follow-up question
    const isFollowUp = await isFollowUpQuestion(question, context);
    console.info(`[RAG] Is follow-up question: ${isFollowUp}`);
    
    if (isFollowUp && context.length > 0) {
      // Follow-up detected - answer directly using context only
      console.info('[RAG] Follow-up question detected, using context only');
      
      const messages = [
        { role: 'system', content: contextCheckPrompt },
        { role: 'user', content: 'ענה על השאלה הנוכחית בהתבסס על ההיסטוריה. תן תשובה מקיפה בעברית.' }
      ].filter(m => m && typeof m === 'object' && m.content);

      const response = await withTimeout(llm.call(messages), 20000);
      
      console.debug('[RAG] Generated follow-up response');
      return response.content.trim();
    }

    // Not a clear follow-up, proceed with vector search
    console.info('[RAG] Running vector search...');
    
    // Correctly await the async splitQuestions helper
    const questions = await splitQuestions(question);
    console.info(`[RAG] Processing ${questions.length} question(s)`);

    // Process each question with timeout protection
    let answerGroups = [];
    let foundAnswers = false;
    
    for (const q of questions) {
      try {
        const query = normalize(q);
        
        // Use direct DB search to get answers
        let results = await searchInsuranceQA(query, 15, 0.65);
        
        // If no results, try with lower threshold
        if (results.length === 0) {
          console.debug('[RAG] First attempt failed, trying with lower threshold...');
          results = await searchInsuranceQA(query, 15, 0.60);
        }
        
        // If still no results, mark as no match
        if (results.length === 0) {
          console.info('[RAG] No matches found even with lower threshold');
          continue;
        }
        
        // Log results for debugging
        console.debug(`[RAG] Found ${results.length} matches for "${q}"`);
        results.forEach(r => {
          console.debug(`[RAG] Match - similarity: ${r.similarity.toFixed(4)}, Q: ${r.question.slice(0, 50)}...`);
        });
        
        // Extract answers
        const answers = results
          .map(result => {
            const cleaned = result.answer
              .replace(/למידע נוסף צור קשר/g, '')
              .replace(/לפרטים נוספים/g, '')
              .replace(/\s{2,}/g, ' ')
              .trim();
            
            if (cleaned.length < 20) return null; // Too short to be useful
            
            return cleaned;
          })
          .filter(answer => answer && answer.trim().length > 0);
        
        if (answers.length > 0) {
          foundAnswers = true;
          console.debug(`[RAG] Found ${answers.length} matches for question: ${q}`);
        } else {
          console.debug(`[RAG] No useful matches found for question: ${q}`);
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

    // If no answers found, let GPT-4o answer with strict instructions
    if (!foundAnswers) {
      console.info('[RAG] No matches found in knowledge base');
      console.info('[RAG] Using GPT-4o to generate answer from general knowledge...');
      
      const gptPrompt = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי. אתה מדבר בעברית בגוף ראשון ומשתמש בסגנון שיווקי-ייעוצי חם ואישי.

${context.length === 0 ? 'התחל את התשובה במילים: "שלום! אני דוני, סוכן ביטוח דירות. שמח לעזור לך 😊"' : 'המשך את השיחה באופן טבעי, בלי להציג את עצמך שוב.'}

חשוב מאוד:
- לא נמצא מידע ספציפי במאגר שלנו לגבי השאלה
- אל תמציא נתונים או מספרים ספציפיים
- ענה בצורה כללית בלבד על סמך הידע הבסיסי על ביטוח דירות
- אם אינך בטוח, אמור "אצטרך לבדוק את הפרטים המדויקים"
- הימנע ממתן מחירים, אחוזים או נתונים ספציפיים

השתמש בסגנון שיווקי-ייעוצי חם:
- הדגש את היתרונות והכיסויים תוך הפגנת אכפתיות
- השתמש בשפה משכנעת אך נעימה ומכבדת
- הצג את עצמך כמומחה שדואג באמת לביטחון הלקוח
- השתמש בשפה אישית וחמה
- הדגש את הערך והביטחון שהלקוח מקבל ("השקעה קטנה היום תחסוך לך דאגות רבות")
- הימנע מחזרה על מידע שכבר נאמר בשיחה
- אל תציג את עצמך כבוט או AI - אתה סוכן ביטוח אמיתי
- השתמש באימוג'י במקומות מתאימים בלבד (😊 לחיזוק חיובי, 👍 לאישור)
- בסוף התשובה, הוסף קריאה לפעולה אם מתאים ("האם תרצה שאכין לך הצעת מחיר מותאמת?")

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}

אנא תן תשובה כללית ומקצועית, ללא נתונים ספציפיים.`;

      const messages = [
        { role: 'system', content: gptPrompt },
        { role: 'user', content: 'ענה על השאלה בצורה מקצועית ומקיפה.' }
      ].filter(m => m && typeof m === 'object' && m.content);

      const response = await withTimeout(llm.invoke(messages), 20000);
      
      return response.content.trim();
    }

    // Merge answers with GPT-4o
    const systemPromptForMerge = `
אתה דוני, סוכן ביטוח דירות וירטואלי מקצועי ואישי. אתה מדבר בעברית בגוף ראשון ומשתמש בסגנון שיווקי-ייעוצי חם.

${context.length === 0 ? 'התחל את התשובה במילים: "שלום! אני דוני, סוכן ביטוח דירות. שמח לעזור לך 😊"' : 'המשך את השיחה באופן טבעי, בלי להציג את עצמך שוב.'}

השתמש בסגנון שיווקי-ייעוצי חם:
- הדגש את היתרונות והכיסויים תוך הפגנת אכפתיות
- השתמש בשפה משכנעת אך נעימה ומכבדת
- הצג את עצמך כמומחה שדואג באמת לביטחון הלקוח
- השתמש בשפה אישית וחמה
- הדגש את הערך והביטחון שהלקוח מקבל ("השקעה קטנה היום תחסוך לך דאגות רבות")
- הימנע מחזרה על מידע שכבר נאמר בשיחה
- אל תציג את עצמך כבוט או AI - אתה סוכן ביטוח אמיתי
- השתמש באימוג'י במקומות מתאימים בלבד (😊 לחיזוק חיובי, 👍 לאישור)
- בסוף התשובה, הוסף קריאה לפעולה אם מתאים ("האם תרצה שאכין לך הצעת מחיר מותאמת?")

היסטוריית השיחה:
${conversationHistory}

שאלה נוכחית: ${question}

נמצאו תשובות רלוונטיות במאגר. שלב אותן לתשובה מקיפה תוך שימוש בסגנון שיווקי-ייעוצי חם וקריאה לפעולה בסוף.`;

    const mergedAnswer = await mergeAnswersWithGPTWithContext(answerGroups, question, systemPromptForMerge);
    
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
    const response = await withTimeout(llm.invoke(messages), 20000);
    return response.content.trim();
  } catch (error) {
    console.error('[LangChain] Error merging answers with GPT:', error);
    throw error;
  }
} 