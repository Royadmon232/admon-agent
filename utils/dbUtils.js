import pool from './dbPool.js';

export async function runMetadataMigration() {
  try {
    await pool.query(`
      ALTER TABLE insurance_qa
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);
    console.log('[DB] metadata column verified ✔︎');
  } catch (err) {
    console.warn('[DB] metadata migration skipped:', err.message);
    // do NOT throw – the app must continue running
  }
} 