import { jest } from '@jest/globals';
import { smartAnswer } from '../services/ragChain.js';

describe('smartAnswer', () => {
  let mockLLM;
  
  beforeEach(() => {
    // Mock the LLM response
    mockLLM = {
      invoke: jest.fn().mockResolvedValue({ content: 'Test response' })
    };
    
    // Mock the vectorStore
    global.vectorStore = {
      similaritySearchWithScore: jest.fn().mockResolvedValue([])
    };
  });

  test('filters out invalid messages', async () => {
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

    // Mock the LLM to capture the messages it receives
    let receivedMessages;
    mockLLM.invoke = jest.fn().mockImplementation((messages) => {
      receivedMessages = messages;
      return Promise.resolve({ content: 'Test response' });
    });

    // Call smartAnswer with the invalid messages
    await smartAnswer('test question', invalidMessages);

    // Verify that only valid messages were passed to the LLM
    expect(receivedMessages).toHaveLength(2); // Only the two valid messages
    expect(receivedMessages).toEqual([
      { role: 'system', content: 'valid message' },
      { role: 'assistant', content: 'another valid message' }
    ]);
  });

  test('handles empty message array', async () => {
    const response = await smartAnswer('test question', []);
    expect(response).toBeDefined();
  });

  test('handles GPT timeout gracefully', async () => {
    // Mock LLM to simulate timeout
    mockLLM.invoke = jest.fn().mockRejectedValue(new Error('Timeout'));
    
    // Call smartAnswer with a timeout
    const response = await smartAnswer('test question', []);
    
    // Should return a graceful fallback message
    expect(response).toBeDefined();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
    expect(response).toContain('מצטער');
  });
}); 