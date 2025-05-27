// Test script to verify Twilio daily limit error handling
import { sendWapp } from './services/twilioService.js';

// Mock the Twilio client to simulate daily limit error
const originalTwilio = await import('twilio');

// Create a mock that throws the daily limit error
const mockClient = {
  messages: {
    create: () => {
      const error = new Error('Daily message limit reached');
      error.code = 63016; // Twilio daily limit error code
      throw error;
    }
  }
};

console.log('🧪 Testing Twilio daily limit error handling...');

try {
  // This should gracefully handle the daily limit error
  const result = await sendWapp('+1234567890', 'Test message');
  
  if (result.success === false && result.error === 'Daily message limit reached') {
    console.log('✅ Daily limit error handled gracefully');
    console.log('Result:', result);
  } else {
    console.log('❌ Unexpected result:', result);
  }
} catch (error) {
  console.log('❌ Test failed with error:', error.message);
}

console.log('🧪 Test completed'); 