import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const router = express.Router();

// Get database connection
async function getDB() {
    return open({
        filename: './insuranceQuotes.sqlite',
        driver: sqlite3.Database
    });
}

// Get quotes with filters
router.get('/api/quotes', async (req, res) => {
    try {
        const { date, name, insuranceType } = req.query;
        const db = await getDB();

        // Build the query based on filters
        let query = `
            SELECT 
                q.*,
                CASE 
                    WHEN q.insurance_type = 'mandatory' THEN 'חובה'
                    WHEN q.insurance_type = 'thirdParty' THEN 'צד ג'
                    WHEN q.insurance_type = 'comprehensive' THEN 'מקיף'
                    WHEN q.insurance_type = 'combined' THEN 'משולב'
                END as insurance_type_he
            FROM (
                SELECT * FROM mandatory
                UNION ALL
                SELECT * FROM thirdParty
                UNION ALL
                SELECT * FROM comprehensive
                UNION ALL
                SELECT * FROM combined
            ) q
            WHERE 1=1
        `;
        const params = [];

        if (date) {
            query += ` AND date(q.created_at) = date(?)`;
            params.push(date);
        }

        if (name) {
            query += ` AND q.name LIKE ?`;
            params.push(`%${name}%`);
        }

        if (insuranceType) {
            query += ` AND q.insurance_type = ?`;
            params.push(insuranceType);
        }

        query += ` ORDER BY q.created_at DESC`;

        const quotes = await db.all(query, params);
        await db.close();

        res.json(quotes);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router; 