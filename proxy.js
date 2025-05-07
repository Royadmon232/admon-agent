const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { google } = require('googleapis');
const fs = require('fs');
const { handleUserMessage } = require('./agentController');

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

// Function to send email using Gmail API
async function sendEmailWithGmail(pdfBuffer) {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const email = [
        'Content-Type: multipart/mixed; boundary="boundary"',
        'MIME-Version: 1.0',
        'to: royadmon23@gmail.com',
        'subject: Insurance Summary from Doni',
        '',
        '--boundary',
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        'Content-Transfer-Encoding: 7bit',
        '',
        'Attached is your conversation summary with Doni, your AI insurance agent.',
        '',
        '--boundary',
        'Content-Type: application/pdf',
        'MIME-Version: 1.0',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="insurance_summary.pdf"',
        '',
        pdfBuffer.toString('base64'),
        '',
        '--boundary--'
    ].join('');

    const encodedMessage = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log('Email sent successfully:', res.data);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// Example route to send email
app.post('/api/send-email', async (req, res) => {
    try {
        const pdfBuffer = req.body.pdfBuffer; // Expecting pdfBuffer to be sent in the request
        await sendEmailWithGmail(pdfBuffer);
        res.status(200).send('Email sent successfully');
    } catch (error) {
        console.error('Error in /api/send-email:', error);
        res.status(500).send('Error sending email');
    }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        // Use agentController to handle the message
        const agentResponse = handleUserMessage(message);
        if (agentResponse !== 'Sorry, I did not understand your request.') {
            return res.json({ reply: agentResponse });
        }

        // Continue to OpenAI GPT-4 if agentController does not handle the message
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "אתה סוכן ביטוח ישראלי מנוסה. שאל שאלות המשך כמו 'מה גיל הנהג הצעיר?' או 'מה סוג השימוש ברכב?'. הצע המלצות מותאמות אישית כמו 'בהתאם לפרטים שמסרת, אני ממליץ על...'. דבר רק בעברית והשתמש בשפה משכנעת ומקצועית כדי להציע את הפתרונות הטובים ביותר ללקוח.\n\nדוגמאות לשיחה:\n- 'בהתאם לפרופיל שלך, יש לי שתי הצעות משתלמות במיוחד.'\n- 'תרצה שאחשב לך הצעה על ביטוח צד ג' בנוסף?'\n- 'תודה על המידע. אני כבר בודק מה הכי מתאים עבורך...'"
                },
                {
                    role: "user",
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