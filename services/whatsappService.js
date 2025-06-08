export async function handleIncomingMessage(message) {
  try {
    console.info('[WhatsApp] Received message:', {
      from: message.from,
      type: message.type,
      timestamp: message.timestamp
    });

    // Handle different message types
    if (message.type === 'text') {
      console.debug('[WhatsApp] Processing text message:', message.body);
      await handleTextMessage(message);
    } else if (message.type === 'image') {
      console.debug('[WhatsApp] Processing image message');
      await handleImageMessage(message);
    } else {
      console.warn('[WhatsApp] Unsupported message type:', message.type);
      await sendMessage(message.from, 'מצטער, אני יכול לענות רק על הודעות טקסט ותמונות.');
    }
  } catch (error) {
    console.error('[WhatsApp] Error handling message:', error);
    await sendMessage(message.from, 'מצטער, אירעה שגיאה בטיפול בהודעה שלך. אנא נסה שוב מאוחר יותר.');
  }
}

async function handleTextMessage(message) {
  try {
    console.debug('[WhatsApp] Starting text message processing');
    
    // Get conversation history
    const history = await getConversationHistory(message.from);
    console.debug('[WhatsApp] Retrieved conversation history:', {
      messageCount: history.length,
      lastMessage: history[history.length - 1]?.message
    });

    // Process with RAG
    console.info('[WhatsApp] Sending to RAG for processing');
    const response = await smartAnswer(message.body, history);
    
    if (response) {
      console.debug('[WhatsApp] Received RAG response');
      await sendMessage(message.from, response);
      
      // Store in history
      await storeMessage(message.from, message.body, response);
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
    
    // Download image
    const imageBuffer = await downloadMedia(message.mediaId);
    console.debug('[WhatsApp] Downloaded image');

    // Process image with OCR
    const text = await processImageWithOCR(imageBuffer);
    console.debug('[WhatsApp] OCR result:', text ? 'Text found' : 'No text found');

    if (text) {
      // Process extracted text
      console.info('[WhatsApp] Processing extracted text with RAG');
      const response = await smartAnswer(text, []);
      
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
    
    const response = await client.messages.create({
      body: text,
      from: process.env.WHATSAPP_PHONE_NUMBER,
      to: to
    });
    
    console.debug('[WhatsApp] Message sent successfully:', {
      messageId: response.sid,
      status: response.status
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