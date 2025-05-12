import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'fs';
import { handleUserMessage } from './agentController.js';
import emailjs from 'emailjs-com';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
    
});
app.use(express.static('public'));

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OpenAI API Key');
    process.exit(1);
}

// Initialize EmailJS with Public Key
emailjs.init('bmjjh75db3mmHuq5H');

// Conversation log and message threshold for PDF/email logic
let conversationLog = [];
const MESSAGE_THRESHOLD = 10;

// Connect to SQLite database
const db = new sqlite3.Database('dashboard.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    }
});

// Function to send email with PDF using EmailJS
async function sendEmailWithPDF(pdfBlob) {
    try {
        // Convert blob to base64 using Buffer
        const base64PDF = Buffer.from(pdfBlob).toString('base64');

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
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// Helper function to classify messages
function classifyMessage(message) {
    const vehicleRegex = /\b(\d{7,8})\b|מספר רכב|רכב/;
    const insuranceRegex = /ביטוח|הצעת מחיר|חובה|צד ג|מקיף/;

    if (vehicleRegex.test(message)) return 'vehicle_lookup';
    if (insuranceRegex.test(message)) return 'insurance_quote';
    return 'general';
}

// Extend the /api/chat POST route
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionMemory } = req.body;

        // Use handleUserMessage to detect vehicle-related queries
        const agentResponse = await handleUserMessage(message);
        if (agentResponse !== null) {
            return res.json({ type: 'vehicle_lookup', reply: agentResponse });
        }

        // Check for flow-related keywords
        if (message.includes('ביטוח רכב') || message.includes('הצעת מחיר') || message.includes('חובה') || message.includes('צד ג') || message.includes('מקיף')) {
            const { startFlow } = await import('./flow.js');
            const firstQuestion = startFlow();
            return res.json({ type: 'flow', question: firstQuestion.question, options: firstQuestion.options || [], id: firstQuestion.id });
        }

        // Fallback to OpenAI
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: "You are an Israeli insurance assistant named Doni. Respond only in Hebrew. Your role is to guide the customer to choose the right insurance. Be professional and persuasive." },
                { role: 'user', content: message }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        const aiResponse = completion.choices[0].message.content;
        res.json({ type: 'openai', reply: aiResponse });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'אירעה שגיאה בעת עיבוד הבקשה שלך' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: "ok" });
});

// Admin login endpoint
app.post('/api/admin-login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM admins WHERE username = ? AND password = ?';

    db.get(query, [username, password], (err, row) => {
        if (err) {
            console.error('Database query error:', err);
            return res.status(500).json({ success: false });
        }

        if (row) {
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    });
});

// Serve landing.html at the root URL
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/landing.html');
});

// Endpoint to handle 'Speak to a human' requests
app.post('/api/contact-human', async (req, res) => {
    const { name, contact, insuranceType } = req.body;

    // Basic validation
    if (!name || !contact || !insuranceType) {
        return res.status(400).json({ error: 'נא למלא את כל השדות הנדרשים' });
    }

    // Insert lead into the database
    const insertLeadQuery = `INSERT INTO leads (name, contact, insurance_type) VALUES (?, ?, ?)`;
    db.run(insertLeadQuery, [name, contact, insuranceType], function(err) {
        if (err) {
            console.error('Error inserting lead:', err);
            return res.status(500).json({ error: 'שגיאה בשמירת הפרטים' });
        }

        // Send email to admin
        emailjs.send('service_fidvxmm', 'template_0svkc5i', {
            to_email: 'admin@example.com',
            subject: 'New Lead for Insurance',
            message: `שם: ${name}, פרטי קשר: ${contact}, סוג ביטוח: ${insuranceType}`
        }).then(response => {
            res.json({ success: 'הפרטים נשלחו בהצלחה' });
        }).catch(error => {
            console.error('Error sending email:', error);
            res.status(500).json({ error: 'שגיאה בשליחת המייל' });
        });
    });
});

// Modify the `/chat` POST route to return a consistent JSON response structure
app.post('/chat', async (req, res) => {
    try {
        const { message, sessionMemory } = req.body;

        // Check for keywords to decide flow
        if (message.includes('ביטוח רכב') || message.includes('הצעת מחיר')) {
            // Import and call startFlow from flow.js
            const { startFlow } = await import('./flow.js');
            const firstQuestion = startFlow();

            return res.json({
                type: 'flow',
                question: firstQuestion.question,
                options: firstQuestion.options || [],
                id: firstQuestion.id
            });
        }

        // Otherwise, call OpenAI
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are an insurance assistant in Hebrew.' },
                { role: 'user', content: message }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        const aiResponse = completion.choices[0].message.content;
        res.json({
            type: 'openai',
            reply: aiResponse
        });
    } catch (error) {
        console.error('OpenAI request failed:', error);
        res.status(500).json({ error: 'OpenAI request failed' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 