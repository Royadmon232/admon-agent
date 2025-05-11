import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

async function setupDatabase() {
    // Create or open the database
    const db = await open({
        filename: './insuranceQuotes.sqlite',
        driver: sqlite3.Database
    });

    // Create tables for each insurance type
    const tables = {
        mandatory: `
            CREATE TABLE IF NOT EXISTS mandatory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                car_type TEXT NOT NULL,
                car_year INTEGER NOT NULL,
                car_engine INTEGER NOT NULL,
                base_price REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `,
        thirdParty: `
            CREATE TABLE IF NOT EXISTS thirdParty (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                car_type TEXT NOT NULL,
                car_year INTEGER NOT NULL,
                car_engine INTEGER NOT NULL,
                base_price REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `,
        comprehensive: `
            CREATE TABLE IF NOT EXISTS comprehensive (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                car_type TEXT NOT NULL,
                car_year INTEGER NOT NULL,
                car_engine INTEGER NOT NULL,
                base_price REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `,
        combined: `
            CREATE TABLE IF NOT EXISTS combined (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                car_type TEXT NOT NULL,
                car_year INTEGER NOT NULL,
                car_engine INTEGER NOT NULL,
                base_price REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `
    };

    // Create tables
    for (const [tableName, createTableSQL] of Object.entries(tables)) {
        await db.exec(createTableSQL);
        
        // Create indexes for each table
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_${tableName}_age ON ${tableName}(age);
            CREATE INDEX IF NOT EXISTS idx_${tableName}_gender ON ${tableName}(gender);
            CREATE INDEX IF NOT EXISTS idx_${tableName}_car_type ON ${tableName}(car_type);
            CREATE INDEX IF NOT EXISTS idx_${tableName}_car_year ON ${tableName}(car_year);
            CREATE INDEX IF NOT EXISTS idx_${tableName}_car_engine ON ${tableName}(car_engine);
            CREATE INDEX IF NOT EXISTS idx_${tableName}_company ON ${tableName}(company);
        `);
    }

    // Create session analytics table
    const sessionAnalyticsTable = `
        CREATE TABLE IF NOT EXISTS session_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            start_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            end_timestamp TIMESTAMP,
            insurance_type TEXT,
            questions_answered INTEGER DEFAULT 0,
            final_quote TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await db.exec(sessionAnalyticsTable);

    // Create leads table
    const createLeadsTable = `
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact TEXT NOT NULL,
            insurance_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `;

    db.run(createLeadsTable, (err) => {
        if (err) {
            console.error('Error creating leads table:', err);
        } else {
            console.log('Leads table created or already exists.');
        }
    });

    // Function to import CSV data
    async function importCSVData(tableName, csvPath) {
        try {
            const data = fs.readFileSync(csvPath, 'utf8');
            const records = parse(data, { columns: true });
            
            const stmt = await db.prepare(`
                INSERT INTO ${tableName} 
                (company, age, gender, car_type, car_year, car_engine, base_price)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            for (const record of records) {
                await stmt.run(
                    record.company,
                    parseInt(record.age),
                    record.gender,
                    record.car_type,
                    parseInt(record.car_year),
                    parseInt(record.car_engine),
                    parseFloat(record.base_price)
                );
            }

            await stmt.finalize();
            console.log(`Imported data for ${tableName}`);
        } catch (error) {
            console.error(`Error importing data for ${tableName}:`, error);
        }
    }

    // Import data from CSV files if they exist
    const csvFiles = {
        mandatory: './pricing_tables/חובה.csv',
        thirdParty: './pricing_tables/צד ג.csv',
        comprehensive: './pricing_tables/מקיף.csv',
        combined: './pricing_tables/combined.csv'
    };

    for (const [tableName, csvPath] of Object.entries(csvFiles)) {
        if (fs.existsSync(csvPath)) {
            await importCSVData(tableName, csvPath);
        } else {
            console.warn(`CSV file not found: ${csvPath}`);
        }
    }

    await db.close();
    console.log('Database setup completed');
}

// Run the setup
setupDatabase().catch(console.error); 