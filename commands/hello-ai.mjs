const API_KEY = 'sk-7bhlww4oak63t7ha8fyt157rbo2jxwtp';
const API_URL = 'https://api.b.ai/v1/chat/completions';

const response = await fetch(API_URL, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-5-nano',
    messages: [{ role: 'user', content: '你好' }],
    stream: false,
    temperature: 0.7,
    max_tokens: 1000,
  }),
});

const data = await response.json();
console.log('AI 回复:', data.choices?.[0]?.message?.content ?? JSON.stringify(data));
