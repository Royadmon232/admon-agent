import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalize } from '../utils/normalize.js';
import { getEmbedding } from '../utils/embeddingUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const KNOWLEDGE_FILE_PATH = path.join(__dirname, '../insurance_knowledge.json');
const EMBEDDING_VECTOR_DIMENSION = 1536; // text-embedding-3-small produces 1536 dimensions

async function seedEmbeddings() {
  let client;
  try {
    client = await pool.connect();
    console.log('Successfully connected to the database.');

    // PHASE-2: Create extension and table
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`CREATE TABLE IF NOT EXISTS insurance_qa(
        id SERIAL PRIMARY KEY,
        question TEXT,
        answer   TEXT,
        embedding vector(1536)
    );`);
    console.log('[seed] table ready');

    // Load insurance knowledge base
    const rawData = await fs.readFile(KNOWLEDGE_FILE_PATH, 'utf8');
    const knowledgeBase = JSON.parse(rawData);
    const qas = knowledgeBase.insurance_home_il_qa; // Assuming this is the array of Q&A pairs

    if (!qas || !Array.isArray(qas)) {
      console.error('Could not find Q&A array in insurance_knowledge.json');
      return;
    }

    let rowsInserted = 0;
    for (const qa of qas) {
      const originalQuestion = qa.question;
      const answer = qa.answer;

      if (!originalQuestion || !answer) {
        console.warn('Skipping QA item due to missing question or answer:', qa);
        continue;
      }

      // Check if question already exists (using original question text)
      const checkQuery = 'SELECT id FROM insurance_qa WHERE question = $1';
      const { rows: existingRows } = await client.query(checkQuery, [originalQuestion]);

      if (existingRows.length > 0) {
        // console.log(`Question already exists, skipping: "${originalQuestion.substring(0,50)}..."`);
        continue;
      }

      // Normalize and get embedding
      const normalizedQuestion = normalize(originalQuestion);
      const embedding = await getEmbedding(normalizedQuestion);

      if (!embedding) {
        console.warn(`Could not generate embedding for question: "${originalQuestion.substring(0,50)}...", skipping.`);
        continue;
      }

      // Insert new QA
      const insertQuery = `
        INSERT INTO insurance_qa (question, answer, embedding)
        VALUES ($1, $2, $3)
        RETURNING id;
      `;
      await client.query(insertQuery, [originalQuestion, answer, embedding]);
      rowsInserted++;
      console.log(`Inserted: \"${originalQuestion.substring(0,50)}...\"`);
    }

    console.log(`
✅ Seeding complete.
Total Q&A items in JSON: ${qas.length}
New rows inserted into database: ${rowsInserted}
    `);

  } catch (error) {
    console.error('Error during embedding generation and seeding:', error);
  } finally {
    if (client) {
      await client.release();
      console.log('Database client released.');
    }
    await pool.end();
    console.log('Database pool closed.');
  }
}

seedEmbeddings(); 