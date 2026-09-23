// Cloudflare Pages Function：/api/review
// GET    /api/review?id=xxx  → 取某次生成的后台视觉评审结果（未完成时返回 { status: "pending" }）
// GET    /api/review         → 列出最近的评审记录（每条带 _id）
// DELETE /api/review?id=xxx  → 删除一条；?all=1 清空全部

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
}

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS reviews (key TEXT PRIMARY KEY, ts INTEGER, payload TEXT)').run()
}

function err(e) {
  return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
    status: 500,
    headers: CORS,
  })
}

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS })
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 未绑定（变量名应为 DB）' }), { status: 500, headers: CORS })
  }
  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  if (request.method === 'DELETE') {
    try {
      await ensureTable(env)
      if (url.searchParams.get('all') === '1') {
        await env.DB.prepare('DELETE FROM reviews').run()
        return new Response(JSON.stringify({ ok: true, deleted: 'all' }), { status: 200, headers: CORS })
      }
      if (!id) throw new Error('缺少要删除的 id')
      await env.DB.prepare('DELETE FROM reviews WHERE key = ?').bind(id).run()
      return new Response(JSON.stringify({ ok: true, deleted: id }), { status: 200, headers: CORS })
    } catch (e) {
      return err(e)
    }
  }

  try {
    await ensureTable(env)
    if (id) {
      const row = await env.DB.prepare('SELECT payload FROM reviews WHERE key = ?').bind(id).first()
      if (!row) return new Response(JSON.stringify({ status: 'pending' }), { status: 200, headers: CORS })
      return new Response(row.payload, { status: 200, headers: CORS })
    }
    const { results } = await env.DB.prepare('SELECT key, payload FROM reviews ORDER BY ts DESC LIMIT 100').all()
    return new Response(JSON.stringify(results.map((r) => ({ ...JSON.parse(r.payload), _id: r.key }))), {
      status: 200,
      headers: CORS,
    })
  } catch (e) {
    return err(e)
  }
}
