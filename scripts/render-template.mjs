// 把动作模板的各关键帧渲染成骨架 PNG，用于人工/视觉模型确认姿势语义。
// 运行：node scripts/render-template.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const outDir = 'D:/lindoway/.tmp-pose'
mkdirSync(outDir, { recursive: true })

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { MOTION_TEMPLATES } = await server.ssrLoadModule('/src/core/motion/templates.ts')
const { sampleAngles } = await server.ssrLoadModule('/src/core/motion/engine.ts')
const { renderSkeletonPng } = await import('../server/skeleton.mjs')

const only = process.argv[2]
for (const t of MOTION_TEMPLATES) {
  if (only && t.id !== only) continue
  for (const tt of [0, 0.25, 0.5, 0.75]) {
    const a = sampleAngles(t, tt)
    const moves = Object.entries(a).map(([joint, to]) => ({ joint, to }))
    const png = await renderSkeletonPng({ ...a }, moves, t.basePosture, t.sensorPosition)
    const name = `${t.id}__t${String(tt).replace('.', '_')}.png`
    writeFileSync(`${outDir}/${name}`, png)
    console.log('wrote', name, png.length, 'bytes')
  }
}

await server.close()
