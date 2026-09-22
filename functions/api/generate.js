// Cloudflare Pages Function：/api/generate
// 生成立刻返回；视觉评审（Kimi/Gemini）用 waitUntil 在后台跑，结果存入 D1（kind: vision_review）。
import { generateDraft, reviewWithVision } from '../../server/generate.mjs'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function ensureTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT)',
  ).run()
}

/** 后台评审：画骨架 → 视觉模型看图 → 结果入库 */
async function runAsyncReview(env, draft, description) {
  const visionOpts = {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
    kimiApiKey: env.KIMI_API_KEY,
    kimiModel: env.KIMI_MODEL || 'kimi-k2.7-code-highspeed',
    kimiBaseUrl: env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
  }
  if (!visionOpts.kimiApiKey && !visionOpts.geminiApiKey) return
  try {
    const { provider, draft: corrected, verdict, error } = await reviewWithVision(draft, visionOpts)
    console.log('[async-review]', provider, verdict ? (verdict.correct ? 'correct' : 'needs-fix') : `skipped: ${error}`)
    if (!env.DB) return
    await ensureTable(env)
    await env.DB.prepare('INSERT INTO samples (ts, payload) VALUES (?, ?)')
      .bind(
        Date.now(),
        JSON.stringify({
          kind: 'vision_review',
          description,
          name: draft.name,
          provider,
          correct: verdict?.correct ?? null,
          reason: verdict?.reason ?? null,
          error: error ?? null,
          original: { basePose: draft.basePose, moves: draft.moves },
          corrected: { basePose: corrected.basePose, moves: corrected.moves },
        }),
      )
      .run()
  } catch (e) {
    console.error('[async-review] 失败：', e?.message || e)
  }
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS })
  }
  try {
    const { description } = await request.json()
    if (!description?.trim()) throw new Error('缺少动作描述')
    const desc = String(description).trim()
    const draft = await generateDraft(desc, {
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    })
    // 立刻返回生成结果；视觉评审丢到后台，不阻塞响应
    const task = runAsyncReview(env, draft, desc)
    if (typeof waitUntil === 'function') waitUntil(task)
    else void task
    return new Response(JSON.stringify(draft), { status: 200, headers: CORS })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: CORS },
    )
  }
}
