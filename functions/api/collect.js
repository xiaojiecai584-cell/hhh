// Cloudflare Pages Function：/api/collect
// 收集训练样本（动作描述 → 最终微调后的参数）到 Cloudflare D1，用于后续训练 AI。
// GET  = 导出全部样本（JSON 数组）
// POST = 上报一条样本

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

async function ensureTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT)',
  ).run()
}

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS })
  }

  if (request.method === 'GET') {
    try {
      await ensureTable(env)
      const { results } = await env.DB.prepare('SELECT payload FROM samples ORDER BY ts ASC').all()
      const items = results.map((r) => JSON.parse(r.payload))
      return new Response(JSON.stringify(items), { status: 200, headers: CORS })
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: CORS })
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json()
      await ensureTable(env)
      await env.DB.prepare('INSERT INTO samples (ts, payload) VALUES (?, ?)').bind(Date.now(), JSON.stringify(body)).run()
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: CORS })
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS })
}
