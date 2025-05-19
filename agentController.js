import fs from 'fs/promises';
import axios from 'axios';
import { cosine } from './index.js';

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.83;

// Load knowledge base once at startup
let KNOWLEDGE = [];
try {
  const knowledgePath = new URL('./insurance_knowledge.json', import.meta.url);
  const rawData = await fs.readFile(knowledgePath, 'utf8');
  const insuranceKnowledgeBase = JSON.parse(rawData);
  KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa
    .filter((r) => Array.isArray(r.embedding))
    .map((r) => ({ q: r.question, a: r.answer, v: r.embedding }));
  console.log(`✅ Loaded ${KNOWLEDGE.length} knowledge base entries`);
} catch (e) {
  console.error('⚠️  Failed to load knowledge base:', e.message);
  KNOWLEDGE = [];
}

// Fallback to lexical matching if semantic search fails
async function lexicalFallback(userMsg, stringSimilarity) {
  if (!KNOWLEDGE.length || !stringSimilarity) return null;
  
  try {
    const qs = KNOWLEDGE.map(r => r.q);
    const { bestMatch } = stringSimilarity.findBestMatch(userMsg, qs);
    if (bestMatch.rating >= 0.75) {
      return KNOWLEDGE[bestMatch.bestMatchIndex].a;
    }
  } catch (e) {
    console.error('⚠️  Lexical fallback failed:', e.message);
  }
  return null;
}

// Main semantic lookup with fallbacks
export async function semanticLookup(userMsg, stringSimilarity) {
  // Skip API call if knowledge base is empty
  if (!KNOWLEDGE.length) {
    console.log('ℹ️  Knowledge base is empty, skipping semantic lookup');
    return null;
  }

  try {
    // Try semantic search first
    const { data } = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { model: EMB_MODEL, input: userMsg },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    
    const u = data.data[0].embedding;
    let best = { score: 0, answer: null };
    
    for (const row of KNOWLEDGE) {
      const score = cosine(u, row.v);
      if (score > best.score) best = { score, answer: row.a };
    }
    
    if (best.score >= SEMANTIC_THRESHOLD) {
      return best.answer;
    }
  } catch (e) {
    console.error('⚠️  Semantic lookup failed:', e.message);
    // Fall back to lexical matching
    return await lexicalFallback(userMsg, stringSimilarity);
  }

  // If semantic search didn't find a good match, try lexical
  return await lexicalFallback(userMsg, stringSimilarity);
} 