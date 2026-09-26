// 用线上采集的真实数据回放计数算法：对比现有 segmentMotion 与候选状态机的输出。
// 运行：node scripts/analyze-count.mjs [记录索引]
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { segmentMotion } = await server.ssrLoadModule('/src/core/analysis/segmentation.ts')

const gyroZero = (ss) => ss.every((s) => s.gx === 0 && s.gy === 0 && s.gz === 0)
const rate = (ss) => ((ss.length - 1) / ((ss.at(-1).t - ss[0].t) / 1000)).toFixed(1)

console.log('=== 全部记录概览（samples>=150）===')
const cont = rows.map((r, i) => ({ i, r, ss: r.samples ?? [] })).filter((x) => x.ss.length >= 150)
console.log(`共 ${cont.length} 条\n`)
console.log('idx  samples  dur(s)  Hz    陀螺零?  主轴   |ω|中位  |ω|最大  accel模长范围     segMotion')
for (const { i, r, ss } of cont) {
  const axes = ['gx', 'gy', 'gz']
  let axis = '?'
  let best = -1
  for (const a of axes) {
    const m = ss.reduce((s, p) => s + p[a], 0) / ss.length
    const v = ss.reduce((s, p) => s + (p[a] - m) ** 2, 0)
    if (v > best) {
      best = v
      axis = a
    }
  }
  const om = ss.map((s) => Math.hypot(s.gx, s.gy, s.gz)).sort((a, b) => a - b)
  const am = ss.map((s) => Math.hypot(s.ax, s.ay, s.az))
  const segs = segmentMotion(ss)
  console.log(
    `${String(i).padStart(3)}  ${String(ss.length).padStart(7)}  ${((ss.at(-1).t - ss[0].t) / 1000).toFixed(1).padStart(6)}  ${rate(ss).padStart(5)}  ` +
      `${(gyroZero(ss) ? '是!!' : '否').padStart(6)}  ${axis}  ${om[Math.floor(om.length / 2)].toFixed(1).padStart(7)}  ${om.at(-1).toFixed(1).padStart(7)}  ` +
      `${Math.min(...am).toFixed(2)}~${Math.max(...am).toFixed(2)}  → ${segs.length}`,
  )
}

// ASCII 曲线：某条记录的 |ω| 与积分角
const idx = Number(process.argv[2] ?? 2)
const ss = rows[idx].samples
console.log(`\n=== #${idx} ${rows[idx].actionName} n=${ss.length} ===`)
const W = 100
const step = Math.max(1, Math.floor(ss.length / W))
const plot = (vals, label) => {
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const ROWS = 12
  const grid = Array.from({ length: ROWS }, () => new Array(Math.ceil(vals.length / step)).fill(' '))
  vals.forEach((v, k) => {
    if (k % step) return
    const col = Math.floor(k / step)
    const row = Math.min(ROWS - 1, Math.max(0, Math.round(((v - min) / (max - min || 1)) * (ROWS - 1))))
    grid[ROWS - 1 - row][col] = '*'
  })
  console.log(`\n${label}  [${min.toFixed(1)} .. ${max.toFixed(1)}]`)
  grid.forEach((r) => console.log('  |' + r.join('')))
  console.log('  +' + '-'.repeat(grid[0].length) + `   (每格 ${step} 点 ≈ ${(step * 20).toFixed(0)}ms)`)
}
plot(
  ss.map((s) => Math.hypot(s.gx, s.gy, s.gz)),
  '|ω| (°/s)',
)
const axis = ['gx', 'gy', 'gz'].reduce((best, a) => {
  const m = ss.reduce((s, p) => s + p[a], 0) / ss.length
  const v = ss.reduce((s, p) => s + (p[a] - m) ** 2, 0)
  return v > best.v ? { a, v } : best
}, { a: 'gx', v: -1 }).a
const ang = [0]
for (let k = 0; k < ss.length; k++) ang.push(ang[k] + (ss[k][axis] - ss.reduce((s, p) => s + p[axis], 0) / ss.length) * 0.02)
plot(ang.slice(1), `积分角 ${axis} (°，未去漂移)`)

await server.close()
