import { smartAnswer, initializeChain } from './services/ragChain.js';

async function test() {
  console.log('Initializing chain...');
  await initializeChain();
  
  console.log('\nTest 1: First greeting');
  const r1 = await smartAnswer('שלום', []);
  console.log(r1);
  
  console.log('\nTest 2: Follow-up question');
  const r2 = await smartAnswer('מה ההבדל בין ביטוח מבנה לתכולה?', [
    {user: 'שלום', bot: 'שלום! אני דוני, סוכן ביטוח דירות. איך אוכל לעזור?'}
  ]);
  console.log(r2);
  
  console.log('\nTest 3: Another follow-up');
  const r3 = await smartAnswer('תסביר שוב', [
    {user: 'שלום', bot: 'שלום! אני דוני, סוכן ביטוח דירות. איך אוכל לעזור?'},
    {user: 'מה ההבדל בין ביטוח מבנה לתכולה?', bot: r2}
  ]);
  console.log(r3);
  
  console.log('\nTest 4: New question after conversation');
  const r4 = await smartAnswer('מה זה ביטוח צד ג?', [
    {user: 'שלום', bot: 'שלום! אני דוני, סוכן ביטוח דירות. איך אוכל לעזור?'},
    {user: 'מה ההבדל בין ביטוח מבנה לתכולה?', bot: r2},
    {user: 'תסביר שוב', bot: r3}
  ]);
  console.log(r4);
}

test().catch(console.error); 