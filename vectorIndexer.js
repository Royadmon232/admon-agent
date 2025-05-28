import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import pool from './utils/dbPool.js';
import dotenv from 'dotenv';

dotenv.config();

(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to Render PostgreSQL DB.');
    client.release();

    // Existing reindexing logic (DO NOT MODIFY BELOW)
    async function reindexVectors() {
      if (!process.env.DATABASE_URL) {
        console.error("❌ DATABASE_URL not found in environment variables");
        console.log("Please ensure .env file contains DATABASE_URL");
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        console.error("❌ OPENAI_API_KEY not found in environment variables");
        console.log("Please ensure .env file contains OPENAI_API_KEY");
        return;
      }

      const client = await pool.connect();
      
      try {
        console.log("✅ Connected to database");

        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: process.env.OPENAI_API_KEY,
          modelName: 'text-embedding-3-small'
        });

        // Check if table exists
        const tableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'insurance_qa'
          );
        `);
        
        if (!tableCheck.rows[0].exists) {
          console.error("❌ Table 'insurance_qa' does not exist");
          return;
        }

        const vectorStore = await PGVectorStore.initialize(embeddings, {
          postgresConnectionOptions: {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
              rejectUnauthorized: false
            }
          },
          tableName: "insurance_qa",
          columns: {
            idColumnName: 'id',
            vectorColumnName: 'embedding',
            contentColumnName: 'question',
            metadataColumnName: 'metadata'
          }
        });

        const { rows } = await client.query("SELECT id, question, metadata FROM insurance_qa");
        console.log(`✅ Found ${rows.length} rows to reindex`);

        if (rows.length > 0) {
          await vectorStore.addDocuments(
            rows.map((row) => ({
              pageContent: row.question,
              metadata: row.metadata || {},
            }))
          );
        }

        console.log("✅ Reindexing completed successfully.");
      } catch (error) {
        console.error("❌ Error during reindexing:", error);
        throw error;
      } finally {
        client.release();
      }
    }

    await reindexVectors();

  } catch (e) {
    console.error('❌ Database connection failed. Check your DATABASE_URL:', process.env.DATABASE_URL);
    console.error(e);
    process.exit(1);
  }
})(); 