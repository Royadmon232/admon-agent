import { jest } from '@jest/globals';

// Mock environment variables BEFORE imports
process.env.TWILIO_ACCOUNT_SID = 'ACtest1234567890abcdef1234567890ab';
process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
process.env.TWILIO_WHATSAPP_FROM_NUMBER = 'whatsapp:+14155238886';
process.env.TWILIO_SMS_SID = 'test_sms_sid';

// Mock twilio module
jest.mock('twilio', () => {
  const mockMessages = {
    create: jest.fn().mockResolvedValue({ sid: 'test_sid' })
  };
  return jest.fn(() => ({
    messages: mockMessages
  }));
});

import twilio from 'twilio';
import { sendWapp, smsFallback } from '../services/twilioService.js';

describe('Twilio Service', () => {
  let mockTwilioClient;

  beforeEach(() => {
    mockTwilioClient = twilio();
    jest.clearAllMocks();
  });

  describe('sendWapp', () => {
    it('should call Twilio client messages.create with correct parameters', async () => {
      const to = '+1234567890';
      const body = 'Test message';

      const result = await sendWapp(to, body);
      
      expect(result.success).toBe(true);
      expect(result.sid).toBe('test_sid');
      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith({
        from: expect.any(String),
        to,
        body
      });
    });

    it('should handle errors gracefully', async () => {
      const mockError = new Error('Test error');
      mockTwilioClient.messages.create.mockRejectedValueOnce(mockError);

      const result = await sendWapp('+1234567890', 'Test message');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('smsFallback', () => {
    it('should call Twilio client messages.create with correct parameters', async () => {
      const to = '+1234567890';
      const body = 'Test SMS';

      const result = await smsFallback(to, body);
      
      expect(result.success).toBe(true);
      expect(result.sid).toBe('test_sid');
      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith({
        from: expect.any(String),
        to,
        body
      });
    });

    it('should handle errors gracefully', async () => {
      const mockError = new Error('Test error');
      mockTwilioClient.messages.create.mockRejectedValueOnce(mockError);

      const result = await smsFallback('+1234567890', 'Test SMS');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
}); 