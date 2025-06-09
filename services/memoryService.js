import pg from 'pg';
import 'dotenv/config';

// Configure PostgreSQL connection pool with proper SSL and timeout settings
const pool = new pg.Pool(
  process.env.DATABASE_URL 
    ? { 
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: process.env.NODE_ENV === 'production',
          ca: process.env.SSL_CA_CERT // Optional CA certificate for production
        },
        statement_timeout: 5000, // 5 seconds timeout for queries
        query_timeout: 5000,     // 5 seconds timeout for queries
        connectionTimeoutMillis: 5000 // 5 seconds timeout for connections
      }
    : {
        user: process.env.PGUSER,
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: process.env.PGPORT,
        ssl: {
          rejectUnauthorized: process.env.NODE_ENV === 'production',
          ca: process.env.SSL_CA_CERT // Optional CA certificate for production
        },
        statement_timeout: 5000,
        query_timeout: 5000,
        connectionTimeoutMillis: 5000
      }
);

// Log successful connection
pool.on('connect', () => {
  const connectionType = process.env.DATABASE_URL ? 'external DATABASE_URL' : 'individual PG variables';
  const sslMode = process.env.NODE_ENV === 'production' ? 'with SSL verification' : 'with SSL (verification disabled)';
  console.info(`✅ PostgreSQL connected successfully for memoryService using ${connectionType} ${sslMode}.`);
});

// Handle connection errors
pool.on('error', (err) => {
  console.error('[memoryService] ⚠️  Unexpected error on idle client:', err);
  process.exit(-1); // Exit on critical DB errors
});

// Ensure tables exist
(async () => {
  try {
    // Create customers table with additional fields
    await pool.query(`CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      stage TEXT DEFAULT 'new',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      preferences JSONB DEFAULT '{}'::jsonb
    );`);
    
    // Create conversation memory table with enhanced structure
    await pool.query(`CREATE TABLE IF NOT EXISTS convo_memory (
      phone TEXT PRIMARY KEY,
      history JSONB DEFAULT '[]'::jsonb,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata JSONB DEFAULT '{}'::jsonb,
      CONSTRAINT fk_customer FOREIGN KEY (phone) REFERENCES customers(phone) ON DELETE CASCADE
    );`);
    
    // Add columns if missing (for existing deployments)
    await pool.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS last_name TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;
      
      ALTER TABLE convo_memory 
      ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      
      -- Ensure primary keys and foreign key exist
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'convo_memory_pkey'
        ) THEN
          ALTER TABLE convo_memory ADD PRIMARY KEY (phone);
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'fk_customer'
        ) THEN
          ALTER TABLE convo_memory 
          ADD CONSTRAINT fk_customer 
          FOREIGN KEY (phone) 
          REFERENCES customers(phone) 
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    
    console.log('[memoryService] ✅ customers and convo_memory tables ready');
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
      INSERT INTO customers (phone, ${fields.join(', ')}, last_interaction) 
      VALUES ($1, ${fields.map((_, index) => `$${index + 2}`).join(', ')}, CURRENT_TIMESTAMP)
      ON CONFLICT (phone) DO UPDATE 
      SET ${conflictClause}, last_interaction = CURRENT_TIMESTAMP
    `;
    
    await pool.query(query, [phone, ...values]);
    console.log(`[memoryService] ✅ Updated customer info for ${phone}`);
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
 * @param {object} metadata - Optional metadata about the exchange
 * @returns {Promise<void>}
 */
export async function appendExchange(phone, userMsg, botReply, metadata = {}) {
  try {
    // First ensure the customer exists
    await pool.query(
      'INSERT INTO customers (phone, last_interaction) VALUES ($1, CURRENT_TIMESTAMP) ON CONFLICT (phone) DO UPDATE SET last_interaction = CURRENT_TIMESTAMP',
      [phone]
    );

    // Then append the exchange to history using a transaction
    await pool.query('BEGIN');
    try {
      // First try to insert
      await pool.query(
        `INSERT INTO convo_memory (phone, history, last_updated, metadata)
         VALUES ($1, jsonb_build_array(jsonb_build_object(
           'user', $2::text, 
           'bot', $3::text,
           'timestamp', CURRENT_TIMESTAMP,
           'metadata', $4::jsonb
         )), CURRENT_TIMESTAMP, $4::jsonb)`,
        [phone, userMsg, botReply, metadata]
      );
    } catch (err) {
      // If insert fails, update existing record
      await pool.query(
        `UPDATE convo_memory 
         SET history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'user', $2::text, 
           'bot', $3::text,
           'timestamp', CURRENT_TIMESTAMP,
           'metadata', $4::jsonb
         )),
         last_updated = CURRENT_TIMESTAMP,
         metadata = metadata || $4::jsonb
         WHERE phone = $1`,
        [phone, userMsg, botReply, metadata]
      );
    }
    await pool.query('COMMIT');
    
    console.log(`[memoryService] ✅ Appended exchange for ${phone}`);
  } catch (err) {
    await pool.query('ROLLBACK');
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
    const result = await pool.query(
      `SELECT c.first_name, c.last_name, c.stage, m.history, m.metadata 
       FROM customers c 
       LEFT JOIN convo_memory m ON c.phone = m.phone 
       WHERE c.phone = $1`,
      [phone]
    );
    
    if (!result.rows[0]) {
      return { history: [], customer: null };
    }
    
    const { first_name, last_name, stage, history, metadata } = result.rows[0];
    return {
      history: history?.slice(-maxTurns) || [],
      customer: {
        firstName: first_name,
        lastName: last_name,
        stage,
        metadata
      }
    };
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to get history:', err.message);
    return { history: [], customer: null };
  }
}

/**
 * Extract customer information from a message
 * @param {string} message - User's message
 * @returns {object|null} Extracted customer info or null
 */
export function extractCustomerInfo(message) {
  const info = {};
  
  // Extract name patterns
  const namePatterns = [
    /(?:קוראים לי|שמי|אני) ([^\s]+)/i,
    /(?:השם שלי|השם) ([^\s]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = message.match(pattern);
    if (match) {
      info.first_name = match[1];
      break;
    }
  }
  
  // Extract email pattern
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const emailMatch = message.match(emailPattern);
  if (emailMatch) {
    info.email = emailMatch[0];
  }
  
  return Object.keys(info).length > 0 ? info : null;
}

export async function smartAnswer(question, context = []) {
  // Implementation of the function
} 