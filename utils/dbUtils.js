import pool from './dbPool.js';

let _migrationDone = false;

export async function runMetadataMigration() {
  try {
    if (_migrationDone) return;            // already ran this boot

    await pool.query(`
      ALTER TABLE insurance_qa
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);
    _migrationDone = true;
    console.log('[DB] metadata column verified ✔︎');
  } catch (err) {
    console.warn('[DB] metadata migration skipped:', err.message);
    // do NOT throw – the app must continue running
  }
} 