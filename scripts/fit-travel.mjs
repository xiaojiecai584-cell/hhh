// 位移周期检测：对**竖直位移**做峰值检测，数"上-下"循环。
//
// 为什么用位移而不是角速度/加速度：
//   实测分离度  |ω| 2.4x、动态加速度 3.0x、**竖直位移 14.8x**
//   位移的难点只在积分漂移，这里用两级"减去滑动均值"（高通）压制。
//
// 运行：node scripts/fit-travel.mjs <json>
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { auditFrames } = await server.ssrLoadModule('/src/core/analysis/sampleAudit.ts')

const all = (d.samples ?? []).map((s) => ({
  s,
  frames: s.frames.map((f) => ({ t: f.t, ax: f.ax, ay: f.ay, az: f.az, gx: f.gx, gy: f.gy, gz: f.gz })),
}))
const data = all.filter((x) => auditFrames(x.frames).ok)
console.log(`样本 ${all.length} → 通过审计 ${data.length}\n`)

/** 竖直位移曲线（米），抗漂移 */
function travelSeries(frames) {
  const n = frames.length
  const dt =
    n > 1 ? (frames[n - 1].t - frames[0].t) / 1000 / (n - 1) : 0.02
  // 竖直动态加速度
  const aV = new Array(n)
  let g = null
  for (let i = 0; i < n; i++) {
    const a = { x: frames[i].ax, y: frames[i].ay, z: frames[i].az }
    if (!g) g = { ...a }
    else {
      const dti = i > 0 ? Math.max(1e-3, (frames[i].t - frames[i - 1].t) / 1000) : 0.02
      const k = 1 - Math.exp(-dti / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    aV[i] = ((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1) * 9.80665
  }
  // 一次积分 → 速度，去 1 秒滑动均值
  const v = new Array(n).fill(0)
  for (let i = 1; i < n; i++) v[i] = v[i - 1] + ((aV[i] + aV[i - 1]) / 2) * dt
  const hp = (arr, winSec) => {
    const win = Math.max(2, Math.round(winSec / Math.max(dt, 1e-3)))
    return arr.map((_, i) => {
      let s = 0
      let c = 0
      for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) {
        s += arr[k]
        c++
      }
      return arr[i] - s / c
    })
  }
  const vHP = hp(v, 1.0)
  // 二次积分 → 位移，去 2 秒滑动均值
  const x = new Array(n).fill(0)
  for (let i = 1; i < n; i++) x[i] = x[i - 1] + ((vHP[i] + vHP[i - 1]) / 2) * dt
  const xHP = hp(x, 2.0)
  // 再轻度平滑（抑制高频抖动）
  const sm = new Array(n)
  sm[0] = xHP[0]
  for (let i = 1; i < n; i++) {
    const k = 1 - Math.exp(-dt / 0.12)
    sm[i] = sm[i - 1] + (xHP[i] - sm[i - 1]) * k
  }
  return sm
}

/** 对位移做峰值检测，返回峰值列表（时刻与突出度） */
function findCycles(x, frames, prominenceRatio, minPeakGapMs) {
  const n = x.length
  const sorted = [...x].sort((a, b) => a - b)
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))] || 0
  const p10 = sorted[Math.floor(n * 0.1)] || 0
  const span = p90 - p10
  if (span <= 0) return []
  const cand = []
  for (let i = 1; i < n - 1; i++) {
    if (!(x[i] > x[i - 1] && x[i] >= x[i + 1])) continue
    const v = x[i]
    let l = v
    for (let k = i - 1; k >= 0; k--) {
      if (x[k] > v) break
      l = Math.min(l, x[k])
    }
    let r = v
    for (let k = i + 1; k < n; k++) {
      if (x[k] > v) break
      r = Math.min(r, x[k])
    }
    const base = Math.max(l, r)
    const prom = span > 0 ? (v - base) / span : 0
    if (prom >= prominenceRatio) cand.push({ i, t: frames[i].t, prom })
  }
  const kept = []
  for (const c of cand) {
    const prev = kept[kept.length - 1]
    if (prev && c.t - prev.t < minPeakGapMs) {
      if (c.prom > prev.prom) kept[kept.length - 1] = c
    } else kept.push(c)
  }
  return kept
}

const series = data.map((x) => ({ s: x.s, frames: x.frames, x: travelSeries(x.frames) }))

const results = []
for (const prominenceRatio of [0.2, 0.3, 0.4, 0.5, 0.6])
  for (const minPeakGapMs of [300, 600, 1000, 1500, 2000]) {
    let ok = 0
    let absErr = 0
    const rows = []
    for (const q of series) {
      const cyc = findCycles(q.x, q.frames, prominenceRatio, minPeakGapMs)
      const n = cyc.length
      const diff = n - q.s.trueReps
      if (diff === 0) ok++
      absErr += Math.abs(diff)
      rows.push({ truth: q.s.trueReps, n, diff })
    }
    results.push({ prominenceRatio, minPeakGapMs, ok, absErr, rows })
  }

const rank = [...results].sort((a, b) => a.absErr - b.absErr || b.ok - a.ok)
console.log('=== 位移周期检测 最佳 8 组 ===')
for (const r of rank.slice(0, 8)) {
  console.log(
    `  prom>=${r.prominenceRatio} gap>=${r.minPeakGapMs}ms  correct ${r.ok}/${data.length}  MAE ${(r.absErr / data.length).toFixed(2)}`,
  )
}
const best = rank[0]
console.log('\n最佳配置逐条：')
series.forEach((q, i) => {
  const cyc = findCycles(q.x, q.frames, best.prominenceRatio, best.minPeakGapMs)
  const diff = cyc.length - q.s.trueReps
  console.log(
    `  ${String(i + 1).padStart(2)} ${diff === 0 ? '✓' : ' '} 真值 ${String(q.s.trueReps).padStart(3)}  数出 ${String(cyc.length).padStart(3)}  差 ${String(diff).padStart(3)}  ${q.s.condition}`,
  )
})
await server.close()
