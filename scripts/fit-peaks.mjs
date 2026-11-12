// 评估「峰值突出度」计数：逐条对比 + 参数网格 + 训练/验证划分。
// 运行：node scripts/fit-peaks.mjs <json...>
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const files = process.argv.slice(2)
const raw = []
for (const p of files) {
  const d = JSON.parse(readFileSync(p, 'utf8'))
  for (const s of d.samples ?? []) raw.push(s)
}

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { countActivityPeaks } = await server.ssrLoadModule('/src/core/analysis/peakCounter.ts')

const data = raw.map((s) => ({
  s,
  frames: s.frames.map((f) => ({ t: f.t, ax: f.ax, ay: f.ay, az: f.az, gx: f.gx, gy: f.gy, gz: f.gz })),
}))

console.log(`样本 ${data.length} 条\n`)

const BASE = {}
console.log('=== 逐条（当前默认参数）===')
console.log('#  工况        真值  峰值数  差   时长')
let ok = 0
let absErr = 0
data.forEach((d, i) => {
  const n = countActivityPeaks(d.frames, BASE)
  const diff = n - d.s.trueReps
  if (diff === 0) ok++
  absErr += Math.abs(diff)
  console.log(
    `${String(i + 1).padStart(2)}  ${(d.s.condition ?? '').padEnd(10)} ${String(d.s.trueReps).padStart(4)}  ` +
      `${String(n).padStart(6)}  ${String(diff).padStart(4)}   ${(d.s.durationMs / 1000).toFixed(1)}s`,
  )
})
console.log(`\n完全正确 ${ok}/${data.length} = ${((ok / data.length) * 100).toFixed(1)}%   平均绝对误差 ${(absErr / data.length).toFixed(2)}`)

// ---- 网格 ----
const GRID = []
for (const signal of ['accel', 'omega'])
  for (const smoothTauMs of [60, 120, 200, 350])
    for (const prominenceRatio of [0.35, 0.5, 0.65])
      for (const minPeakRatio of [0.15, 0.25, 0.4])
        for (const minPeakGapMs of [300, 600, 1000, 1500])
          for (const adaptiveGap of [true, false])
          GRID.push({ signal, smoothTauMs, prominenceRatio, minPeakRatio, minPeakGapMs, adaptiveGap })

const table = GRID.map((g) => data.map((d) => countActivityPeaks(d.frames, g)))

// ---- 全量最优 ----
let bestAll = 0
let bestScore = -1
GRID.forEach((g, gi) => {
  let c = 0
  for (let i = 0; i < data.length; i++) if (table[gi][i] === data[i].s.trueReps) c++
  if (c > bestScore) {
    bestScore = c
    bestAll = gi
  }
})
console.log(`\n=== 全量最优（有过拟合风险，仅参考）===`)
console.log(`${JSON.stringify(GRID[bestAll])} → ${bestScore}/${data.length} = ${((bestScore / data.length) * 100).toFixed(1)}%`)
{
  const g = GRID[bestAll]
  let ae = 0
  data.forEach((d, i) => {
    ae += Math.abs(table[bestAll][i] - d.s.trueReps)
  })
  console.log(`平均绝对误差 ${(ae / data.length).toFixed(2)}`)
  console.log('逐条：')
  data.forEach((d, i) => {
    const n = table[bestAll][i]
    const mark = n === d.s.trueReps ? '✓' : ' '
    console.log(`  ${String(i + 1).padStart(2)} ${mark} 真值 ${String(d.s.trueReps).padStart(3)}  数出 ${String(n).padStart(3)}  差 ${String(n - d.s.trueReps).padStart(3)}`)
  })
  void g
}

// ---- 训练/验证划分 ----
let seed = 777
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const ROUNDS = 20
let trSum = 0
let vaSum = 0
const freq = new Map()
for (let r = 0; r < ROUNDS; r++) {
  const idx = data.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  const cut = Math.max(1, Math.round(idx.length * 0.7))
  const train = idx.slice(0, cut)
  const val = idx.slice(cut)
  let best = 0
  let bestScore2 = -1
  GRID.forEach((g, gi) => {
    let c = 0
    for (const i of train) if (table[gi][i] === data[i].s.trueReps) c++
    if (c > bestScore2) {
      bestScore2 = c
      best = gi
    }
  })
  let vOk = 0
  for (const i of val) if (table[best][i] === data[i].s.trueReps) vOk++
  trSum += bestScore2 / train.length
  vaSum += vOk / val.length
  const k = JSON.stringify(GRID[best])
  freq.set(k, (freq.get(k) ?? 0) + 1)
}
console.log(`\n=== 训练/验证划分（70/30，20 轮）===`)
console.log(`训练集平均一致率 ${((trSum / ROUNDS) * 100).toFixed(1)}%`)
console.log(`验证集平均一致率 ${((vaSum / ROUNDS) * 100).toFixed(1)}%`)
console.log('被选中参数：')
for (const [k, n] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`  ${n} 次  ${k}`)

await server.close()
