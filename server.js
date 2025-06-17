app.post('/webhook', async (req, res) => {
  try {
    console.info('[Server] Received webhook request');
    
    const { body } = req;
    console.debug('[Server] Webhook payload:', {
      messageCount: body.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0,
      type: body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type
    });

    if (!body.entry?.[0]?.changes?.[0]?.value?.messages) {
      console.warn('[Server] No messages in webhook payload');
      return res.sendStatus(200);
    }

    const message = body.entry[0].changes[0].value.messages[0];
    console.debug('[Server] Processing message:', {
      from: message.from,
      type: message.type,
      timestamp: message.timestamp
    });

    // Handle the message
    await handleIncomingMessage(message);
    console.info('[Server] Message processed successfully');
    
    res.sendStatus(200);
  } catch (error) {
    console.error('[Server] Error processing webhook:', error);
    res.sendStatus(500);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.debug('[Server] Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.info(`[Server] Server started on port ${PORT}`);
  console.info('[Server] Environment:', {
    nodeEnv: process.env.NODE_ENV,
    whatsappNumber: process.env.WHATSAPP_PHONE_NUMBER ? 'configured' : 'not configured',
    openaiKey: process.env.OPENAI_API_KEY ? 'configured' : 'not configured'
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('[Server] Unhandled rejection:', error);
}); 

// Add this after all routes:
app.use((err, req, res, next) => {
  if (err && err.name === "OpenAIError") {
    return res.json({ text: "⚠️ השירות עמוס כעת, נחזור אליך בקרוב." });
  }
  next(err);
}); 