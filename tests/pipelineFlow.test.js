import { jest } from '@jest/globals';
import { handleMessage } from '../src/agentController.js';
import { getHistory, appendExchange } from '../services/memoryService.js';
import { lookupRelevantQAs } from '../services/vectorSearch.js';
import { smartAnswer } from '../services/ragChain.js';

// Mock dependencies
jest.mock('../services/memoryService.js');
jest.mock('../services/vectorSearch.js');
jest.mock('../services/ragChain.js');

describe('Pipeline Flow Integration', () => {
  const mockPhone = '+1234567890';
  const mockHistory = [
    { role: 'user', content: 'מה המחיר של ביטוח דירה?' },
    { role: 'assistant', content: 'המחיר תלוי בגודל הדירה, מיקום, ותכונות נוספות.' }
  ];
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock memory service
    getHistory.mockResolvedValue({
      history: mockHistory,
      customer: { firstName: 'Test' }
    });
    appendExchange.mockResolvedValue(undefined);
    
    // Mock vector search
    lookupRelevantQAs.mockResolvedValue([]);
    
    // Mock smartAnswer
    smartAnswer.mockResolvedValue('Test answer');
  });
  
  test('handles multiple questions with vector search fallback', async () => {
    // Mock user message with two questions
    const userMsg = 'מה המחיר של ביטוח דירה? ואיך אני יכול לבטל את הפוליסה?';
    
    // Mock vector search to return no matches for first question
    lookupRelevantQAs
      .mockResolvedValueOnce([]) // No matches for first question
      .mockResolvedValueOnce([{ question: 'How to cancel?', answer: 'Call us' }]); // Match for second
    
    // Mock smartAnswer responses
    smartAnswer
      .mockResolvedValueOnce('The price depends on...') // First question
      .mockResolvedValueOnce('To cancel, you need to...'); // Second question
    
    // Call handleMessage
    const response = await handleMessage(mockPhone, userMsg);
    
    // Verify response format
    expect(response).toContain('1. The price depends on...');
    expect(response).toContain('2. To cancel, you need to...');
    
    // Verify vector search was called for both questions
    expect(lookupRelevantQAs).toHaveBeenCalledTimes(2);
    
    // Verify smartAnswer was called for both questions
    expect(smartAnswer).toHaveBeenCalledTimes(2);
    
    // Verify exchange was appended to history
    expect(appendExchange).toHaveBeenCalledWith(
      mockPhone,
      userMsg,
      expect.any(String),
      expect.objectContaining({
        intent: expect.any(String),
        timestamp: expect.any(String)
      })
    );
  });
  
  test('handles zero vector search matches gracefully', async () => {
    // Mock user message
    const userMsg = 'מה המחיר של ביטוח דירה?';
    
    // Mock vector search to return no matches
    lookupRelevantQAs.mockResolvedValue([]);
    
    // Mock smartAnswer to return a fallback response
    smartAnswer.mockResolvedValue('מצטער, אני לא בטוח לגבי התשובה לשאלה זו.');
    
    // Call handleMessage
    const response = await handleMessage(mockPhone, userMsg);
    
    // Verify fallback response
    expect(response).toContain('מצטער');
    
    // Verify vector search was called
    expect(lookupRelevantQAs).toHaveBeenCalled();
    
    // Verify smartAnswer was called with history
    expect(smartAnswer).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array)
    );
  });
}); 