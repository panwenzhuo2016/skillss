//排名	模型	开发商	支持会话	支持 API	排名变化
// 1
// Claude Opus 4.7
// Anthropic			–
// 2
// GPT-5.5
// OpenAI			+1
// 3
// Claude Sonnet 4.6
// Anthropic			-1
// 4
// Claude Haiku 4.5
// Anthropic			+2
// 5
// DeepSeek-V4-Pro
// DeepSeek			-1
// 6
// Gemini 3.1 pro
// Google			+1
// 7
// GPT-5.2
// OpenAI			+9
// 8
// DeepSeek-V4-Flash
// DeepSeek			–
// 9
// Claude Opus 4.5
// Anthropic			-4
// 10
// GPT-5.4
// OpenAI			-1
// 11
// GLM-5.1
// Zhipu AI			+7
// 12
// GLM-5
// Zhipu AI			+2
// 13
// GPT-5.4-nano
// OpenAI			-2
// 14
// Claude Sonnet 4.5
// Anthropic			+1
// 15
// Gemini 3 flash
// Google			-5
// 16
// GPT-5-nano
// OpenAI			-4
// 17
// GPT-5-mini
// OpenAI			-4
// 18
// GPT-5.4-mini
// OpenAI			+2
// 19
// DeepSeek-V3.2
// DeepSeek			-2
// 20
// GPT-5.5-Instant
// OpenAI

[
  {
    "model": "claude-opus-4.7",
    "modelLabel": "Claude Opus 4.7",
    "rank": 1,
    "rankDelta": 0,
    "relativeHeatPercent": 100
  },
  {
    "model": "gpt-5.5",
    "modelLabel": "GPT-5.5",
    "rank": 2,
    "rankDelta": 1,
    "relativeHeatPercent": 37
  },
  {
    "model": "claude-sonnet-4.6",
    "modelLabel": "Claude Sonnet 4.6",
    "rank": 3,
    "rankDelta": -1,
    "relativeHeatPercent": 34
  },
  {
    "model": "claude-haiku-4.5",
    "modelLabel": "Claude Haiku 4.5",
    "rank": 4,
    "rankDelta": 2,
    "relativeHeatPercent": 18
  },
  {
    "model": "deepseek-v4-pro",
    "modelLabel": "DeepSeek-V4-Pro",
    "rank": 5,
    "rankDelta": -1,
    "relativeHeatPercent": 11
  },
  {
    "model": "gemini-3.1-pro",
    "modelLabel": "Gemini 3.1 pro",
    "rank": 6,
    "rankDelta": 1,
    "relativeHeatPercent": 2
  },
  {
    "model": "gpt-5.2",
    "modelLabel": "GPT-5.2",
    "rank": 7,
    "rankDelta": 9,
    "relativeHeatPercent": 2
  },
  {
    "model": "deepseek-v4-flash",
    "modelLabel": "DeepSeek-V4-Flash",
    "rank": 8,
    "rankDelta": 0,
    "relativeHeatPercent": 2
  },
  {
    "model": "claude-opus-4.5",
    "modelLabel": "Claude Opus 4.5",
    "rank": 9,
    "rankDelta": -4,
    "relativeHeatPercent": 2
  },
  {
    "model": "gpt-5.4",
    "modelLabel": "GPT-5.4",
    "rank": 10,
    "rankDelta": -1,
    "relativeHeatPercent": 2
  },
  {
    "model": "glm-5.1",
    "modelLabel": "GLM-5.1",
    "rank": 11,
    "rankDelta": 7,
    "relativeHeatPercent": 2
  },
  {
    "model": "glm-5",
    "modelLabel": "GLM-5",
    "rank": 12,
    "rankDelta": 2,
    "relativeHeatPercent": 1
  },
  {
    "model": "gpt-5.4-nano",
    "modelLabel": "GPT-5.4-nano",
    "rank": 13,
    "rankDelta": -2,
    "relativeHeatPercent": 1
  },
  {
    "model": "claude-sonnet-4.5",
    "modelLabel": "Claude Sonnet 4.5",
    "rank": 14,
    "rankDelta": 1,
    "relativeHeatPercent": 1
  },
  {
    "model": "gemini-3-flash",
    "modelLabel": "Gemini 3 flash",
    "rank": 15,
    "rankDelta": -5,
    "relativeHeatPercent": 1
  },
  {
    "model": "gpt-5-nano",
    "modelLabel": "GPT-5-nano",
    "rank": 16,
    "rankDelta": -4,
    "relativeHeatPercent": 1
  },
  {
    "model": "gpt-5-mini",
    "modelLabel": "GPT-5-mini",
    "rank": 17,
    "rankDelta": -4,
    "relativeHeatPercent": 1
  },
  {
    "model": "gpt-5.4-mini",
    "modelLabel": "GPT-5.4-mini",
    "rank": 18,
    "rankDelta": 2,
    "relativeHeatPercent": 0
  },
  {
    "model": "deepseek-v3.2",
    "modelLabel": "DeepSeek-V3.2",
    "rank": 19,
    "rankDelta": -2,
    "relativeHeatPercent": 0
  },
  {
    "model": "gpt-5.5-instant",
    "modelLabel": "GPT-5.5-Instant",
    "rank": 20,
    "rankDelta": -1,
    "relativeHeatPercent": 0
  }
]

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
