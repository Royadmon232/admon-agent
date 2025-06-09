import { PQueue } from 'p-queue';
import { setTimeout } from 'timers/promises';

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
      setTimeout(5000).then(() => {
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
      setTimeout(10000).then(() => {
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