import axios from 'axios';

export async function askGPT(text) {
  if (!process.env.OPENAI_API_KEY) return null;

  const systemPrompt = "אתה סוכן ביטוח דירות מקצועי. ענה בעברית תקינה, בקצרה ובלי מידע מיותר.";
  try {
    const { data } = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4",         // or gpt-3.5-turbo if quotas require
        temperature: 0.7,
        max_tokens: 250,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: text }
        ]
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("GPT fallback error:", e?.response?.data || e.message);
    return null;
  }
} 