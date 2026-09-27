// 追踪 RepCounter 在 #2（40s 坐姿推举）上的计数标量 d 的波形
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')

for (const idx of [2, 29, 32]) {
  const ss = rows[idx].samples
  const c = new RepCounter()
  const ds = []
  const marks = []
  for (let i = 0; i < ss.length; i++) {
    const e = c.push(ss[i])
    if (e) marks.push({ i, ...e })
    ds.push(c.currentDisplacementDeg)
  }
  console.log(`\n=== #${idx} ${rows[idx].actionName} n=${ss.length} → ${c.repCount} 次，d 范围 [${Math.min(...ds).toFixed(1)} .. ${Math.max(...ds).toFixed(1)}] ===`)

  // 每 0.5s 打印一次 d 的包络
  const step = 25
  const line = []
  for (let b = 0; b < ds.length; b += step) {
    const seg = ds.slice(b, b + step)
    const lo = Math.min(...seg)
    const hi = Math.max(...seg)
    const t = ((ss[b].t - ss[0].t) / 1000).toFixed(1)
    const counted = marks.some((m) => m.i >= b && m.i < b + step)
    line.push(`${t}s[${lo.toFixed(0)}~${hi.toFixed(0)}]${counted ? '✓' : ''}`)
  }
  console.log(line.join(' '))
  console.log('计数点:', marks.map((m) => `${((ss[m.i].t - ss[0].t) / 1000).toFixed(1)}s/${m.rangeDeg.toFixed(0)}°`).join(' '))
}

await server.close()
