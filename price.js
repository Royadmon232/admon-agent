// price.js

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

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

// Main function to process user data and return best quotes
export async function processUserData(userData) {
    try {
        const bestQuotes = await calculatePrice(userData);
        return bestQuotes;
    } catch (error) {
        console.error('Error processing user data:', error);
        throw error;
    }
} 