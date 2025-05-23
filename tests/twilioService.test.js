import { jest } from '@jest/globals';
import { sendWapp, smsFallback } from '../services/twilioService.js';

// Mock the Twilio client
jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({ sid: 'test_sid' })
    }
  }));
});

// Mock environment variables
process.env.TWILIO_ACCOUNT_SID = 'test_account_sid';
process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
process.env.TWILIO_WHATSAPP_FROM_NUMBER = 'test_whatsapp_number';
process.env.TWILIO_SMS_SID = 'test_sms_sid';

describe('Twilio Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendWapp', () => {
    it('should call Twilio client messages.create with correct parameters', async () => {
      const to = '+1234567890';
      const body = 'Test message';
      
      const result = await sendWapp(to, body);
      
      expect(result.success).toBe(true);
      expect(result.sid).toBe('test_sid');
    });

    it('should handle errors gracefully', async () => {
      const mockError = new Error('Test error');
      const twilioClient = require('twilio')();
      twilioClient.messages.create.mockRejectedValueOnce(mockError);

      const result = await sendWapp('+1234567890', 'Test message');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
    });
  });

  describe('smsFallback', () => {
    it('should call Twilio client messages.create with correct parameters', async () => {
      const to = '+1234567890';
      const body = 'Test SMS';
      
      const result = await smsFallback(to, body);
      
      expect(result.success).toBe(true);
      expect(result.sid).toBe('test_sid');
    });

    it('should handle errors gracefully', async () => {
      const mockError = new Error('Test error');
      const twilioClient = require('twilio')();
      twilioClient.messages.create.mockRejectedValueOnce(mockError);

      const result = await smsFallback('+1234567890', 'Test SMS');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
    });
  });
}); 