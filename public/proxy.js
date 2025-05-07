
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.post('/api/chat', async (req, res) => {
  try {
    const messages = req.body.messages;

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: messages,
    });

    res.json({ reply: completion.data.choices[0].message.content });
  } catch (error) {
    console.error("Error with OpenAI API:", error.message);
    res.status(500).json({ error: 'Failed to contact OpenAI API.' });
  }
});

app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
});