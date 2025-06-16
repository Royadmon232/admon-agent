import { jest } from '@jest/globals';

// Mock environment variables
process.env.OPENAI_API_KEY = 'test-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.TWILIO_ACCOUNT_SID = 'ACtest1234567890abcdef1234567890ab';  // Must start with AC
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token-1234567890abcdef';
process.env.TWILIO_PHONE_NUMBER = '+1234567890';
process.env.WHATSAPP_PHONE_NUMBER = '+1234567890';
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Set test timeout
jest.setTimeout(30000);

// Mock fetch if needed
global.fetch = jest.fn(); 