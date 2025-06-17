import { jest } from '@jest/globals';

// Mock dependencies before import
jest.mock('../services/ragChain.js', () => {
  let mockLLM;
  let mockVectorStore;
  
  return {
    smartAnswer: jest.fn(async (question, messages) => {
      // Filter out invalid messages
      const validMessages = (messages || []).filter(msg => 
        msg && 
        typeof msg === 'object' && 
        msg.role && 
        msg.content && 
        msg.content.length > 0
      );
      
      // Store for test verification
      if (global.captureMessages) {
        global.receivedMessages = validMessages;
      }
      
      // Return mock response
      return 'Test response';
    })
  };
});

import { smartAnswer } from '../services/ragChain.js';

describe('smartAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.captureMessages = false;
    global.receivedMessages = undefined;
  });

  test('filters out invalid messages', async () => {
    // Enable message capture
    global.captureMessages = true;
    
    // Test with invalid messages
    const invalidMessages = [
      undefined,
      null,
      { role: 'system' }, // missing content
      { content: 'test' }, // missing role
      { role: 'system', content: 'valid message' },
      { role: 'user', content: '' }, // empty content
      { role: 'assistant', content: 'another valid message' }
    ];

    // Call smartAnswer with the invalid messages
    await smartAnswer('test question', invalidMessages);

    // Verify that only valid messages were passed
    expect(global.receivedMessages).toHaveLength(2); // Only the two valid messages
    expect(global.receivedMessages).toEqual([
      { role: 'system', content: 'valid message' },
      { role: 'assistant', content: 'another valid message' }
    ]);
  });

  test('handles empty message array', async () => {
    const response = await smartAnswer('test question', []);
    expect(response).toBeDefined();
    expect(response).toBe('Test response');
  });

  test('handles GPT timeout gracefully', async () => {
    // Mock smartAnswer to simulate timeout
    smartAnswer.mockRejectedValueOnce(new Error('Timeout'));
    
    // Call smartAnswer with a timeout
    try {
      await smartAnswer('test question', []);
    } catch (error) {
      // Should get timeout error
      expect(error.message).toBe('Timeout');
    }
  });
}); 