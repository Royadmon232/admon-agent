import fs   from "fs";
import path from "path";
import pg   from "pg";

(async () => {
  // 1. טען את קובץ ה-JSON
  const filePath = path.resolve("./insurance_knowledge.json");
  const raw      = fs.readFileSync(filePath, "utf8");
  const { insurance_home_il_qa } = JSON.parse(raw);

  // 2. התחבר ל-PostgreSQL
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // 3. עדכן category & complexity לפי id
  const updateRow = `
    UPDATE insurance_qa
    SET    category   = $1,
           complexity = $2
    WHERE  id         = $3
  `;
  for (const row of insurance_home_il_qa) {
    await client.query(updateRow, [row.category, row.complexity, row.id]);
  }

  // 4. בנה מחדש את metadata לכל השורות
  await client.query(`
    UPDATE insurance_qa
    SET metadata = jsonb_strip_nulls(jsonb_build_object(
      'id',         id,
      'question',   question,
      'answer',     answer,
      'category',   category,
      'complexity', complexity
    ));
  `);

  console.log("✅ Category & complexity populated – metadata refreshed.");
  await client.end();
})(); 