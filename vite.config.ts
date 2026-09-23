import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat'
  const geminiApiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY
  const geminiModel = env.GEMINI_MODEL || 'gemini-3.8-flash'
  const kimiApiKey = env.KIMI_API_KEY || process.env.KIMI_API_KEY
  const kimiModel = env.KIMI_MODEL || 'kimi-k2.7-code-highspeed'
  const kimiBaseUrl = env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1'

  return {
    plugins: [react(), localGenerateApi(apiKey, model, geminiApiKey, geminiModel, kimiApiKey, kimiModel, kimiBaseUrl)],
    base: './',
    server: {
      host: true,
      port: 5173,
    },
  }
})

/** 本地开发的视觉评审结果暂存（生产用 D1 的 reviews 表） */
const localReviews = new Map<string, unknown>()
/** 本地开发的采集样本暂存（生产用 D1 的 samples 表） */
const localSamples: Record<string, unknown>[] = []
let localSampleSeq = 1

/** 本地开发：把 /api/generate 转发到 server/generate.mjs（生产用 Cloudflare Function） */
function localGenerateApi(
  apiKey: string | undefined,
  model: string | undefined,
  geminiApiKey: string | undefined,
  geminiModel: string | undefined,
  kimiApiKey: string | undefined,
  kimiModel: string | undefined,
  kimiBaseUrl: string | undefined,
): Plugin {
  return {
    name: 'local-generate-api',
    configureServer(server) {
      server.middlewares.use('/api/generate', (req: any, res: any) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        let body = ''
        req.on('data', (c: Buffer) => (body += c))
        req.on('end', async () => {
          try {
            if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY（请在 .env 中配置）')
            const { description } = JSON.parse(body || '{}')
            if (!description?.trim()) throw new Error('缺少动作描述')
            const { generateBestDraft, reviewWithVision } = await import('./server/generate.mjs')
            const desc = String(description).trim()
            const draft = await generateBestDraft(desc, { apiKey, model: model || 'deepseek-chat', candidates: 3 })
            const reviewId = `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ...draft, reviewId }))
            // 视觉评审后台异步跑（本地存内存，前端轮询 /api/review 取回）
            void reviewWithVision(draft, {
              geminiApiKey,
              geminiModel: geminiModel || 'gemini-3.8-flash',
              kimiApiKey,
              kimiModel: kimiModel || 'kimi-k2.7-code-highspeed',
              kimiBaseUrl: kimiBaseUrl || 'https://api.moonshot.cn/v1',
            }).then((r) => {
              localReviews.set(reviewId, {
                _id: reviewId,
                reviewId,
                status: r.verdict ? 'done' : 'error',
                provider: r.provider,
                correct: r.verdict?.correct ?? null,
                reason: r.verdict?.reason ?? null,
                error: r.error ?? null,
                original: { basePose: draft.basePose, moves: draft.moves },
                corrected: { basePose: r.draft.basePose, moves: r.draft.moves },
              })
              console.log(
                '[async-review]',
                reviewId,
                r.provider ?? 'none',
                r.verdict ? (r.verdict.correct ? '正确' : '需修正') : `跳过: ${r.error ?? ''}`,
              )
            })
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })

      // /api/review：本地内存版（生产走 D1 的 reviews 表）
      server.middlewares.use('/api/review', (req: any, res: any) => {
        const sp = new URL(req.url ?? '', 'http://localhost').searchParams
        const id = sp.get('id')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'DELETE') {
          if (sp.get('all') === '1') {
            localReviews.clear()
            res.end(JSON.stringify({ ok: true, deleted: 'all' }))
          } else {
            if (id) localReviews.delete(id)
            res.end(JSON.stringify({ ok: true, deleted: id }))
          }
          return
        }
        res.end(JSON.stringify(id ? (localReviews.get(id) ?? { status: 'pending' }) : [...localReviews.values()]))
      })

      // /api/collect：本地内存版（生产走 D1 的 samples 表）
      server.middlewares.use('/api/collect', (req: any, res: any) => {
        const sp = new URL(req.url ?? '', 'http://localhost').searchParams
        const send = (code: number, data: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }
        if (req.method === 'DELETE') {
          if (sp.get('all') === '1') {
            localSamples.length = 0
            return send(200, { ok: true, deleted: 'all' })
          }
          const id = Number(sp.get('id'))
          const i = localSamples.findIndex((s) => s._id === id)
          if (i >= 0) localSamples.splice(i, 1)
          return send(200, { ok: true, deleted: id })
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c: Buffer) => (body += c))
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}')
              localSamples.push({ ...payload, _id: localSampleSeq++ })
              send(200, { ok: true })
            } catch (e) {
              send(500, { error: e instanceof Error ? e.message : String(e) })
            }
          })
          return
        }
        send(200, localSamples)
      })
    },
  }
}
