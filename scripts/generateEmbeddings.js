import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalize } from '../utils/normalize.js';
import { getEmbedding } from '../utils/embeddingUtils.js';
import pool from '../utils/dbPool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGE_FILE_PATH = path.join(__dirname, '../insurance_knowledge.json');
const EMBEDDING_VECTOR_DIMENSION = 1536; // text-embedding-3-small produces 1536 dimensions
const MIN_CHUNK_LENGTH = 50; // Minimum characters for a meaningful chunk
const MAX_CHUNK_LENGTH = 500; // Maximum characters per chunk

/**
 * Split text into meaningful chunks
 * @param {string} text - Text to split
 * @returns {string[]} Array of text chunks
 */
function splitIntoChunks(text) {
  // First split by paragraphs
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_LENGTH) {
      chunks.push(paragraph);
      continue;
    }

    // Split long paragraphs by sentences
    const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= MAX_CHUNK_LENGTH) {
        currentChunk += sentence;
      } else {
        if (currentChunk.length >= MIN_CHUNK_LENGTH) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      }
    }

    if (currentChunk.length >= MIN_CHUNK_LENGTH) {
      chunks.push(currentChunk.trim());
    }
  }

  return chunks;
}

/**
 * Generate a sub-question for a chunk
 * @param {string} originalQuestion - Original question
 * @param {string} chunk - Text chunk
 * @returns {string} Sub-question
 */
function generateSubQuestion(originalQuestion, chunk) {
  // If chunk is short enough, use original question
  if (chunk.length <= MAX_CHUNK_LENGTH / 2) {
    return originalQuestion;
  }

  // Try to extract a key phrase from the chunk
  const firstSentence = chunk.match(/^[^.!?]+[.!?]+/)?.[0] || chunk;
  return `${originalQuestion} (${firstSentence.substring(0, 50)}...)`;
}

/**
 * Check if text is too similar to existing entries
 * @param {pg.PoolClient} client - Database client
 * @param {string} text - Text to check
 * @returns {Promise<boolean>} True if too similar
 */
async function isTooSimilar(client, text) {
  const normalizedText = normalize(text);
  const { rows } = await client.query(
    `SELECT answer FROM insurance_qa 
     WHERE similarity(normalize(answer), $1) > 0.9
     LIMIT 1`,
    [normalizedText]
  );
  return rows.length > 0;
}

async function seedEmbeddings() {
  let client;
  try {
    client = await pool.connect();
    console.log('Successfully connected to the database.');

    // Create extension and table
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await client.query(`CREATE TABLE IF NOT EXISTS insurance_qa (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      embedding vector(1536),
      metadata JSONB DEFAULT '{}'::jsonb
    );`);
    console.log('[seed] table ready');

    // Load insurance knowledge base
    const rawData = await fs.readFile(KNOWLEDGE_FILE_PATH, 'utf8');
    const knowledgeBase = JSON.parse(rawData);
    const qas = knowledgeBase.insurance_home_il_qa;

    if (!qas || !Array.isArray(qas)) {
      console.error('Could not find Q&A array in insurance_knowledge.json');
      return;
    }

    let rowsInserted = 0;
    let chunksCreated = 0;
    let duplicatesSkipped = 0;

    for (const qa of qas) {
      const originalQuestion = qa.question;
      const answer = qa.answer;

      if (!originalQuestion || !answer) {
        console.warn('Skipping QA item due to missing question or answer:', qa);
        continue;
      }

      // Split answer into chunks
      const chunks = splitIntoChunks(answer);
      chunksCreated += chunks.length;

      for (const chunk of chunks) {
        // Skip if chunk is too similar to existing content
        if (await isTooSimilar(client, chunk)) {
          duplicatesSkipped++;
          continue;
        }

        // Generate sub-question for chunk
        const subQuestion = generateSubQuestion(originalQuestion, chunk);

        // Normalize and get embedding
        const normalizedQuestion = normalize(subQuestion);
        const embedding = await getEmbedding(normalizedQuestion);

        if (!embedding) {
          console.warn(`Could not generate embedding for question: "${subQuestion.substring(0,50)}...", skipping.`);
          continue;
        }

        // Insert new QA
        const insertQuery = `
          INSERT INTO insurance_qa (question, answer, embedding, metadata)
          VALUES ($1, $2, $3, $4)
          RETURNING id;
        `;
        await client.query(insertQuery, [
          subQuestion,
          chunk,
          JSON.stringify(embedding),
          JSON.stringify({
            original_question: originalQuestion,
            chunk_index: chunks.indexOf(chunk),
            total_chunks: chunks.length
          })
        ]);
        rowsInserted++;
        console.log(`Inserted chunk ${chunks.indexOf(chunk) + 1}/${chunks.length}: "${subQuestion.substring(0,50)}..."`);
      }
    }

    console.log(`
✅ Seeding complete.
Total Q&A items in JSON: ${qas.length}
Chunks created: ${chunksCreated}
New rows inserted into database: ${rowsInserted}
Duplicates skipped: ${duplicatesSkipped}
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