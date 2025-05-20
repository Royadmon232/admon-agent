import he from 'he';
import removeAccents from 'remove-accents';

// Hebrew final letters mapping
const HEBREW_FINAL_LETTERS = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ'
};

/**
 * Normalizes text for consistent embedding generation
 * @param {string} text - The text to normalize
 * @returns {string} The normalized text
 */
export function normalize(text) {
  if (typeof text !== 'string') {
    return ''; // Or throw an error, depending on desired behavior for non-string input
  }

  // 1. Apply NFKC normalization
  let normalizedText = text.normalize('NFKC');

  // 2. Convert to lowercase (covers English and other relevant characters)
  normalizedText = normalizedText.toLowerCase();

  // 3. Strip Hebrew niqqud
  normalizedText = normalizedText.replace(/[\u0591-\u05C7]/g, '');

  // 4. Replace Hebrew final letter forms with standard forms
  normalizedText = normalizedText
    .replace(/ך/g, 'כ')
    .replace(/ץ/g, 'צ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ');

  // 5. Collapse multiple spaces and trim
  normalizedText = normalizedText.replace(/\s+/g, ' ').trim();

  return normalizedText;
}

/**
 * Checks if a string contains Hebrew characters
 * @param {string} text - The text to check
 * @returns {boolean} True if the text contains Hebrew characters
 */
export function containsHebrew(text) {
  return /[\u0590-\u05FF]/.test(text);
}

/**
 * Decodes HTML entities in text
 * @param {string} text - The text to decode
 * @returns {string} The decoded text
 */
export function decodeHtmlEntities(text) {
  return he.decode(text);
} 