import { normalize } from '../utils/normalize.js';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import { smartAnswer } from './ragChain.js';
import { intentDetect, buildSalesResponse } from './salesTemplates.js';
import { sendWapp } from './twilioService.js';
import PQueue from 'p-queue';
import { setTimeout } from 'timers/promises';
import pg from 'pg';
import twilio from 'twilio';
import { smsFallback } from './twilioService.js';
import axios from 'axios';

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Message deduplication cache
const messageCache = new Map();
const DEDUP_WINDOW = 30000; // 30 seconds window for deduplication

// Message queue for rate limiting
const messageQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 1
});

// Clean up old messages from cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of messageCache.entries()) {
    if (now - value.timestamp > DEDUP_WINDOW) {
      messageCache.delete(key);
    }
  }
}, 60000); // Clean up every minute

/**
 * Generate a unique key for a message
 * @param {object} message - Message object
 * @returns {string} Unique key
 */
function getMessageKey(message) {
  if (message.sid) {
    return message.sid; // Use Twilio's message SID if available
  }
  // Otherwise create a key from sender and content
  return `${message.from}:${message.body}:${Math.floor(Date.now() / 1000)}`;
}

/**
 * Check if a message is a duplicate
 * @param {object} message - Message object
 * @returns {boolean} True if duplicate
 */
function isDuplicate(message) {
  const key = getMessageKey(message);
  const now = Date.now();
  
  if (messageCache.has(key)) {
    const cached = messageCache.get(key);
    if (now - cached.timestamp < DEDUP_WINDOW) {
      console.info('[WhatsApp] Duplicate message detected:', {
        from: message.from,
        timestamp: message.timestamp,
        key
      });
      return true;
    }
  }
  
  messageCache.set(key, { timestamp: now });
  return false;
}

// Initialize PostgreSQL pool with enhanced security and timeouts
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    ca: process.env.SSL_CA_CERT // Use proper CA certificate in production
  } : {
    rejectUnauthorized: false // Allow self-signed in development
  },
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000, // Close idle clients after 30s
  connectionTimeoutMillis: 10000, // Return error after 10s if cannot connect
  statement_timeout: 30000, // 30s timeout for statements
  query_timeout: 30000, // 30s timeout for queries
});

// Handle pool errors globally
pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client', err);
  // Don't exit process, just log the error
});

pool.on('connect', (client) => {
  console.log('✅ New database connection established');
  // Set session parameters for each new connection
  client.query('SET statement_timeout = 30000'); // 30 seconds
});

// Main webhook handler
export async function handleIncomingMessage(message) {
  console.log('[WhatsApp] Received message:', JSON.stringify(message, null, 2));
  
  try {
    // Extract message details
    const from = message.From || message.from;
    const body = message.Body || message.body || '';
    const messageId = message.MessageSid || message.id;
    
    if (!from || !body) {
      console.warn('[WhatsApp] Missing required fields:', { from, body });
      return;
    }
    
    // Clean phone number
    const phone = from.replace('whatsapp:', '').replace('+', '');
    
    // Check for duplicate message
    if (await isDuplicateMessage(phone, messageId)) {
      console.log('[WhatsApp] Skipping duplicate message');
      return;
    }
    
    // Store incoming message
    await storeMessage(phone, body, 'received');
    
    // Get conversation history
    const history = await getConversationHistory(phone);
    
    // Process with agent
    const response = await handleMessage(phone, body);
    
    // Send response
    await sendWhatsAppMessage(phone, response);
    
    // Store outgoing message
    await storeMessage(phone, response, 'sent');
    
  } catch (error) {
    console.error('[WhatsApp] Error handling message:', error);
    throw error;
  }
}

// Handle text messages
async function handleTextMessage(message) {
  const from = message.From.replace('whatsapp:', '');
  const body = message.Body;
  const messageId = message.MessageSid;
  
  console.log(`📱 Received WhatsApp message from ${from}: ${body}`);
  
  // Check for duplicate
  if (isDuplicate(message)) {
    console.log('⚠️ Duplicate message detected, skipping');
    return;
  }
  
  // Store incoming message
  await storeMessage(from, body, 'user');
  
  // Get conversation history  
  const history = await getConversationHistory(from);
  
  // Process message with agent
  const response = await handleMessage(from, body);
  
  if (response) {
    // Send response back
    await sendMessage(from, response);
    
    // Store bot response
    await storeMessage(from, response, 'bot');
  }
}

// Handle image messages
async function handleImageMessage(message) {
  const from = message.From.replace('whatsapp:', '');
  const mediaUrl = message.MediaUrl0;
  const caption = message.Body || '';
  
  console.log(`📸 Received WhatsApp image from ${from}`);
  console.log(`Caption: ${caption}`);
  console.log(`Media URL: ${mediaUrl}`);
  
  try {
    // Download image
    const imageBuffer = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });
    
    // Extract text from image using OCR or image analysis
    const text = await extractTextFromImage(imageBuffer.data);
    
    // Process extracted text with caption
    const combinedText = caption ? `${caption}\n\n${text}` : text;
    const response = await handleMessage(from, combinedText);
    
    if (response) {
      await sendMessage(from, response);
    }
  } catch (error) {
    console.error('❌ Error processing image:', error);
    await sendMessage(from, 'מצטער, לא הצלחתי לעבד את התמונה. אנא נסה לשלוח טקסט או תמונה ברורה יותר.');
  }
}

