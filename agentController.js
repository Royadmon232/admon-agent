import fs from 'fs/promises';
import axios from 'axios';
import { cosine } from './utils.js';

const EMB_MODEL = "text-embedding-3-small";
const SEMANTIC_THRESHOLD = 0.83;
const PRIMARY_MODEL = 'text-embedding-3-small';
const FALLBACK_MODEL = 'text-embedding-ada-002';

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
export async function semanticLookup(userMsg) {
  if (KNOWLEDGE.length === 0) return null;  // skip if no vectors

  const getEmbedding = async (model) => {
    const { data } = await axios.post(
      'https://api.openai.com/v1/embeddings',
      { model, input: userMsg },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return data.data[0].embedding;
  };

  let u;
  try {
    u = await getEmbedding(PRIMARY_MODEL);
  } catch (e) {
    if (e.response?.data?.error?.code === 'model_not_found') {
      console.warn('PRIMARY_MODEL unavailable → using FALLBACK_MODEL');
      try { 
        u = await getEmbedding(FALLBACK_MODEL); 
      } catch (e) { 
        console.error('Fallback failed:', e.message); 
        return null; 
      }
    } else {
      console.error('Embed error:', e.message);
      return null;
    }
  }

  let best = { score: 0, answer: null };
  
  for (const row of KNOWLEDGE) {
    const score = cosine(u, row.v);
    if (score > best.score) best = { score, answer: row.a };
  }
  
  if (best.score >= SEMANTIC_THRESHOLD) {
    return best.answer;
  }

  // If semantic search didn't find a good match, try lexical
  return await lexicalFallback(userMsg, stringSimilarity);
} 