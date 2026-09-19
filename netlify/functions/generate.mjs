import { generateActionDraft } from '../../server/generate.mjs'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { description } = JSON.parse(event.body || '{}')
    if (!description?.trim()) throw new Error('缺少动作描述')

    const result = await generateActionDraft(String(description).trim(), {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      kimiApiKey: process.env.KIMI_API_KEY,
      kimiModel: process.env.KIMI_MODEL || 'kimi-k2.6',
      kimiBaseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    })
    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    }
  }
}
