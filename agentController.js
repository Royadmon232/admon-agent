// Simulated agent system

import axios from 'axios';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';
import fs from 'fs';

const router = express.Router();

const processedPlates = new Set();

// Mock functions representing different tools
async function fetchVehicleData(licensePlate) {
    try {
        const filterQuery = encodeURIComponent(JSON.stringify({ mispar_rechev: licensePlate }));
        const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=053ea72f-8bc0-4b7e-bc78-42cfc97bd0cd&filters=${filterQuery}`;
        
        const response = await axios.get(url);
        const records = response.data.result.records;

        if (records && records.length > 0) {
            const { tozeret_nm, degem_nm, shnat_yitzur, sug_delek_nm } = records[0];
            return `הרכב שלך הוא ${tozeret_nm} ${degem_nm}, שנת ${shnat_yitzur}, ${sug_delek_nm}.`;
        } else {
            console.log('🔍 No records found for plate:', licensePlate);
            return 'לא נמצא רכב עם מספר רישוי כזה במאגר.';
        }
    } catch (error) {
        console.error('❌ Error fetching vehicle data:', error);
        // Only fallback to dummy data if API call fails completely
        return getVehicleInfoByPlate(licensePlate);
    }
}


// Dummy vehicle data for testing
function getVehicleInfoByPlate(plateNumber) {
    // Simple hash function to get consistent dummy data for the same plate
    const hash = plateNumber.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    const models = [
        { make: 'טויוטה', model: 'קורולה', year: 2020, color: 'כסוף' },
        { make: 'הונדה', model: 'סיוויק', year: 2019, color: 'שחור' },
        { make: 'מזדה', model: '3', year: 2021, color: 'לבן' },
        { make: 'יונדאי', model: 'איוניק', year: 2022, color: 'כחול' },
        { make: 'סובארו', model: 'אימפרזה', year: 2018, color: 'אדום' }
    ];
    
    const selectedModel = models[hash % models.length];
    return `הרכב שלך הוא ${selectedModel.make} ${selectedModel.model}, שנת ${selectedModel.year}, צבע ${selectedModel.color}`;
}

function calculateInsuranceQuote(userData) {
    return `הצעת מחיר לביטוח: ${JSON.stringify(userData)}`;
}

function explainCoverage(type) {
    return `הסבר על כיסוי ביטוח מסוג: ${type}`;
}

// Helper function to extract license plate from text
function extractLicensePlate(text) {
    // Match patterns for Israeli license plates (7-8 digits)
    const platePattern = /\d{2,3}[-]?\d{2,3}[-]?\d{2,3}/;
    const match = text.match(platePattern);
    if (!match) return null;
    
    // Clean the plate number (remove hyphens and spaces)
    const cleanPlate = match[0].replace(/[- ]/g, '');
    
    // Validate plate length (7-8 digits)
    return (cleanPlate.length >= 7 && cleanPlate.length <= 8) ? cleanPlate : null;
}

// Helper function to check if message is about vehicle details
function isVehicleQuery(message) {
    const vehicleKeywords = [
        'לוחית רישוי',
        'מספר רכב',
        'מידע על הרכב',
        'תמצא את הרכב שלי',
        'מה הרכב לפי',
        'תגיד לי מה הרכב',
        'מה הרכב',
        'פרטי רכב',
        'מה יש על הרכב',
        'מה הרכב הזה',
        'מה המכונית',
        'מה האוטו',
        'תחפש את הרכב',
        'תמצא את המכונית',
        'מידע על המכונית'
    ];
    
    return vehicleKeywords.some(keyword => message.includes(keyword));
}

// Enhance Doni's response to be more persuasive and professional
function enhanceResponse(response) {
    const persuasivePhrases = [
        "אני כאן כדי לעזור לך בכל שאלה.",
        "בוא נבדוק איך אפשר להפיק לך הצעה מותאמת.",
        "אני ממליץ לבדוק את האפשרויות המיוחדות שלנו.",
        "תוכל להרוויח מהצעות משתלמות במיוחד.",
        "אשמח לעזור לך למצוא את הפתרון הטוב ביותר עבורך."
    ];
    
    // Randomly select a persuasive phrase to append
    const randomPhrase = persuasivePhrases[Math.floor(Math.random() * persuasivePhrases.length)];
    return `${response} ${randomPhrase}`;
}

// Main function to determine which tool to use
export async function handleUserMessage(message) {
    try {
        // Check for vehicle-related queries
        if (isVehicleQuery(message)) {
            const licensePlate = extractLicensePlate(message);
            if (licensePlate) {
                // Check if the license plate was already processed
                if (!processedPlates.has(licensePlate)) {
                    processedPlates.add(licensePlate);
                }
                const vehicleData = await fetchVehicleData(licensePlate);
                return enhanceResponse(vehicleData);
            } else {
                return enhanceResponse('לא הצלחתי לזהות את מספר הרכב. נסה לכתוב רק את המספר.');
            }
        } else if (message.includes('הצעת מחיר')) {
            return enhanceResponse(calculateInsuranceQuote({ age: 30, car: 'Toyota' })); // Example user data
        } else {
            // Fallback to OpenAI for other queries
            return null; // Return null to indicate this should be handled by OpenAI
        }
    } catch (error) {
        console.error('Error handling user message:', error);
        throw error;
    }
}

// Open the database
async function openDb() {
    return open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });
}

// Function to save session data
export async function saveSessionData(sessionId, userName, plateNumber, vehicleData) {
    const db = await openDb();
    await db.run(
        `INSERT INTO sessions (session_id, user_name, plate_number, vehicle_data, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
        sessionId, userName, plateNumber, JSON.stringify(vehicleData)
    );
    await db.close();
}

// Function to retrieve session data
export async function getSessionData(sessionId) {
    const db = await openDb();
    const session = await db.get(
        `SELECT * FROM sessions WHERE session_id = ?`,
        sessionId
    );
    await db.close();
    return session;
}

// Function to retrieve all session data
router.get('/dashboard', async (req, res) => {
    const db = await openDb();
    const sessions = await db.all('SELECT * FROM sessions');
    await db.close();
    res.json(sessions);
});

// Function to delete a session
router.delete('/dashboard/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const db = await openDb();
    await db.run('DELETE FROM sessions WHERE session_id = ?', sessionId);
    await db.close();
    res.status(204).send();
});

// Function to export session data
router.get('/dashboard/export', async (req, res) => {
    const db = await openDb();
    const sessions = await db.all('SELECT * FROM sessions');
    await db.close();
    res.setHeader('Content-Disposition', 'attachment; filename="sessions.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(sessions));
});

// Function to calculate the best insurance offer
export async function calculateBestOffer(userDetails) {
    const data = fs.readFileSync('insuranceRates.json');
    const rates = JSON.parse(data);

    const { age, gender, vehicleType } = userDetails;
    let ageCategory;

    if (age < 25) {
        ageCategory = 'young';
    } else if (age < 50) {
        ageCategory = 'middle';
    } else {
        ageCategory = 'senior';
    }

    let bestOffer = { company: '', price: Infinity };

    for (const company in rates) {
        const price = rates[company][gender][ageCategory];
        if (price < bestOffer.price) {
            bestOffer = { company, price };
        }
    }

    return `בהתאם לפרטים שסיפקת, ההצעה המשתלמת ביותר היא של חברת ${bestOffer.company} – ${bestOffer.price.toLocaleString()} ₪ בשנה`;
}

export default router; 