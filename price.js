// price.js

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';

// Function to get database connection
async function getDB() {
    return open({
        filename: './insuranceQuotes.sqlite',
        driver: sqlite3.Database
    });
}

// Function to calculate insurance price
async function calculatePrice(userData) {
    const { age, gender, carType, carYear, carEngine, insuranceType } = userData;
    const db = await getDB();
    
    // Map insurance type to table name
    const tableMap = {
        'חובה': 'mandatory',
        'צד ג': 'thirdParty',
        'מקיף': 'comprehensive',
        'combined': 'combined'
    };
    
    const tableName = tableMap[insuranceType];
    if (!tableName) {
        throw new Error(`Invalid insurance type: ${insuranceType}`);
    }

    // Query the database for matching records
    const quotes = await db.all(`
        SELECT company, base_price
        FROM ${tableName}
        WHERE age = ? 
        AND gender = ?
        AND car_type = ?
        AND car_year = ?
        AND car_engine = ?
        ORDER BY base_price ASC
    `, [age, gender, carType, carYear, carEngine]);

    await db.close();

    // Format the results
    return quotes.map(quote => ({
        company: quote.company,
        price: quote.base_price
    }));
}

// Function to apply modifiers to the base price
function applyModifiers(basePrice, userData, modifiers) {
    let adjustedPrice = basePrice;
    let reasons = [];

    modifiers.forEach(modifier => {
        const { conditionName, type, value, criteria } = modifier;
        let criteriaMet = true;

        for (const key in criteria) {
            const condition = criteria[key];
            const userValue = userData[key];

            if (typeof condition === 'string' && condition.startsWith('>=')) {
                criteriaMet = criteriaMet && (userValue >= parseInt(condition.slice(2)));
            } else if (typeof condition === 'string' && condition.startsWith('<')) {
                criteriaMet = criteriaMet && (userValue < parseInt(condition.slice(1)));
            } else {
                criteriaMet = criteriaMet && (userValue === condition);
            }
        }

        if (criteriaMet) {
            if (type === 'discount') {
                adjustedPrice *= (1 + value / 100);
            } else if (type === 'surcharge') {
                adjustedPrice *= (1 + value / 100);
            }
            reasons.push(conditionName);
        }
    });

    return { adjustedPrice, reasons };
}

// Main function to process user data and return best quotes
export async function processUserData(userData) {
    try {
        const bestQuotes = await calculatePrice(userData);

        // Load modifiers
        const modifiers = JSON.parse(fs.readFileSync('./pricingModifiers.json', 'utf8'));

        // Apply modifiers to each quote
        return bestQuotes.map(quote => {
            const { adjustedPrice, reasons } = applyModifiers(quote.price, userData, modifiers);
            return {
                company: quote.company,
                price: quote.price,
                adjustedPrice: adjustedPrice.toFixed(2),
                reasonForAdjustment: reasons.join(', ')
            };
        });
    } catch (error) {
        console.error('שגיאה בעיבוד נתוני המשתמש:', error);
        throw error;
    }
} 