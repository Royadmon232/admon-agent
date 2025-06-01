import { normalize } from "../utils/normalize.js";

// Get semantic match from FAQ
const normalizedMsg = normalize(message);
const match = semanticLookup(normalizedMsg, faqArray);
const preview = match ? match.slice(0, 50) : "";
if (!match) console.warn("[semanticLookup] No FAQ match found"); 