export async function sendMessage(to, text) {
  try {
    console.debug('[WhatsApp] Sending message:', {
      to,
      textLength: text.length
    });
    
    // Use queue for rate limiting
    const response = await messageQueue.add(async () => {
      const result = await client.messages.create({
        body: text,
        from: process.env.WHATSAPP_PHONE_NUMBER,
        to: to
      });
      
      console.debug('[WhatsApp] Message sent successfully:', {
        messageId: result.sid,
        status: result.status
      });
      
      return result;
    });
    
    return response;
  } catch (error) {
    console.error('[WhatsApp] Error sending message:', error);
    throw error;
  }
}

async function getConversationHistory(phoneNumber) {
  try {
    console.debug('[WhatsApp] Fetching conversation history for:', phoneNumber);
    const history = await prisma.conversation.findMany({
      where: { phoneNumber },
      orderBy: { timestamp: 'desc' },
      take: 5
    });
    
    console.debug('[WhatsApp] Retrieved history:', {
      count: history.length,
      lastMessage: history[0]?.message
    });
    
    return history;
  } catch (error) {
    console.error('[WhatsApp] Error fetching conversation history:', error);
    return [];
  }
}

async function storeMessage(phoneNumber, userMessage, botResponse) {
  try {
    console.debug('[WhatsApp] Storing conversation:', {
      phoneNumber,
      userMessageLength: userMessage.length,
      botResponseLength: botResponse.length
    });
    
    await prisma.conversation.create({
      data: {
        phoneNumber,
        message: userMessage,
        response: botResponse,
        timestamp: new Date()
      }
    });
    
    console.debug('[WhatsApp] Conversation stored successfully');
  } catch (error) {
    console.error('[WhatsApp] Error storing conversation:', error);
  }
}

// Initialize database tables with enhanced customer fields
export async function initDatabase() {
  try {
    // Create enhanced customers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        phone VARCHAR(255) PRIMARY KEY,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        city VARCHAR(255),
        home_value NUMERIC,
        stage VARCHAR(50) DEFAULT 'new',
        lead_source VARCHAR(100),
        last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_msg_id VARCHAR(255)
      )
    `);

    // Add new columns if they don't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'last_interaction') THEN
          ALTER TABLE customers ADD COLUMN last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'lead_source') THEN
          ALTER TABLE customers ADD COLUMN lead_source VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'last_msg_id') THEN
          ALTER TABLE customers ADD COLUMN last_msg_id VARCHAR(255);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'home_value') THEN
          ALTER TABLE customers ADD COLUMN home_value NUMERIC;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'city') THEN
          ALTER TABLE customers ADD COLUMN city VARCHAR(255);
        END IF;
      END $$;
    `);

    // Create conversation memory table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_memory (
        phone VARCHAR(255) PRIMARY KEY,
        history JSONB DEFAULT '[]'::jsonb,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create delivery log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS delivery_log (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(255),
        message TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50),
        error TEXT
      )
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (err) {
    console.error('❌ Failed to initialize database tables:', err);
    throw err;
  }
}

