/**
 * Generate OpenAI embeddings for every QA item that lacks the `embedding` field.
 * Run via:  npm run embed     (requires OPENAI_API_KEY in .env)
 * 
 * How to generate embeddings locally:
 * 1. Create a `.env` file in your project root with:
 *    OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * 2. Run: npm run embed
 * 3. Only commit the updated `insurance_knowledge.json` file – never commit `.env`!
 */
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";

// Debug: Print current working directory
console.log('Current working directory:', process.cwd());

// Debug: Check if .env exists
const envPath = path.resolve(process.cwd(), '.env');
console.log('Looking for .env at:', envPath);
console.log('.env exists:', fs.existsSync(envPath));

// Load environment variables
const result = dotenv.config();
console.log('dotenv config result:', result);

// Validate API key
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY missing. Please create a `.env` file in your project root with your OpenAI API key.');
  process.exit(1);
}

const KB_PATH = "./insurance_knowledge.json";
const PRIMARY_MODEL = "text-embedding-3-small";
const FALLBACK_MODEL = "text-embedding-ada-002";

const getEmbedding = async (text, model) => {
  try {
    const { data } = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { model, input: text },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return data.data[0].embedding;
  } catch (e) {
    if (e.response?.status === 401) {
      console.error('❌ Invalid API key. Please check your OPENAI_API_KEY in .env');
      process.exit(1);
    }
    throw e;
  }
};

const kbObj = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));
for (const row of kbObj.insurance_home_il_qa) {
  if (!Array.isArray(row.embedding)) {
    try {
      row.embedding = await getEmbedding(row.question, PRIMARY_MODEL);
    } catch (e) {
      if (e.response?.data?.error?.code === 'model_not_found') {
        console.warn('PRIMARY_MODEL unavailable → using FALLBACK_MODEL');
        try {
          row.embedding = await getEmbedding(row.question, FALLBACK_MODEL);
        } catch (e) {
          console.error(`Failed to generate embedding for: ${row.question}`);
          console.error('Error:', e.message);
          continue;
        }
      } else {
        console.error(`Failed to generate embedding for: ${row.question}`);
        console.error('Error:', e.message);
        continue;
      }
    }
    await new Promise(r => setTimeout(r, 60));   // stay under 20 rps
  }
}
fs.writeFileSync(KB_PATH, JSON.stringify(kbObj, null, 2));
console.log("✅ embeddings updated"); 