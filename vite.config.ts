import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat'
  const geminiApiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY
  const geminiModel = env.GEMINI_MODEL || 'gemini-3.8-flash'

  return {
    plugins: [react(), localGenerateApi(apiKey, model, geminiApiKey, geminiModel)],
    base: './',
    server: {
      host: true,
      port: 5173,
    },
  }
})

/** 本地开发：把 /api/generate 转发到 server/generate.mjs（生产用 Netlify Function） */
function localGenerateApi(
  apiKey: string | undefined,
  model: string | undefined,
  geminiApiKey: string | undefined,
  geminiModel: string | undefined,
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
            const { generateActionDraft } = await import('./server/generate.mjs')
            const result = await generateActionDraft(String(description).trim(), {
              apiKey,
              model: model || 'deepseek-chat',
              geminiApiKey,
              geminiModel: geminiModel || 'gemini-3.8-flash',
            })
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
    },
  }
}
