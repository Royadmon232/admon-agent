/**
 * Generate OpenAI embeddings for every QA item that lacks the `embedding` field.
 * Run via:  npm run embed     (requires OPENAI_API_KEY in .env)
 */
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const KB_PATH = "./insurance_knowledge.json";
const MODEL   = "text-embedding-3-small";

const kbObj = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));
for (const row of kbObj.insurance_home_il_qa) {
  if (!Array.isArray(row.embedding)) {
    const { data } = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { model: MODEL, input: row.question },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    row.embedding = data.data[0].embedding;
    await new Promise(r => setTimeout(r, 60));   // stay under 20 rps
  }
}
fs.writeFileSync(KB_PATH, JSON.stringify(kbObj, null, 2));
console.log("✅ embeddings updated"); 