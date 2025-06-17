import pg from 'pg';
import 'dotenv/config';
import OpenAI from 'openai';
import { safeCall } from '../src/utils/safeCall.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure PostgreSQL connection pool with proper SSL
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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
 * Update customer information
 * @param {string} phone - Customer phone number
 * @param {object} updates - Customer info updates
 * @returns {Promise<void>}
 */
export async function updateCustomer(phone, updates) {
  try {
    // Filter out undefined and null values
    const validUpdates = Object.entries(updates)
      .filter(([_, value]) => value !== undefined && value !== null)
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

    if (Object.keys(validUpdates).length === 0) {
      console.log('[memoryService] ℹ️  No valid updates to apply');
      return;
    }

    const fields = Object.keys(validUpdates);
    const values = Object.values(validUpdates);
    const placeholders = fields.map((_, i) => `$${i + 2}`).join(', ');
    const setClause = fields.map((field, i) => `${field} = $${i + 2}`).join(', ');

    await pool.query(
      `INSERT INTO customers (phone, ${fields.join(', ')}, last_interaction)
       VALUES ($1, ${placeholders}, CURRENT_TIMESTAMP)
       ON CONFLICT (phone) DO UPDATE
       SET ${setClause}, last_interaction = CURRENT_TIMESTAMP`,
      [phone, ...values]
    );

    console.log(`[memoryService] ✅ Updated customer info for ${phone}:`, validUpdates);
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to update customer:', err.message);
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

    // Then append the exchange to history using upsert
    await pool.query(
      `INSERT INTO conversation_memory (phone, history, last_updated)
       VALUES ($1, jsonb_build_array(jsonb_build_object(
         'user', $2::text, 
         'bot', $3::text,
         'timestamp', CURRENT_TIMESTAMP,
         'metadata', $4::jsonb
       )), CURRENT_TIMESTAMP)
       ON CONFLICT (phone) DO UPDATE
       SET history = conversation_memory.history || jsonb_build_array(jsonb_build_object(
         'user', $2::text, 
         'bot', $3::text,
         'timestamp', CURRENT_TIMESTAMP,
         'metadata', $4::jsonb
       )),
       last_updated = CURRENT_TIMESTAMP`,
      [phone, userMsg, botReply, metadata]
    );
    
    console.log(`[memoryService] ✅ Appended exchange for ${phone} (conversation_memory)`);
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to append exchange (conversation_memory):', err.message);
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
    // Only fetch customer info and history from conversation_memory
    const customerResult = await pool.query(
      `SELECT first_name, last_name, stage FROM customers WHERE phone = $1`,
      [phone]
    );
    const historyResult = await pool.query(
      `SELECT history FROM conversation_memory WHERE phone = $1`,
      [phone]
    );
    const customer = customerResult.rows[0] || null;
    const history = historyResult.rows[0]?.history || [];
    return {
      history: history.slice(-maxTurns),
      customer
    };
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to get history (conversation_memory):', err.message);
    return { history: [], customer: null };
  }
}

/**
 * Extract customer information from message using GPT-4o
 * @param {string} msg - User message
 * @returns {Promise<object>} Extracted customer info
 */
export async function extractCustomerInfo(msg) {
  try {
    const systemPrompt = `אתה מומחה לזיהוי מידע רלוונטי על לקוחות מהודעות טקסט.
    עליך לזהות רק את המידע הבא אם הוא קיים בהודעה:
    - שם פרטי
    - שם משפחה
    - עיר
    - ערך דירה (בשקלים)
    
    החזר רק את השדות שזיהית, ללא הסברים נוספים.
    אם לא זיהית מידע מסוים, אל תכלול אותו בתשובה.
    החזר את התשובה בפורמט JSON בלבד.`;

    const response = await safeCall(() => openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: msg }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    }), { fallback: () => ({ choices: [{ message: { content: '{}' } }] }) });

    const extractedInfo = JSON.parse(response.choices[0].message.content);
    
    // Clean and validate the extracted info
    const cleanInfo = {};
    if (extractedInfo.firstName) cleanInfo.firstName = extractedInfo.firstName.trim();
    if (extractedInfo.lastName) cleanInfo.lastName = extractedInfo.lastName.trim();
    if (extractedInfo.city) cleanInfo.city = extractedInfo.city.trim();
    if (extractedInfo.homeValue) {
      // Convert home value to number and remove any non-numeric characters
      const value = parseInt(extractedInfo.homeValue.toString().replace(/[^0-9]/g, ''));
      if (!isNaN(value)) cleanInfo.homeValue = value;
    }

    return cleanInfo;
  } catch (err) {
    console.error('[memoryService] ⚠️  Failed to extract customer info:', err.message);
    return {};
  }
}

 