// Enhanced customer management
export async function updateCustomer(phone, updates) {
  try {
    const fields = [];
    const values = [phone];
    let paramCount = 1;

    // Build dynamic update query
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = $${++paramCount}`);
        values.push(value);
      }
    }

    // Always update last_interaction
    fields.push(`last_interaction = CURRENT_TIMESTAMP`);
    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    if (fields.length > 0) {
      const query = `
        INSERT INTO customers (phone, ${Object.keys(updates).filter(k => updates[k] !== undefined).join(', ')}, last_interaction, updated_at)
        VALUES ($1, ${Object.keys(updates).filter(k => updates[k] !== undefined).map((_, i) => `$${i + 2}`).join(', ')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (phone) DO UPDATE SET
        ${fields.join(', ')}
      `;
      await pool.query(query, values);
      console.log(`✅ Customer ${phone} updated with:`, updates);
    }
  } catch (err) {
    console.error('❌ Failed to update customer:', err);
  }
}

export async function getCustomer(phone) {
  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE phone = $1',
      [phone]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('❌ Failed to get customer:', err);
    return null;
  }
}

// Enhanced memory management with returning user detection
export async function getMemory(phone) {
  try {
    const customer = await getCustomer(phone);
    const history = await getHistory(phone);
    
    // Check if this is a returning user (last interaction > 1 hour ago)
    const isReturning = customer && customer.last_interaction && 
      (Date.now() - new Date(customer.last_interaction).getTime()) > 3600000; // 1 hour

    return {
      phone,
      firstName: customer?.first_name || null,
      lastName: customer?.last_name || null,
      city: customer?.city || null,
      homeValue: customer?.home_value || null,
      stage: customer?.stage || 'new',
      leadSource: customer?.lead_source || null,
      isReturning,
      conversationHistory: history.slice(-10) // Keep last 10 messages
    };
  } catch (err) {
    console.error('❌ Failed to get memory:', err);
    return { phone, conversationHistory: [] };
  }
}

// Prevent duplicate message processing
export async function isDuplicateMessage(phone, messageId) {
  if (!messageId) return false;
  
  try {
    const customer = await getCustomer(phone);
    if (customer?.last_msg_id === messageId) {
      console.log(`⚠️ Duplicate message detected for ${phone}: ${messageId}`);
      return true;
    }
    
    // Update last message ID
    await updateCustomer(phone, { last_msg_id: messageId });
    return false;
  } catch (err) {
    console.error('❌ Failed to check duplicate message:', err);
    return false;
  }
}

// Enhanced send message with retry logic
export async function sendWhatsAppMessage(to, body, retries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Sending WhatsApp message (attempt ${attempt}/${retries}):`, {
        to: to.substring(0, 7) + '***',
        bodyLength: body.length
      });

      const result = await sendWapp(to, body);
      
      if (result.success) {
        console.log(`✅ Message sent successfully: ${result.sid}`);
        await logDelivery(to, body, 'sent', null);
        return result;
      } else {
        throw new Error(result.error || 'Failed to send message');
      }
    } catch (error) {
      lastError = error;
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      
      // Don't retry on specific errors
      if (error.code === 21610 || // Unsubscribed recipient
          error.code === 21614 || // Invalid WhatsApp number
          error.code === 21408) { // Permission denied
        console.warn('⚠️ Non-retryable error, stopping attempts');
        break;
      }
      
      // Wait before retry with exponential backoff
      if (attempt < retries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // All attempts failed
  await logDelivery(to, body, 'failed', lastError.message);
  
  // Try SMS fallback for critical errors
  if (lastError.code === 21610) { // Unsubscribed
    console.log('📱 Attempting SMS fallback...');
    try {
      await smsFallback(to, "יש לנו הודעה חשובה עבורך. אנא צור קשר או שלח WhatsApp.");
    } catch (smsError) {
      console.error('❌ SMS fallback also failed:', smsError.message);
    }
  }
  
  throw lastError;
}

// Add cleanup function for old conversation history
export async function cleanupOldConversations(daysToKeep = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await pool.query(
      `DELETE FROM conversation_memory 
       WHERE last_updated < $1 
       RETURNING phone`,
      [cutoffDate]
    );
    
    console.log(`🧹 Cleaned up ${result.rowCount} old conversations`);
    return result.rowCount;
  } catch (err) {
    console.error('❌ Failed to cleanup old conversations:', err);
    return 0;
  }
}

// Add health check for database connection
export async function checkDatabaseHealth() {
  try {
    const result = await pool.query('SELECT 1');
    return { healthy: true, message: 'Database connection is healthy' };
  } catch (err) {
    console.error('❌ Database health check failed:', err);
    return { healthy: false, message: err.message };
  }
}

/**
 * Write a delivery attempt to the database.
 * @param {string} phone - The recipient's phone number
 * @param {string} message - The message content
 * @param {string} status - e.g., 'sent', 'failed', etc.
 * @param {string} error - Error message if any
 */
export async function logDelivery(phone, message, status, error = null) {
  try {
    await pool.query(
      `INSERT INTO delivery_log (phone, message, status, error)
       VALUES ($1, $2, $3, $4)`,
      [phone, message, status, error]
    );
    console.log(`✅ Delivery logged: ${status} for ${phone}`);
  } catch (err) {
    console.error('❌ Failed to log delivery:', err);
  }
}

/**
 * Sends a WhatsApp message with a button (formatted as text since Twilio doesn't support interactive buttons)
 * @param {string} to - The recipient's phone number
 * @param {string} message - The message text
 * @param {string} buttonTitle - The text to display on the button
 * @param {string} buttonPayload - The payload to send when button is clicked
 * @returns {Promise<void>}
 */
export async function sendWhatsAppMessageWithButton(to, message, buttonTitle, buttonPayload) {
  try {
    // Format message with button as text since Twilio doesn't support interactive buttons
    const formattedMessage = `${message}\n\n[${buttonTitle}]`;
    const result = await sendWapp(to, formattedMessage);
    
    if (result.success) {
      console.log(`✅ Sent WhatsApp message with button to ${to}`);
      await logDelivery(to, formattedMessage, 'sent', null);
    } else {
      console.error("Error sending WhatsApp message with button:", result.error);
      // Fallback to regular message
      console.log("🔄 Falling back to regular message...");
      await sendWapp(to, `${message}\n\n[${buttonTitle}]`);
    }
  } catch (error) {
    console.error("Error sending WhatsApp message with button:", error);
    // Fallback to regular message
    console.log("🔄 Falling back to regular message...");
    await sendWapp(to, `${message}\n\n[${buttonTitle}]`);
  }
} 