import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'fs';
import { handleUserMessage } from './agentController.js';
import emailjs from 'emailjs-com';
import html2pdf from 'html2pdf.js';

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

// Conversation log and message threshold for PDF/email logic
let conversationLog = [];
const MESSAGE_THRESHOLD = 10;

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

// Function to generate PDF
async function generatePDF() {
    // Build the conversation HTML for PDF
    let html = `<h2 style="font-family: Arial, 'Noto Sans Hebrew', sans-serif;">סיכום שיחה עם דוני</h2>`;
    html += `<div>נוצר בתאריך: ${new Date().toLocaleString('he-IL')}</div><br>`;
    conversationLog.forEach(entry => {
        const prefix = entry.isSystem ? 'דוני:' : 'אתה:';
        html += `<div dir="rtl" style="margin-bottom:8px;"><b>${prefix}</b> ${entry.message}</div>`;
    });

    // Create a temporary file
    const tempFile = 'temp_conversation.html';
    fs.writeFileSync(tempFile, html);

    // Generate PDF using html2pdf
    const pdfBuffer = await new Promise((resolve, reject) => {
        const options = {
            margin: 0.5,
            filename: 'insurance_summary.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        html2pdf()
            .from(tempFile)
            .set(options)
            .outputPdf('buffer')
            .then(buffer => {
                // Clean up temp file
                fs.unlinkSync(tempFile);
                resolve(buffer);
            })
            .catch(error => {
                // Clean up temp file even if there's an error
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
                reject(error);
            });
    });

    return pdfBuffer;
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

        // Route through agentController first
        const agentResponse = await handleUserMessage(message);
        
        // If agentController handled the message, return its response
        if (agentResponse !== null) {
            return res.json({ reply: agentResponse });
        }

        // Otherwise, continue to OpenAI GPT-4
        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: "אתה סוכן ביטוח בשם דוני. אתה מדבר רק בעברית, ועוזר ללקוח להבין ולעשות ביטוח. שאל שאלות המשך כמו 'מה גיל הנהג הצעיר?' או 'מה סוג השימוש ברכב?'. הצע המלצות מותאמות אישית כמו 'בהתאם לפרטים שמסרת, אני ממליץ על...'. דבר רק בעברית והשתמש בשפה משכנעת ומקצועית כדי להציע את הפתרונות הטובים ביותר ללקוח.\n\nדוגמאות לשיחה:\n- 'בהתאם לפרופיל שלך, יש לי שתי הצעות משתלמות במיוחד.'\n- 'תרצה שאחשב לך הצעה על ביטוח צד ג' בנוסף?'\n- 'תודה על המידע. אני כבר בודק מה הכי מתאים עבורך...'"
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
            error: 'אירעה שגיאה בעת עיבוד הבקשה שלך' // Translated to Hebrew
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 