// Test script to verify environment
console.log('Node version:', process.version);
console.log('Current directory:', process.cwd());
console.log('Module type:', typeof module === 'undefined' ? 'ESM' : 'CommonJS');

// Test if we can import ES modules
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Script location:', __filename);
console.log('Script directory:', __dirname);

// Test if we can run a simple async function
async function testAsync() {
  console.log('Async test: Starting');
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('Async test: Completed');
}

testAsync().then(() => {
  console.log('All tests completed successfully');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 