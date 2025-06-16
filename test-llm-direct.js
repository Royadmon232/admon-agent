import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import 'dotenv/config';

async function testLLMDirect() {
  try {
    console.log('Testing direct LLM invocation...\n');
    
    const llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o',
      temperature: 0.7
    });
    
    const messages = [
      new SystemMessage('אתה עוזר ידידותי שעונה בעברית.'),
      new HumanMessage('מה זה ביטוח דירה?')
    ];
    
    console.log('Invoking LLM...');
    const response = await llm.invoke(messages);
    console.log('Response type:', typeof response);
    console.log('Response keys:', Object.keys(response));
    console.log('Response content:', response.content);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testLLMDirect(); 