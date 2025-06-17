import { handleMessage } from './src/agentController.js';

async function testMessageFlow() {
  try {
    console.log('Testing restored message handling functionality...\n');
    
    // Test 1: Single question - should use RAG vector search
    console.log('=== Test 1: Single Question (New Topic) ===');
    const response1 = await handleMessage('+1234567890', 'מה כולל ביטוח דירה בסיסי?');
    console.log('Response:', response1);
    console.log('\n');
    
    // Test 2: Follow-up question - should use conversation context
    console.log('=== Test 2: Follow-up Question ===');
    const response2 = await handleMessage('+1234567890', 'ומה לגבי נזקי מים?');
    console.log('Response:', response2);
    console.log('\n');
    
    // Test 3: Multiple questions - should split and process separately
    console.log('=== Test 3: Multiple Questions ===');
    const response3 = await handleMessage('+1234567890', 'כמה עולה ביטוח דירה? ומה ההבדל בין ביטוח מבנה לתכולה?');
    console.log('Response:', response3);
    console.log('\n');
    
    // Test 4: Unrelated question - should use GPT-4o fallback
    console.log('=== Test 4: Unrelated Question (New Topic) ===');
    const response4 = await handleMessage('+1234567891', 'איך מחשבים את גובה הפרמיה?');
    console.log('Response:', response4);
    console.log('\n');
    
    // Test 5: Greeting and Non-Question Messages
    console.log('\n=== Test 5: Greeting and Non-Question Messages ===');
    await handleMessage('+1234567892', 'שלום');
    await handleMessage('+1234567892', 'מה שלומך?');
    await handleMessage('+1234567892', 'תודה רבה על העזרה');
    
    // Test 6: Specific Question - מה ההבדל בין ביטוח מבנה לתכולה?
    console.log("\n=== Test 6: Specific Question - מה ההבדל בין ביטוח מבנה לתכולה? ===");
    const specificQuestion = "מה ההבדל בין ביטוח מבנה לתכולה?";
    const specificResponse = await handleMessage("+1234567893", specificQuestion);
    console.log("Response:", specificResponse);
    
    // Test 7: Multiple Insurance Questions
    console.log('\n=== Test 7: Multiple Insurance Questions ===');
    const testMessage7 = {
      phone: '+1234567894',
      msg: 'היי, שלום, מה שלומך? רציתי לדעת מה זה כיסוי סייבר ומה זה ביטוח צד ג בביטוח דירה? ומה זה השתתפות עצמית?'
    };
    const result7 = await handleMessage(testMessage7);
    console.log('Response:', JSON.stringify(result7, null, 2));
    
    // Test 8: Name memory test
    console.log('\n=== Test 8: Name Memory Test ===');
    const testPhone = '+1999999999';
    const responseA = await handleMessage(testPhone, 'קוראים לי מנשה צור');
    console.log('Response to first message:', responseA);
    const responseB = await handleMessage(testPhone, 'מה השם שלי המלא?');
    console.log('Response to second message:', responseB);
    
    // Test: Conversation memory integration
    (async () => {
      const testPhone = '+1999999999';
      console.log('\n=== Conversation Memory Integration Test ===');
      const responseA = await handleMessage(testPhone, 'קוראים לי מנשה צור');
      console.log('Response to first message:', responseA);
      const responseB = await handleMessage(testPhone, 'מה השם שלי המלא?');
      console.log('Response to second message:', responseB);
    })();
    
    // Test: Multi-turn insurance context and memory
    (async () => {
      const testPhone = '+1888888888';
      console.log('\n=== Multi-turn Insurance Context & Memory Test ===');
      const response1 = await handleMessage(testPhone, 'מה שלומך?');
      console.log('Response to first message:', response1);
      const response2 = await handleMessage(testPhone, 'מה ההבדל בין ביטוח מבנה לתכולה?');
      console.log('Response to second message:', response2);
      const response3 = await handleMessage(testPhone, 'לא הבנתי תוכל לחזור שוב על מה שרשמת? , בנוסף מה זה כיסוי סייבר?');
      console.log('Response to third message:', response3);
    })();
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

testMessageFlow(); 