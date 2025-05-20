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