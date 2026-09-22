// Cloudflare Pages Function：/api/generate
// 多候选择优生成立刻返回；视觉评审（Kimi/Gemini）用 waitUntil 后台跑，
// 结果按 reviewId 存入 D1 的 reviews 表，前端轮询 /api/review?id=xxx 取回。
import { generateBestDraft, reviewWithVision } from '../../server/generate.mjs'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS reviews (key TEXT PRIMARY KEY, ts INTEGER, payload TEXT)').run()
}

async function saveReview(env, reviewId, payload) {
  if (!env.DB) return
  await ensureTable(env)
  await env.DB.prepare('INSERT OR REPLACE INTO reviews (key, ts, payload) VALUES (?, ?, ?)')
    .bind(reviewId, Date.now(), JSON.stringify(payload))
    .run()
}

/** 后台评审：画骨架 → 视觉模型看图 → 按 reviewId 入库 */
async function runAsyncReview(env, draft, description, reviewId) {
  const visionOpts = {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
    kimiApiKey: env.KIMI_API_KEY,
    kimiModel: env.KIMI_MODEL || 'kimi-k2.7-code-highspeed',
    kimiBaseUrl: env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
  }
  const base = { reviewId, ts: Date.now(), description, name: draft.name }
  if (!visionOpts.kimiApiKey && !visionOpts.geminiApiKey) {
    await saveReview(env, reviewId, { ...base, status: 'disabled', reason: '未配置视觉模型 Key' })
    return
  }
  try {
    const { provider, draft: corrected, verdict, error } = await reviewWithVision(draft, visionOpts)
    await saveReview(env, reviewId, {
      ...base,
      status: verdict ? 'done' : 'error',
      provider,
      correct: verdict?.correct ?? null,
      reason: verdict?.reason ?? null,
      error: error ?? null,
      original: { basePose: draft.basePose, moves: draft.moves },
      corrected: { basePose: corrected.basePose, moves: corrected.moves },
    })
    console.log('[async-review]', reviewId, provider, verdict ? (verdict.correct ? '正确' : '需修正') : `跳过: ${error}`)
  } catch (e) {
    console.error('[async-review] 失败：', e?.message || e)
    await saveReview(env, reviewId, { ...base, status: 'error', error: e?.message || String(e) })
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
    const draft = await generateBestDraft(desc, {
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      candidates: 3,
    })
    const reviewId = crypto.randomUUID()
    const task = runAsyncReview(env, draft, desc, reviewId)
    if (typeof waitUntil === 'function') waitUntil(task)
    else void task
    return new Response(JSON.stringify({ ...draft, reviewId }), { status: 200, headers: CORS })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: CORS },
    )
  }
}
