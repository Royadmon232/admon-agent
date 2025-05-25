import { jest } from '@jest/globals';
import { remember, recall, updateCustomer } from '../services/memoryService.js';

// Mock pg Pool
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockPool = {
    query: mockQuery,
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mockPool)
  };
});

// Import the mocked pool
import pg from 'pg';
const mockPool = new pg.Pool();

describe('Memory Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('remember()', () => {
    it('should insert customer and memory record', async () => {
      const phone = '+972501234567';
      const key = 'lastMsg';
      const value = 'Hello!';

      await remember(phone, key, value);

      // Verify customer insert
      expect(mockPool.query).toHaveBeenCalledWith(
        'INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING',
        [phone]
      );

      // Verify memory insert
      expect(mockPool.query).toHaveBeenCalledWith(
        'INSERT INTO convo_memory (phone, key, value) VALUES ($1, $2, $3)',
        [phone, key, value]
      );
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('DB error');
      mockPool.query.mockRejectedValueOnce(error);

      await expect(remember('+972501234567', 'key', 'value'))
        .rejects.toThrow('DB error');
    });
  });

  describe('recall()', () => {
    it('should return memory object with latest values', async () => {
      const phone = '+972501234567';
      const mockRows = [
        { key: 'lastMsg', value: 'Hello!' },
        { key: 'lastMsg', value: 'Hi!' }, // Should be ignored (duplicate key)
        { key: 'city', value: 'Tel Aviv' }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockRows });

      const memory = await recall(phone);

      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT key, value FROM convo_memory WHERE phone = $1 ORDER BY ts DESC',
        [phone]
      );

      expect(memory).toEqual({
        lastMsg: 'Hello!',
        city: 'Tel Aviv'
      });
    });

    it('should return empty object on error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const memory = await recall('+972501234567');
      expect(memory).toEqual({});
    });
  });

  describe('updateCustomer()', () => {
    it('should upsert customer with provided fields', async () => {
      const phone = '+972501234567';
      const fields = {
        first_name: 'John',
        city: 'Tel Aviv'
      };

      await updateCustomer(phone, fields);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO customers (phone, first_name, city)'),
        [phone, 'John', 'Tel Aviv']
      );
    });

    it('should do nothing with empty fields object', async () => {
      await updateCustomer('+972501234567', {});
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('DB error');
      mockPool.query.mockRejectedValueOnce(error);

      await expect(updateCustomer('+972501234567', { name: 'John' }))
        .rejects.toThrow('DB error');
    });
  });
}); 