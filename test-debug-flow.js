import { smartAnswer } from './services/ragChain.js';
import { lookupRelevantQAs } from './services/vectorSearch.js';

async function testDebugFlow() {
  try {
    console.log('Testing debug flow...\n');
    
    // Test direct smartAnswer call with relevant QAs
    console.log('=== Test: Direct smartAnswer with QAs ===');
    
    // First get some relevant QAs
    const relevantQAs = await lookupRelevantQAs('מה זה ביטוח דירה?', 5, 0.65);
    console.log('Found QAs:', relevantQAs.length);
    console.log('First QA:', relevantQAs[0]);
    
    // Now test smartAnswer with these QAs
    const answer = await smartAnswer('מה זה ביטוח דירה?', [], relevantQAs);
    console.log('Answer:', answer);
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

testDebugFlow(); 