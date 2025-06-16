import { handleMessage } from './src/agentController.js';

async function testSimpleFlow() {
  try {
    console.log('Testing simple message flow...\n');
    
    // Test 1: Simple greeting
    console.log('=== Test 1: Greeting ===');
    const response1 = await handleMessage('+1234567890', 'שלום');
    console.log('Response:', response1);
    console.log('\n');
    
    // Test 2: Insurance question
    console.log('=== Test 2: Insurance Question ===');
    const response2 = await handleMessage('+1234567890', 'מה זה ביטוח דירה?');
    console.log('Response:', response2);
    console.log('\n');
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

testSimpleFlow(); 