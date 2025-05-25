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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Log successful connection
pool.on('connect', () => {
  console.info('✅ LangChain DB connection established using external DATABASE_URL');
});

function buildContext(memory) {
  let ctx = '';
  if (memory.firstName) ctx += ` לקוח בשם ${memory.firstName}.`;
  if (memory.city) ctx += ` גר בעיר ${memory.city}.`;
  if (memory.homeValue) ctx += ` ערך דירתו ${memory.homeValue}₪.`;
  return ctx;
}

export async function lookupRelevantQAs(userQuestion, topK = 8, minScore = 0.60, memory = {}) {
  const context = buildContext(memory);
  console.info("[Context built]:", context);
  const emb = await getEmbedding(normalize(userQuestion + context));
  try {
    const { rows } = await pool.query(
      `SELECT question, answer, 1 - (embedding <=> $1) AS score
       FROM insurance_qa ORDER BY embedding <=> $1 LIMIT $2`, [JSON.stringify(emb), topK]);
    return rows.filter(r => r.score >= minScore);
  } catch (err) {
    if (err.code === '42P01') { // undefined_table error
      return [];
    }
    throw err; // Re-throw other errors
  }
}
// PHASE-1 END 