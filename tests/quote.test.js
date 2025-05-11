import { jest } from '@jest/globals';
import { calculatePrice } from '../price.js';
import { validateQuote } from '../middleware/validation.js';

describe('Quote Calculation', () => {
    const mockUserData = {
        age: 30,
        gender: 'male',
        carType: 'sedan',
        carYear: 2020,
        carEngine: 1600,
        insuranceType: 'חובה'
    };

    test('calculates price correctly for valid input', async () => {
        const quotes = await calculatePrice(mockUserData);
        expect(quotes).toBeDefined();
        expect(Array.isArray(quotes)).toBe(true);
        expect(quotes.length).toBeGreaterThan(0);
        expect(quotes[0]).toHaveProperty('company');
        expect(quotes[0]).toHaveProperty('price');
    });

    test('handles invalid age', async () => {
        const invalidData = { ...mockUserData, age: 15 };
        await expect(calculatePrice(invalidData)).rejects.toThrow();
    });

    test('handles invalid car year', async () => {
        const invalidData = { ...mockUserData, carYear: 1800 };
        await expect(calculatePrice(invalidData)).rejects.toThrow();
    });
});

describe('Quote Validation', () => {
    test('validates correct quote data', () => {
        const validData = {
            age: 25,
            gender: 'female',
            carType: 'SUV',
            carYear: 2022,
            carEngine: 2000,
            insuranceType: 'מקיף'
        };
        expect(validateQuote(validData)).toBe(true);
    });

    test('rejects invalid insurance type', () => {
        const invalidData = {
            age: 25,
            gender: 'female',
            carType: 'SUV',
            carYear: 2022,
            carEngine: 2000,
            insuranceType: 'invalid'
        };
        expect(() => validateQuote(invalidData)).toThrow();
    });
}); 