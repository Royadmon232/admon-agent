import pg from 'pg';
import 'dotenv/config';

// Configure PostgreSQL connection pool - prioritize DATABASE_URL for external connections
const pool = new pg.Pool(
  process.env.DATABASE_URL 
    ? { 
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        user: process.env.PGUSER,
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: process.env.PGPORT,
        ssl: { rejectUnauthorized: false }
      }
);

// Log successful connection
pool.on('connect', () => {
  const connectionType = process.env.DATABASE_URL ? 'external DATABASE_URL' : 'individual PG variables';
  console.info(`✅ PostgreSQL connected successfully for memoryService using ${connectionType}.`);
});

// Ensure tables exist
(async () => {
  try {
    // Create customers table
    await pool.query(`CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      first_name TEXT,
      stage TEXT DEFAULT 'new'
    );`);
    
    // Add history column if it doesn't exist
    await pool.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;
    `);
    
    // Create conversation memory table
    await pool.query(`CREATE TABLE IF NOT EXISTS convo_memory (
      id SERIAL PRIMARY KEY,
      phone TEXT REFERENCES customers(phone) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      ts TIMESTAMPTZ DEFAULT now()
    );`);
    
    console.log('[memoryService] ✅ customers and convo_memory tables ready with history column');
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to ensure tables:', err.message);
  }
})();

/**
 * Store a key-value pair in conversation memory for a phone number
 * @param {string} phone - Customer phone number
 * @param {string} key - Memory key
 * @param {string} value - Memory value
 * @returns {Promise<void>}
 */
export async function remember(phone, key, value) {
  try {
    // Ensure customer exists first
    await pool.query(
      'INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING',
      [phone]
    );
    
    // Insert memory record
    await pool.query(
      'INSERT INTO convo_memory (phone, key, value) VALUES ($1, $2, $3)',
      [phone, key, value]
    );
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to remember:', err.message);
    throw err;
  }
}

/**
 * Retrieve all conversation memory for a phone number
 * @param {string} phone - Customer phone number
 * @returns {Promise<object>} Object with key-value pairs from memory
 */
export async function recall(phone) {
  try {
    const { rows } = await pool.query(
      'SELECT key, value FROM convo_memory WHERE phone = $1 ORDER BY ts DESC',
      [phone]
    );
    
    // Convert rows to key-value object (latest values take precedence)
    const memory = {};
    for (const row of rows) {
      if (!memory.hasOwnProperty(row.key)) {
        memory[row.key] = row.value;
      }
    }
    
    return memory;
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to recall:', err.message);
    return {};
  }
}

/**
 * Update or insert customer information
 * @param {string} phone - Customer phone number
 * @param {object} fieldsObject - Object with customer fields to update
 * @returns {Promise<void>}
 */
export async function updateCustomer(phone, fieldsObject) {
  try {
    const fields = Object.keys(fieldsObject);
    const values = Object.values(fieldsObject);
    
    if (fields.length === 0) {
      return;
    }
    
    // Build SET clause for UPDATE
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    // Build conflict resolution clause
    const conflictClause = fields.map((field, index) => `${field} = EXCLUDED.${field}`).join(', ');
    
    const query = `
      INSERT INTO customers (phone, ${fields.join(', ')}) 
      VALUES ($1, ${fields.map((_, index) => `$${index + 2}`).join(', ')})
      ON CONFLICT (phone) DO UPDATE SET ${conflictClause}
    `;
    
    await pool.query(query, [phone, ...values]);
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to update customer:', err.message);
    throw err;
  }
}

/**
 * Append a conversation exchange to the history
 * @param {string} phone - Customer phone number
 * @param {string} userMsg - User's message
 * @param {string} botReply - Bot's reply
 * @returns {Promise<void>}
 */
export async function appendExchange(phone, userMsg, botReply) {
  try {
    // Ensure customer exists first
    await pool.query(
      `INSERT INTO customers (phone, history) VALUES ($1, $2::jsonb) ON CONFLICT (phone) DO NOTHING`,
      [phone, '[]']
    );
    
    // Append to history array in JSONB column
    const exchange = {
      user: userMsg,
      bot: botReply,
      timestamp: new Date().toISOString()
    };
    
    await pool.query(`
      UPDATE customers 
      SET history = history || $1::jsonb
      WHERE phone = $2
    `, [JSON.stringify(exchange), phone]);
    
    // Also remember last message for backward compatibility
    await remember(phone, 'lastMsg', userMsg);
    await remember(phone, 'lastReply', botReply);
    
    console.log(`[memoryService] ✅ Appended exchange for ${phone}`);
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to append exchange:', err.message);
    throw err;
  }
}

/**
 * Get conversation history for a phone number
 * @param {string} phone - Customer phone number
 * @param {number} maxTurns - Maximum number of turns to retrieve (default 10)
 * @returns {Promise<Array>} Array of conversation exchanges
 */
export async function getHistory(phone, maxTurns = 10) {
  try {
    const result = await pool.query(`
      SELECT 
        CASE 
          WHEN jsonb_array_length(history) > $2 
          THEN (
            SELECT jsonb_agg(elem)
            FROM (
              SELECT elem
              FROM jsonb_array_elements(history) WITH ORDINALITY AS t(elem, ord)
              ORDER BY ord DESC
              LIMIT $2
            ) AS recent
          )
          ELSE history
        END as history
      FROM customers 
      WHERE phone = $1
    `, [phone, maxTurns]);
    
    if (result.rows.length === 0) {
      return [];
    }
    
    const history = result.rows[0].history || [];
    // Return in chronological order (oldest first)
    return Array.isArray(history) ? history.reverse() : [];
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to get history:', err.message);
    return [];
  }
} 