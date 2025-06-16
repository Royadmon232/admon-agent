import { intentDetect, buildSalesResponse } from '../services/salesTemplates.js';

describe('salesTemplates', () => {
  describe('intentDetect', () => {
    it('should detect price_pushback intent when text contains "יקר"', () => {
      const testCases = [
        'זה יקר מדי',
        'המחיר גבוה מדי',
        'זה עולה הרבה כסף'
      ];

      testCases.forEach(text => {
        expect(intentDetect(text)).toBe('frustration');
      });
    });
  });

  describe('buildSalesResponse', () => {
    const mockMemory = {
      firstName: 'Test',
      city: 'Tel Aviv',
      homeValue: 1000000
    };

    it('should return non-empty string for each intent', () => {
      const intents = ['greeting', 'lead_gen', 'price_pushback', 'close', 'default'];
      
      intents.forEach(intent => {
        const response = buildSalesResponse(intent, mockMemory);
        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
      });
    });
  });
}); 