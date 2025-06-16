import { handleMessage } from './src/agentController.js';

async function testGreeting() {
  try {
    console.log('Testing greeting functionality...');
    
    // Test with "hello"
    const response1 = await handleMessage('+1234567890', 'hello');
    console.log('\nTest 1 - "hello":');
    console.log('Response:', response1);
    
    // Test with "שלום"
    const response2 = await handleMessage('+1234567890', 'שלום');
    console.log('\nTest 2 - "שלום":');
    console.log('Response:', response2);
    
    // Test with "היי"
    const response3 = await handleMessage('+1234567890', 'היי');
    console.log('\nTest 3 - "היי":');
    console.log('Response:', response3);
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

testGreeting(); 