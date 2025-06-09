import { normalize } from '../utils/normalize.js';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import { smartAnswer } from './ragChain.js';
import { intentDetect, buildSalesResponse } from './salesTemplates.js';
import { sendWhatsApp } from './twilioService.js';
import PQueue from 'p-queue';
import { setTimeout } from 'timers/promises';
import pg from 'pg';
import twilio from 'twilio';
import { smsFallback } from './twilioService.js';

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

export async function handleIncomingMessage(message) {
  try {
    console.info('[WhatsApp] Received message:', {
      from: message.from,
      type: message.type,
      timestamp: message.timestamp
    });

    // Check for duplicate message
    if (isDuplicate(message)) {
      console.info('[WhatsApp] Ignoring duplicate message');
      return; // Return without processing
    }

    // Handle different message types with timeout
    try {
      if (message.type === 'text') {
        console.debug('[WhatsApp] Processing text message:', message.body);
        await Promise.race([
          handleTextMessage(message),
          setTimeout(15000).then(() => {
            throw new Error('Message processing timeout');
          })
        ]);
      } else if (message.type === 'image') {
        console.debug('[WhatsApp] Processing image message');
        await Promise.race([
          handleImageMessage(message),
          setTimeout(15000).then(() => {
            throw new Error('Image processing timeout');
          })
        ]);
      } else {
        console.warn('[WhatsApp] Unsupported message type:', message.type);
        await sendMessage(message.from, 'מצטער, אני יכול לענות רק על הודעות טקסט ותמונות.');
      }
    } catch (timeoutError) {
      console.error('[WhatsApp] Processing timeout:', timeoutError);
      await sendMessage(message.from, 'מצטער, המערכת עמוסה כרגע. אנא נסה שוב בעוד מספר דקות.');
    }
  } catch (error) {
    console.error('[WhatsApp] Error handling message:', error);
    await sendMessage(message.from, 'מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.');
  }
}

async function handleTextMessage(message) {
  try {
    console.debug('[WhatsApp] Starting text message processing');
    
    // Get conversation history with timeout
    const history = await Promise.race([
      getConversationHistory(message.from),
      setTimeout(10000).then(() => {
        console.warn('[WhatsApp] History retrieval timeout');
        return [];
      })
    ]);
    
    console.debug('[WhatsApp] Retrieved conversation history:', {
      messageCount: history.length,
      lastMessage: history[history.length - 1]?.message
    });

    // Process with RAG with timeout
    console.info('[WhatsApp] Sending to RAG for processing');
    const response = await Promise.race([
      smartAnswer(message.body, history),
      setTimeout(20000).then(() => {
        console.warn('[WhatsApp] RAG processing timeout');
        return null;
      })
    ]);
    
    if (response) {
      console.debug('[WhatsApp] Received RAG response');
      await sendMessage(message.from, response);
      
      // Store in history with timeout
      await Promise.race([
        storeMessage(message.from, message.body, response),
        setTimeout(5000).then(() => {
          console.warn('[WhatsApp] History storage timeout');
        })
      ]);
      console.debug('[WhatsApp] Stored message in history');
    } else {
      console.warn('[WhatsApp] No response from RAG');
      await sendMessage(message.from, 'מצטער, לא הצלחתי לענות על השאלה שלך. אנא נסה לנסח אותה אחרת.');
    }
  } catch (error) {
    console.error('[WhatsApp] Error processing text message:', error);
    throw error;
  }
}

async function handleImageMessage(message) {
  try {
    console.debug('[WhatsApp] Starting image message processing');
    
    // Download image with timeout
    const imageBuffer = await Promise.race([
      downloadMedia(message.mediaId),
      setTimeout(5000).then(() => {
        throw new Error('Image download timeout');
      })
    ]);
    console.debug('[WhatsApp] Downloaded image');

    // Process image with OCR with timeout
    const text = await Promise.race([
      processImageWithOCR(imageBuffer),
      setTimeout(5000).then(() => {
        console.warn('[WhatsApp] OCR processing timeout');
        return null;
      })
    ]);
    console.debug('[WhatsApp] OCR result:', text ? 'Text found' : 'No text found');

    if (text) {
      // Process extracted text with timeout
      console.info('[WhatsApp] Processing extracted text with RAG');
      const response = await Promise.race([
        smartAnswer(text, []),
        setTimeout(10000).then(() => {
          console.warn('[WhatsApp] RAG processing timeout');
          return null;
        })
      ]);
      
      if (response) {
        console.debug('[WhatsApp] Sending response for image text');
        await sendMessage(message.from, response);
      } else {
        console.warn('[WhatsApp] No RAG response for image text');
        await sendMessage(message.from, 'מצטער, לא הצלחתי לענות על השאלה מהתמונה. אנא נסה לשלוח את השאלה בטקסט.');
      }
    } else {
      console.warn('[WhatsApp] No text found in image');
      await sendMessage(message.from, 'מצטער, לא הצלחתי לזהות טקסט בתמונה. אנא נסה לשלוח תמונה ברורה יותר או לכתוב את השאלה בטקסט.');
    }
  } catch (error) {
    console.error('[WhatsApp] Error processing image message:', error);
    throw error;
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
async function initDatabase() {
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

      const message = await client.messages.create({
        body: body,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${to}`,
        // Add timeout for Twilio API call
        timeout: 15000 // 15 seconds
      });

      console.log(`✅ Message sent successfully: ${message.sid}`);
      await logDelivery(to, body, 'sent', null);
      return message;
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