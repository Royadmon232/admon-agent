import { normalize } from "../utils/normalize.js";

// Get semantic match from FAQ
const match = semanticLookup(normalize(message), faqArray);
const preview = match ? match.slice(0, 50) : "";
if (!match) console.warn("[semanticLookup] No FAQ match found"); 