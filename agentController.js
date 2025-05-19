import fs from 'fs/promises';
import axios from 'axios';
import { cosine } from './utils.js';
import stringSimilarity from 'string-similarity';
import unorm from "unorm";
const nfd = unorm.normalize;

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
    const qs = KNOWLEDGE.map(r => normalize(r.q));
    const { bestMatch } = stringSimilarity.findBestMatch(normalize(userMsg), qs);
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
  userMsg = normalize(userMsg);
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
  let usingAda = false;
  try {
    u = await getEmbedding(PRIMARY_MODEL);
  } catch (e) {
    if (e.response?.data?.error?.code === 'model_not_found') {
      console.warn('PRIMARY_MODEL unavailable → using FALLBACK_MODEL');
      try { 
        u = await getEmbedding(FALLBACK_MODEL);
        usingAda = true;
        if (usingAda) console.warn("→ Using ada model, threshold set to", SEMANTIC_THRESHOLD - 0.03);
      } catch (e) { 
        console.error('Fallback failed:', e.message); 
        return null; 
      }
    } else {
      console.error('Embed error:', e.message);
      return null;
    }
  }

  const candidates = [];   // [{score, answer}]
  for (const row of KNOWLEDGE) {
    const score = cosine(u, row.v);
    if (candidates.length < 3) candidates.push({ score, answer: row.a });
    else {
      const minIdx = candidates.reduce(
        (m,_,i,arr) => arr[i].score < arr[m].score ? i : m, 0);
      if (score > candidates[minIdx].score) candidates[minIdx] = { score, answer: row.a };
    }
  }
  const best = candidates.sort((a,b) => b.score - a.score)[0] || { score: 0 };
  
  const threshold = usingAda ? SEMANTIC_THRESHOLD - 0.03 : SEMANTIC_THRESHOLD;
  if (best.score >= threshold) {
    return best.answer;
  }

  if (best.score < threshold) {
    // attempt lexical fallback before giving up
    const lex = await lexicalFallback(userMsg, stringSimilarity);
    if (lex) return lex;
  }

  return null;
}

// Export the normalize function
export { normalize }; 