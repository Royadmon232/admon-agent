import fs from 'fs/promises';
import axios from 'axios';
import pkg from 'unorm';
const { normalize: nfd } = pkg;

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.78;
const PRIMARY_MODEL = 'text-embedding-3-small';
const FALLBACK_MODEL = 'text-embedding-ada-002';

const hebEndings = { ך:'כ', ם:'מ', ן:'נ', ף:'פ', ץ:'צ' };

/** Basic Hebrew text normalizer:
 *  • NFKC / NFD canonical form
 *  • strips punctuation
 *  • replaces final letters with regular forms
 *  • collapses multiple spaces
 *  • lower-cases
 */
function normalize(t = "") {
  return nfd(t)
    .replace(/[.,!?;:()״""\-'"`]/g, " ")
    .replace(/[ךםןףץ]/g, c => hebEndings[c])
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Load knowledge base once at startup
let KNOWLEDGE = [];
try {
  const knowledgePath = new URL('./insurance_knowledge.json', import.meta.url);
  const rawData = await fs.readFile(knowledgePath, 'utf8');
  const insuranceKnowledgeBase = JSON.parse(rawData);
  KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa;
  console.log(`✅ Loaded ${KNOWLEDGE.length} knowledge base entries`);
} catch (e) {
  console.error('⚠️  Failed to load knowledge base:', e.message);
  KNOWLEDGE = [];
}

// GPT-4o based semantic question answering
export async function semanticLookup(userMsg) {
  if (!process.env.OPENAI_API_KEY || KNOWLEDGE.length === 0) return null;

  const systemPrompt = `אתה סוכן ביטוח דירות מקצועי ואדיב. תפקידך לענות על שאלות בנושא ביטוח דירה בצורה מקצועית, ידידותית ומקיפה.

כל תשובה שלך חייבת:
1. להיות בעברית תקינה ומקצועית
2. להיות מנוסחת בצורה ידידותית ומכבדת
3. להתייחס ישירות לשאלה שנשאלה
4. לכלול את כל המידע הרלוונטי והחשוב
5. להיות מדויקת מבחינה מקצועית

יש לך גישה לרשימת שאלות ותשובות שכיחות. עליך:
1. לנסות למצוא את התשובה המתאימה ביותר מהרשימה, לפי משמעות השאלה (לא לפי מילים זהות)
2. אם אין תשובה מתאימה ברשימה, עליך לענות בעצמך בצורה מקצועית ועניינית
3. לוודא שהתשובה שלמה ומכסה את כל ההיבטים החשובים של השאלה

הנה רשימת השאלות והתשובות:
${KNOWLEDGE.map(qa => `שאלה: ${qa.question}\nתשובה: ${qa.answer}\n`).join('\n')}`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg }
        ],
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const answer = response.data.choices[0].message.content.trim();
    console.log("GPT-4o response:", answer);
    return answer;
  } catch (error) {
    console.error("Error calling GPT-4o:", error.response?.data || error.message);
    return null;
  }
}

// Export the normalize function
export { normalize }; 