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
  KNOWLEDGE = insuranceKnowledgeBase.insurance_home_il_qa
    .map((r) => ({ q: r.question, a: r.answer }));
  console.log(`✅ Loaded ${KNOWLEDGE.length} knowledge base entries`);
} catch (e) {
  console.error('⚠️  Failed to load knowledge base:', e.message);
  KNOWLEDGE = [];
}

// Simple keyword-based lookup
export async function semanticLookup(userMsg) {
  userMsg = normalize(userMsg);
  if (KNOWLEDGE.length === 0) return null;

  // Simple keyword matching
  const keywords = userMsg.split(/\s+/);
  const matches = KNOWLEDGE.filter(entry => {
    const normalizedQ = normalize(entry.q);
    return keywords.some(keyword => normalizedQ.includes(keyword));
  });

  if (matches.length > 0) {
    // Return the first match for now
    return matches[0].a;
  }

  return null;
}

// Export the normalize function
export { normalize }; 