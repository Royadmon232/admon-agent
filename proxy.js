const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { google } = require('googleapis');
const fs = require('fs');
const { handleUserMessage } = require('./agentController');
import emailjs from 'emailjs-com';

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize EmailJS with Public Key
emailjs.init('bmjjh75db3mmHuq5H');

// Use environment variables for credentials
const credentials = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
};

const { client_secret, client_id, redirect_uris } = credentials;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Set the token for the OAuth2 client
// You need to generate this token manually and store it securely
const TOKEN_PATH = 'token.json';
fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return console.error('Error loading token:', err);
    oAuth2Client.setCredentials(JSON.parse(token));
});

// Function to send email with PDF using EmailJS
async function sendEmailWithPDF(pdfBuffer) {
    try {
        const base64PDF = pdfBuffer.toString('base64');
        const response = await emailjs.send(
            'service_fidvxmm',
            'template_0svkc5i',
            {
                to_email: 'royadmon23@gmail.com',
                subject: 'Insurance Summary from Doni',
                message: 'Attached is your conversation summary with Doni, your AI insurance agent.',
                attachment: [
                    {
                        name: 'insurance_summary.pdf',
                        type: 'application/pdf',
                        content: base64PDF,
                        encoding: 'base64'
                    }
                ]
            }
        );
        console.log('Email sent successfully:', response);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        // Check if we should generate PDF
        if (conversationLog.length >= MESSAGE_THRESHOLD || message.toLowerCase() === 'סיכום') {
            const pdfBuffer = await generatePDF();
            await sendEmailWithPDF(pdfBuffer);
        }

        // Continue to OpenAI GPT-4
        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: "אתה סוכן ביטוח ישראלי מנוסה. שאל שאלות המשך כמו 'מה גיל הנהג הצעיר?' או 'מה סוג השימוש ברכב?'. הצע המלצות מותאמות אישית כמו 'בהתאם לפרטים שמסרת, אני ממליץ על...'. דבר רק בעברית והשתמש בשפה משכנעת ומקצועית כדי להציע את הפתרונות הטובים ביותר ללקוח."
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        res.json({ 
            reply: completion.choices[0].message.content 
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'An error occurred while processing your request' 
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 