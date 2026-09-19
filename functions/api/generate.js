// Cloudflare Pages Function：/api/generate
// 复用 server/generate.mjs 的同一套逻辑（DeepSeek 生成 + Kimi/Gemini 视觉评审）。
import { generateActionDraft } from '../../server/generate.mjs'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS })
  }
  try {
    const { description } = await request.json()
    if (!description?.trim()) throw new Error('缺少动作描述')
    const result = await generateActionDraft(String(description).trim(), {
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      geminiApiKey: env.GEMINI_API_KEY,
      geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
      kimiApiKey: env.KIMI_API_KEY,
      kimiModel: env.KIMI_MODEL || 'kimi-k2.6',
      kimiBaseUrl: env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    })
    return new Response(JSON.stringify(result), { status: 200, headers: CORS })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: CORS },
    )
  }
}
