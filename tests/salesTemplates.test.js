import { intentDetect, buildSalesResponse } from '../services/salesTemplates.js';

describe('salesTemplates', () => {
  describe('intentDetect', () => {
    it('should detect price_pushback intent when text contains "יקר"', () => {
      const testCases = [
        'זה יקר מדי',
        'המחיר יקר',
        'זה נראה יקר',
        'האם יש משהו פחות יקר?'
      ];

      testCases.forEach(text => {
        expect(intentDetect(text)).toBe('price_pushback');
      });
    });
  });

  describe('buildSalesResponse', () => {
    it('should return non-empty string for each intent', () => {
      const intents = [
        'price_pushback',
        'interest',
        'objection',
        'ready_to_buy'
      ];

      const mockMemory = {
        first_name: 'ישראל',
        lastMsg: 'שלום'
      };

      intents.forEach(intent => {
        const response = buildSalesResponse(intent, mockMemory);
        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
      });
    });
  });
}); 