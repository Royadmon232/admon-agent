import { jest } from '@jest/globals';

// Mock pg Pool
jest.mock('pg', () => {
  const mockPool = {
    query: jest.fn(),
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mockPool)
  };
});

// Mock OpenAI 
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn(() => ({
    call: jest.fn().mockResolvedValue({
      content: 'תשובה ממוזגת מגפט'
    })
  })),
  OpenAIEmbeddings: jest.fn(() => ({
    embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3])
  }))
}));

// Mock PGVectorStore
jest.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: {
    initialize: jest.fn().mockResolvedValue({
      similaritySearchWithScore: jest.fn().mockResolvedValue([
        [{
          pageContent: 'Q: מה זה ביטוח מבנה?\nA: ביטוח המכסה נזקים למבנה הדירה',
          metadata: { id: 1 }
        }, 0.85],
        [{
          pageContent: 'Q: מה זה ביטוח תכולה?\nA: ביטוח המכסה נזקים לתכולת הדירה',
          metadata: { id: 2 }
        }, 0.82]
      ])
    })
  }
}));

// Mock ConversationalRetrievalQAChain
jest.mock('langchain/chains', () => ({
  ConversationalRetrievalQAChain: {
    fromLLM: jest.fn((llm, retriever, options) => ({
      call: jest.fn(({ question }) => {
        if (question.includes('ביטוח מבנה')) {
          return Promise.resolve({
            text: 'ביטוח מבנה מכסה נזקים פיזיים למבנה הדירה עצמו, כולל קירות, רצפות, תקרות ומערכות קבועות.'
          });
        } else if (question.includes('ביטוח תכולה')) {
          return Promise.resolve({
            text: 'ביטוח תכולה מגן על כל הרכוש הנייד בדירה - ריהוט, מכשירי חשמל, ביגוד וחפצים אישיים.'
          });
        }
        return Promise.resolve({
          text: 'ביטוח דירה חשוב להגנה על הנכס שלך.'
        });
      })
    }))
  }
}));

// Mock ConversationSummaryBufferMemory
jest.mock('langchain/memory', () => ({
  ConversationSummaryBufferMemory: jest.fn(() => ({
    saveContext: jest.fn()
  }))
}));

// Mock PromptTemplate
jest.mock('@langchain/core/prompts', () => ({
  PromptTemplate: jest.fn((config) => config)
}));

// Mock HumanMessage
jest.mock('@langchain/core/messages', () => ({
  HumanMessage: jest.fn((content) => ({ content })),
  AIMessage: jest.fn((content) => ({ content }))
}));

// Import the function to test after all mocks
import { smartAnswer, initializeChain } from '../services/ragChain.js';
import { ChatOpenAI } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { ConversationalRetrievalQAChain } from 'langchain/chains';

describe('smartAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return null when chain is not initialized', async () => {
    const result = await smartAnswer('מה זה ביטוח דירה?');
    expect(result).toBeNull();
  });

  test('should handle single question and return a string', async () => {
    await initializeChain();
    
    const result = await smartAnswer('מה זה ביטוח דירה?');
    
    expect(result).toBe('ביטוח דירה חשוב להגנה על הנכס שלך.');
    expect(typeof result).toBe('string');
  });

  test('should handle multi-question input and merge answers', async () => {
    await initializeChain();
    
    // Multi-question input with question marks
    const multiQuestion = 'מה זה ביטוח מבנה? ומה זה ביטוח תכולה?';
    const result = await smartAnswer(multiQuestion);
    
    // Verify it returns a merged answer
    expect(result).toBe('תשובה ממוזגת מגפט');
    expect(typeof result).toBe('string');
    
    // Verify GPT was called to merge answers
    const llmInstance = ChatOpenAI.mock.results[0].value;
    expect(llmInstance.call).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('צרף את התשובות הבאות')
        })
      ])
    );
  });

  test('should query vector store with proper parameters', async () => {
    await initializeChain();
    
    await smartAnswer('מה זה ביטוח דירה?');
    
    // Verify vector store was queried
    const vectorStore = await PGVectorStore.initialize.mock.results[0].value;
    expect(vectorStore.similaritySearchWithScore).toHaveBeenCalledWith(
      expect.any(String),
      8 // top-k = 8
    );
  });

  test('should filter results by score threshold 0.80', async () => {
    // Mock vector store with mixed scores
    PGVectorStore.initialize.mockResolvedValueOnce({
      similaritySearchWithScore: jest.fn().mockResolvedValue([
        [{ pageContent: 'High score doc', metadata: {} }, 0.85],
        [{ pageContent: 'Above threshold', metadata: {} }, 0.81],
        [{ pageContent: 'Below threshold', metadata: {} }, 0.75],
        [{ pageContent: 'Low score', metadata: {} }, 0.60]
      ])
    });

    await initializeChain();
    
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    await smartAnswer('test query');
    
    // Verify only documents with score >= 0.80 are logged
    expect(consoleLog).toHaveBeenCalledWith(
      '[RAG] top matches:',
      expect.arrayContaining([
        expect.objectContaining({ score: '0.85' }),
        expect.objectContaining({ score: '0.81' })
      ])
    );
    
    // Check that the logged array has only 2 items (above threshold)
    const ragCall = consoleLog.mock.calls.find(call => call[0] === '[RAG] top matches:');
    expect(ragCall[1]).toHaveLength(2);
    
    consoleLog.mockRestore();
  });

  test('should handle errors gracefully and return null', async () => {
    await initializeChain();
    
    // Mock chain to throw error
    ConversationalRetrievalQAChain.fromLLM.mockReturnValueOnce({
      call: jest.fn().mockRejectedValue(new Error('API Error'))
    });
    
    // Re-initialize with error-throwing chain
    await initializeChain();
    
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    const result = await smartAnswer('test query');
    
    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[LangChain] Error'),
      expect.any(String)
    );
    
    consoleError.mockRestore();
  });

  test('should use memory context when provided', async () => {
    await initializeChain();
    
    const memory = {
      firstName: 'דוד',
      city: 'תל אביב',
      homeValue: '2000000'
    };
    
    await smartAnswer('מה הכיסוי המומלץ?', memory);
    
    // Get the chain instance
    const chainInstance = ConversationalRetrievalQAChain.fromLLM.mock.results[
      ConversationalRetrievalQAChain.fromLLM.mock.results.length - 1
    ].value;
    
    // Verify the chain was called with context appended
    expect(chainInstance.call).toHaveBeenCalledWith({
      question: expect.stringContaining('לקוח בשם דוד')
    });
  });

  test('should always return a non-empty string on success', async () => {
    await initializeChain();
    
    // Test various scenarios
    const scenarios = [
      'שאלה פשוטה',
      'שאלה ראשונה? שאלה שנייה?',
      'מה זה ביטוח מבנה? איך עובד ביטוח תכולה? מה ההבדל ביניהם?'
    ];
    
    for (const question of scenarios) {
      const result = await smartAnswer(question);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
}); 