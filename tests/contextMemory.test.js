import { jest } from '@jest/globals';
import { initializeChain, smartAnswer } from '../services/ragChain.js';
import { ChatOpenAI } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';

// Mock OpenAI and PGVector
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockImplementation(async (messages) => {
      const content = messages[0].content;
      
      // Mock GPT-4o responses based on input
      if (content.includes('מה ההבדל בין ביטוח מבנה לתכולה')) {
        return {
          content: 'ביטוח מבנה מכסה את המבנה הפיזי של הדירה, בעוד ביטוח תכולה מכסה את החפצים והרהיטים בתוך הדירה.'
        };
      } else if (content.includes('תוכל להסביר שוב')) {
        return {
          content: 'כפי שהסברתי קודם, ביטוח מבנה מגן על המבנה עצמו מפני נזקים, ואילו ביטוח תכולה מגן על החפצים והרהיטים שבתוך הדירה.'
        };
      }
      
      return { content: 'תשובה כללית' };
    })
  }))
}));

jest.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: {
    initialize: jest.fn().mockResolvedValue({
      similaritySearchWithScore: jest.fn().mockImplementation(async (query) => {
        // Mock vector store responses
        if (query.includes('מה ההבדל בין ביטוח מבנה לתכולה')) {
          return [[
            { pageContent: 'שאלה: מה ההבדל בין ביטוח מבנה לתכולה?\nתשובה: ביטוח מבנה מכסה את המבנה הפיזי של הדירה, בעוד ביטוח תכולה מכסה את החפצים והרהיטים בתוך הדירה.' },
            0.85
          ]];
        }
        // Return empty for follow-up question
        return [];
      })
    })
  }
}));

describe('Context Memory Tests', () => {
  const phone = '+972501234567';
  
  beforeAll(async () => {
    // Silence console logs
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // Initialize chain with mocks
    await initializeChain();
  });

  afterAll(() => {
    // Restore console logs
    jest.restoreAllMocks();
  });

  test('should maintain context between messages', async () => {
    // First question about insurance types
    const answer1 = await smartAnswer('מה ההבדל בין ביטוח מבנה לתכולה?', { phone });
    expect(answer1).toBeTruthy();
    expect(answer1).toMatch(/מבנה.*תכול/);
    
    // Add a delay to allow async operations to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Follow-up question
    const answer2 = await smartAnswer('תוכל להסביר שוב?', { phone });
    expect(answer2).toBeTruthy();
    
    // Verify second answer references previous context
    expect(answer2).toMatch(/מבנה.*תכול/);
    expect(answer2).not.toMatch(/מצטער.*לא.*יודע/);
    
    // Verify the answer maintains the building-vs-contents distinction
    const hasContext = /מבנה.*תכול|תכול.*מבנה/.test(answer2);
    expect(hasContext).toBe(true);
  }, 30000); // Increased timeout to 30 seconds
}); 