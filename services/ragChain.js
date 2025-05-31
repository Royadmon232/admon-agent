import { ConversationalRetrievalQAChain } from 'langchain/chains';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  ConversationSummaryBufferMemory
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
let summaryMemory = null;  // Simple memory for conversation context

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

    // Initialize simple summary memory
    summaryMemory = new ConversationSummaryBufferMemory({
      llm,
      maxTokenLimit: 1200,
      memoryKey: 'chat_history',
      inputKey: 'question',
      outputKey: 'text'
    });

    // Custom retriever that matches fallback behavior exactly
    const customRetriever = {
      async getRelevantDocuments(query) {
        // Get top-k=8 results
        const results = await vectorStore.similaritySearchWithScore(query, 8);
        
        // Filter by score threshold 0.80 (matching fallback's minScore)
        const filteredResults = results.filter(([doc, score]) => score >= 0.80);
        
        // Log for debugging (matching fallback's logging style)
        if (filteredResults.length > 0) {
          console.log('[RAG] top matches:', 
            filteredResults.map(([doc, score]) => ({ 
              q: doc.pageContent.slice(0, 40) + '…', 
              score: score.toFixed(2) 
            }))
          );
        } else {
          console.log('[RAG] no KB match → fallback');
        }
        
        // Return just the documents
        return filteredResults.map(([doc, _]) => doc);
      }
    };

    // Create the conversational retrieval chain
    chain = ConversationalRetrievalQAChain.fromLLM(
      llm,
      customRetriever,
      {
        memory: summaryMemory,
        prompt,
        returnSourceDocuments: true,
        verbose: false,
        questionGeneratorTemplate:
          "Use the conversation summary to build one refined search query.\nSummary: {chat_history}\nQuestion: {question}"
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

/* ----- helper: split incoming Hebrew/English text into max-5 questions ----- */
function splitQuestions(text) {
  return text
    .split(/[?؟]|[\n\.](?=\s*[^.\n]+[?؟])/g)   // detect ? or line-break+punc
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 5);                              // safety cap at 5
}

/* ----- helper: Use GPT-4o to intelligently detect and split questions ----- */
async function intelligentQuestionSplit(text) {
  try {
    const response = await llm.call([new HumanMessage(`
נתח את הטקסט הבא וזהה את כל השאלות הנפרדות שבו.
החזר רשימה של שאלות נקיות ומדויקות.
אם יש רק שאלה אחת, החזר אותה ברשימה.
אל תוסיף שאלות שלא נשאלו.

טקסט:
${text}

פורמט תשובה:
1. [שאלה ראשונה]
2. [שאלה שנייה]
...
`)]);
    
    // Parse the response to extract questions
    const content = response.content.trim();
    const questions = content
      .split(/\n/)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    
    return questions.length > 0 ? questions : [text];
  } catch (err) {
    console.error('[GPT-4o] Error in question splitting:', err.message);
    // Fallback to simple splitting
    return splitQuestions(text);
  }
}
/* -------------------------------------------------------------------------- */

/**
 * Get smart answer using LangChain RAG
 * @param {string} text - User question
 * @param {object} memory - User memory context
 * @returns {Promise<string|null>} Answer or null if not available
 */
export async function smartAnswer(text, memory = {}) {
  if (!chain || !vectorStore) {
    console.warn('[LangChain] Chain or vectorStore not initialized, skipping');
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

    /* Step 0: Use GPT-4o to intelligently detect and split questions */
    const questions = await intelligentQuestionSplit(fullText);
    console.info(`[GPT-4o] Detected ${questions.length} question(s)`);
    
    const answersData = [];

    /* Step 1-3: Query vector store for each sub-question (topK=8, score ≥ 0.80) */
    for (const q of questions) {
      try {
        // Get top-k=8 results for this specific question
        const results = await vectorStore.similaritySearchWithScore(q, 8);
        
        // Filter by score threshold 0.80 (matching fallback's minScore)
        const filteredResults = results.filter(([doc, score]) => score >= 0.80);
        
        if (filteredResults.length > 0) {
          // Sort by score in descending order to get the highest match first
          filteredResults.sort((a, b) => b[1] - a[1]);
          
          console.log(`[RAG] Found match for "${q.slice(0, 30)}..."`, 
            filteredResults[0][1].toFixed(2));
          
          // Extract the answer from the best match (highest similarity)
          const bestMatch = filteredResults[0][0];
          const content = bestMatch.pageContent;
          // Extract answer part after "A:" or "תשובה:"
          const answerMatch = content.match(/(?:A:|תשובה:)\s*(.+)/s);
          const answer = answerMatch ? answerMatch[1].trim() : content;
          
          answersData.push({
            question: q,
            answer: answer,
            hasVectorAnswer: true,
            similarity: filteredResults[0][1]
          });
        } else {
          console.log(`[RAG] No match for "${q.slice(0, 30)}..." (below 0.80 threshold)`);
          answersData.push({
            question: q,
            answer: null,
            hasVectorAnswer: false,
            similarity: 0
          });
        }
      } catch (err) {
        console.error(`[RAG] Error querying for "${q.slice(0, 30)}...":`, err.message);
        answersData.push({
          question: q,
          answer: null,
          hasVectorAnswer: false,
          similarity: 0
        });
      }
    }

    /* Step 4: Use GPT-4o to merge answers and fill gaps with chat memory context */
    try {
      // Get current chat history for context
      let chatContext = '';
      try {
        // Access chat history from memory buffer
        const memoryVariables = await summaryMemory.chatHistory.getMessages();
        if (memoryVariables && memoryVariables.length > 0) {
          chatContext = '\n\nהיסטוריית שיחה אחרונה:\n';
          memoryVariables.slice(-4).forEach((msg) => { // Last 2 exchanges
            if (msg._getType() === 'human') {
              chatContext += `לקוח: ${msg.content}\n`;
            } else if (msg._getType() === 'ai') {
              chatContext += `סוכן: ${msg.content}\n`;
            }
          });
        }
      } catch (memErr) {
        // If we can't get chat history, continue without it
        console.debug('[Memory] Could not retrieve chat history:', memErr.message);
      }
      
      let mergePrompt = `אתה דוני, סוכן ביטוח דירות מקצועי וידידותי.
צור תשובה אחת מקיפה ומקצועית בעברית שמשלבת את כל המידע הבא.
${chatContext}
`;
      
      // Add user context if available
      if (context) {
        mergePrompt += `\nפרטי הלקוח:${context}\n\n`;
      }
      
      // Add questions and answers, sorted by similarity score
      answersData
        .sort((a, b) => b.similarity - a.similarity)
        .forEach(data => {
          mergePrompt += `שאלה: ${data.question}\n`;
          if (data.hasVectorAnswer) {
            mergePrompt += `תשובה ממאגר הידע (דמיון: ${(data.similarity * 100).toFixed(1)}%): ${data.answer}\n\n`;
          } else {
            mergePrompt += `תשובה ממאגר הידע: לא נמצאה תשובה רלוונטית (דמיון < 80%) - ענה מהידע הכללי שלך\n\n`;
          }
        });
      
      mergePrompt += `
הנחיות חשובות:
1. אם הלקוח מבקש לחזור על משהו או מתייחס לתשובה קודמת, השתמש בהיסטוריית השיחה
2. שלב את כל התשובות לתשובה אחת קוהרנטית וזורמת
3. עבור שאלות ללא תשובה ממאגר הידע - ענה מהידע שלך על ביטוח דירות
4. השתמש בטון מקצועי, ידידותי ומשווק
5. התשובה צריכה להיות טבעית ולא להזכיר שהיו מספר שאלות
6. אורך מקסימלי: 250 מילים

צור תשובה מקצועית ומלאה:`;

      const merged = await llm.call([new HumanMessage(mergePrompt)]);
      const finalAnswer = merged.content.trim();
      
      if (finalAnswer) {
        console.info("[LangChain] Smart answer generated with GPT-4o enhancement and chat memory");
        
        // Save to memory for future context
        await summaryMemory.saveContext(
          { question: text },
          { text: finalAnswer }
        );
        
        return finalAnswer;
      }
      
      // Fallback if merge failed
      return null;
      
    } catch (err) {
      console.error('[GPT-4o] Error merging answers:', err.message);
      
      // Fallback: try to return any available answer
      const firstAnswer = answersData.find(d => d.hasVectorAnswer)?.answer;
      if (firstAnswer) {
        // Save to memory even for fallback
        await summaryMemory.saveContext(
          { question: text },
          { text: firstAnswer }
        );
        return firstAnswer;
      }
      
      return null;
    }

  } catch (error) {
    console.error('[LangChain] Error generating smart answer:', error.message);
    return null;
  }
}

// Export entity memory for controller use
export { summaryMemory }; 