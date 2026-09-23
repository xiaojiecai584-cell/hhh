// Cloudflare Pages Function：/api/collect
// GET    = 导出全部样本（每条带 _id，供删除用）
// POST   = 上报一条样本
// DELETE = 删除：?id=123 删单条；?all=1 清空全部

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
}

async function ensureTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT)',
  ).run()
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
  const url = new URL(request.url)

  if (request.method === 'GET') {
    try {
      await ensureTable(env)
      const { results } = await env.DB.prepare('SELECT id, payload FROM samples ORDER BY ts ASC').all()
      const items = results.map((r) => ({ ...JSON.parse(r.payload), _id: r.id }))
      return new Response(JSON.stringify(items), { status: 200, headers: CORS })
    } catch (e) {
      return err(e)
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json()
      await ensureTable(env)
      await env.DB.prepare('INSERT INTO samples (ts, payload) VALUES (?, ?)').bind(Date.now(), JSON.stringify(body)).run()
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
    } catch (e) {
      return err(e)
    }
  }

  if (request.method === 'DELETE') {
    try {
      await ensureTable(env)
      if (url.searchParams.get('all') === '1') {
        await env.DB.prepare('DELETE FROM samples').run()
        return new Response(JSON.stringify({ ok: true, deleted: 'all' }), { status: 200, headers: CORS })
      }
      const id = Number(url.searchParams.get('id'))
      if (!Number.isFinite(id)) throw new Error('缺少要删除的 id')
      await env.DB.prepare('DELETE FROM samples WHERE id = ?').bind(id).run()
      return new Response(JSON.stringify({ ok: true, deleted: id }), { status: 200, headers: CORS })
    } catch (e) {
      return err(e)
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS })
}
