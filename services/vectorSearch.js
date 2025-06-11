/* === CURSOR BACKUP START (2024-03-21) ===
import { normalize } from '../utils/normalize.js';
import { getEmbedding } from '../utils/embeddingUtils.js';
import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function lookupRelevantQAs(userQuestion, topK = 8, minScore = 0.80) {
  const emb = await getEmbedding(normalize(userQuestion));
  const { rows } = await pool.query(
    `SELECT question, answer, 1 - (embedding <=> $1) AS score
     FROM insurance_qa ORDER BY embedding <=> $1 LIMIT $2`, [emb, topK]);
  return rows.filter(r => r.score >= minScore);
} 
=== CURSOR BACKUP END === */

// PHASE-1 BEGIN
import { normalize } from '../utils/normalize.js';
import { getEmbedding } from '../utils/embeddingUtils.js';
import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Log successful connection
pool.on('connect', () => {
  const sslMode = process.env.NODE_ENV === 'production' ? 'with SSL verification' : 'with SSL (verification disabled)';
  console.info(`✅ LangChain DB connection established using external DATABASE_URL ${sslMode}`);
});

// Handle connection errors
pool.on('error', (err) => {
  console.error('[vectorSearch] ⚠️  Unexpected error on idle client:', err);
  process.exit(-1); // Exit on critical DB errors
});

/**
 * Build context from memory
 * @param {object} memory - User memory object
 * @returns {string} Context string
 */
function buildContext(memory) {
  let ctx = '';
  if (memory.firstName) ctx += ` לקוח בשם ${memory.firstName}.`;
  if (memory.city) ctx += ` גר בעיר ${memory.city}.`;
  if (memory.homeValue) ctx += ` ערך דירתו ${memory.homeValue}₪.`;
  return ctx;
}

/**
 * Filter and deduplicate results
 * @param {Array} results - Array of search results
 * @param {number} minScore - Minimum similarity score
 * @returns {Array} Filtered results
 */
function filterResults(results, minScore) {
  // First filter by score
  const scoredResults = results.filter(r => r.score >= minScore);
  
  // If we have very few high-scoring results, include some lower-scoring ones
  if (scoredResults.length < 2 && results.length > 0) {
    const topResults = results.slice(0, 2);
    return topResults.filter(r => r.score >= minScore * 0.9); // Allow slightly lower scores
  }
  
  // Deduplicate similar answers
  const uniqueResults = [];
  const seenAnswers = new Set();
  
  for (const result of scoredResults) {
    const normalizedAnswer = normalize(result.answer);
    let isDuplicate = false;
    
    // Check if this answer is too similar to any we've seen
    for (const seenAnswer of seenAnswers) {
      if (similarity(normalizedAnswer, seenAnswer) > 0.9) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueResults.push(result);
      seenAnswers.add(normalizedAnswer);
    }
  }
  
  return uniqueResults;
}

/**
 * Calculate similarity between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1)
 */
function similarity(str1, str2) {
  const set1 = new Set(str1.split(/\s+/));
  const set2 = new Set(str2.split(/\s+/));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// Lower default minimum score
const DEFAULT_MIN_SCORE = 0.70;

/**
 * Look up relevant Q&A pairs from the database
 * @param {string} userQuestion - User's question
 * @param {number} topK - Number of results to return
 * @param {number} minScore - Minimum similarity score
 * @param {object} memory - User memory object
 * @returns {Promise<Array>} Array of relevant Q&A pairs
 */
export async function lookupRelevantQAs(userQuestion, topK = 8, minScore = DEFAULT_MIN_SCORE, memory = {}) {
  const context = buildContext(memory);
  console.info("[Context built]:", context);
  
  try {
    // Get embedding for the question with context
    const emb = await getEmbedding(normalize(userQuestion + context));
    
    // Query the database with a higher limit to allow for filtering
    const { rows } = await pool.query(
      `WITH ranked_results AS (
        SELECT 
          question,
          answer,
          metadata,
          1 - (embedding <=> $1) AS score,
          ROW_NUMBER() OVER (PARTITION BY metadata->>'original_question' ORDER BY 1 - (embedding <=> $1) DESC) as rn
        FROM insurance_qa 
        ORDER BY embedding <=> $1 
        LIMIT $2 * 2
      )
      SELECT question, answer, metadata, score
      FROM ranked_results
      WHERE rn = 1
      ORDER BY score DESC`,
      [JSON.stringify(emb), topK * 2]
    );
    
    // Filter and deduplicate results
    const filteredResults = filterResults(rows, minScore);
    
    // Log retrieval details
    console.info(`[RAG] Retrieved ${rows.length} results, filtered to ${filteredResults.length}`);
    console.info('[RAG] Top matches:', 
      filteredResults.slice(0, 3).map(r => ({ 
        q: r.question.slice(0,40)+'…', 
        score: r.score.toFixed(2),
        chunk: r.metadata?.chunk_index + '/' + r.metadata?.total_chunks
      }))
    );
    
    return filteredResults;
  } catch (err) {
    if (err.code === '42P01') { // undefined_table error
      console.warn('[RAG] Table not found, returning empty results');
      return [];
    }
    console.error('[RAG] Error during lookup:', err);
    throw err;
  }
}

export async function searchSimilarChunks(query, options = {}) {
  const {
    minScore = DEFAULT_MIN_SCORE,
    limit = 5,
    tableName = 'insurance_kb',
    embeddingColumn = 'embedding',
    contentColumn = 'content'
  } = options;

  try {
    // First attempt with specified minScore
    const rows = await searchWithScore(query, {
      tableName,
      embeddingColumn,
      contentColumn,
      limit: limit * 2 // Get more results for filtering
    });

    // Filter by score
    let filteredRows = rows.filter(row => row.score >= minScore);

    // If no results, retry with lower threshold
    if (filteredRows.length === 0) {
      console.log('[RAG] second-pass search with lower threshold');
      const retryRows = await searchWithScore(query, {
        tableName,
        embeddingColumn,
        contentColumn,
        limit: limit * 2
      });
      filteredRows = retryRows.filter(row => row.score >= 0.60);
    }

    // Return top N results
    return filteredRows.slice(0, limit);
  } catch (error) {
    console.error('[VectorSearch] Error in searchSimilarChunks:', error);
    throw error;
  }
}
// PHASE-1 END 