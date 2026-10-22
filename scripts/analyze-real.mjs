// 用真实录音反解参数：12 次标准坐姿推举 = **24 个停顿**（顶端 12 + 底端 12）。
// 哪个门槛能数出 24 个停顿，哪个就是可用的。
//
// 运行：node scripts/analyze-real.mjs "<json 路径>"
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('用法: node scripts/analyze-real.mjs <lindoway-raw-*.json>')
  process.exit(1)
}
const d = JSON.parse(readFileSync(path, 'utf8'))
const fr = d.frames
const G = 9.80665

// ---- 基本统计 ----
const ts = fr.map((f) => f.t)
const dur = (ts[ts.length - 1] - ts[0]) / 1000
const dts = ts.slice(1).map((t, i) => t - ts[i])
const medDt = [...dts].sort((a, b) => a - b)[Math.floor(dts.length / 2)]
const om = fr.map((f) => Math.hypot(f.gx, f.gy, f.gz))

// 重力方向低通 + 竖直加速度（与计数器同一套算法）
const aVert = []
let g = null
for (let i = 0; i < fr.length; i++) {
  const a = { x: fr[i].ax, y: fr[i].ay, z: fr[i].az }
  if (!g) g = { ...a }
  else {
    const dt = Math.max(1e-3, (ts[i] - ts[i - 1]) / 1000)
    const k = 1 - Math.exp(-dt / 1.0)
    g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
  }
  const gm = Math.hypot(g.x, g.y, g.z) || 1
  aVert.push((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1)
}
const avAbs = aVert.map(Math.abs)

const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]
}

console.log('=== 文件概览 ===')
console.log(`  次数(标注) ${d.trueReps}   工况 ${d.condition}   动作 ${d.actionName}`)
console.log(`  帧数 ${fr.length}   时长 ${dur.toFixed(1)}s   中位间隔 ${medDt.toFixed(1)}ms   采样率 ${(1000 / medDt).toFixed(1)}Hz`)
console.log(`  加速度范围 ax[${q(fr.map((f) => f.ax), 0.05).toFixed(3)}, ${q(fr.map((f) => f.ax), 0.95).toFixed(3)}]  az[${q(fr.map((f) => f.az), 0.05).toFixed(3)}, ${q(fr.map((f) => f.az), 0.95).toFixed(3)}]`)

console.log('\n=== 信号分布 ===')
const row = (name, a, unit) =>
  console.log(
    `  ${name.padEnd(14)} p50 ${q(a, 0.5).toFixed(2).padStart(7)}  p70 ${q(a, 0.7).toFixed(2).padStart(7)}  ` +
      `p90 ${q(a, 0.9).toFixed(2).padStart(7)}  p95 ${q(a, 0.95).toFixed(2).padStart(7)}  max ${Math.max(...a).toFixed(2).padStart(7)} ${unit}`,
  )
row('|ω|', om, '°/s')
row('|a_vert|', avAbs, 'g')

// ---- 只用角速度做"静音"判定，看能得到多少个停顿 ----
// 与计数器同构：滑动窗口 pauseMinMs、安静比例 pauseQuietFrac、上升沿计数
function countPauses(omegaTh, accelTh, pauseMinMs, quietFrac) {
  const win = Math.max(4, Math.round(pauseMinMs / medDt))
  const ring = []
  let quietSum = 0
  let edge = false
  let n = 0
  const times = []
  for (let i = 0; i < fr.length; i++) {
    const quiet = om[i] < omegaTh && avAbs[i] < accelTh
    ring.push(quiet ? 1 : 0)
    quietSum += quiet ? 1 : 0
    if (ring.length > win) quietSum -= ring.shift()
    const frac = ring.length >= win ? quietSum / ring.length : 0
    const confirmed = frac >= quietFrac
    if (!confirmed) edge = false
    else if (!edge) {
      edge = true
      n++
      times.push(ts[i])
    }
  }
  return { n, times }
}

console.log('\n=== 反解：目标 24 个停顿（12 次） ===')
console.log('  ω门槛  a门槛  窗口  安静比 → 停顿数  间隔(中位)')
const results = []
for (const omegaTh of [12, 20, 30, 40, 50, 60, 80]) {
  for (const accelTh of [0.05, 0.1, 0.2, 1]) {
    const { n, times } = countPauses(omegaTh, accelTh, 300, 0.7)
    const gaps = times.slice(1).map((t, i) => t - times[i])
    const medGap = gaps.length ? q(gaps, 0.5) : 0
    results.push({ omegaTh, accelTh, n, medGap })
    console.log(
      `  ${String(omegaTh).padStart(5)}  ${String(accelTh).padStart(5)}   300   0.70 → ${String(n).padStart(4)}    ${medGap.toFixed(0)}ms`,
    )
  }
}

console.log('\n=== 最接近 24 的配置 ===')
const best = [...results].sort((a, b) => Math.abs(a.n - 24) - Math.abs(b.n - 24)).slice(0, 6)
for (const b of best) {
  console.log(`  ω<${b.omegaTh}°/s  |a_vert|<${b.accelTh}g  → 停顿 ${b.n}（差 ${b.n - 24}），间隔中位 ${b.medGap.toFixed(0)}ms`)
}

// ---- 停顿的实际深度：找出所有 |ω| 的局部低谷，看它们有多低 ----
console.log('\n=== 动作强度（滑动 4s 的 p90） ===')
const win4 = Math.round(4000 / medDt)
const levels = []
for (let i = 0; i < om.length; i++) {
  const s = om.slice(Math.max(0, i - win4 + 1), i + 1)
  levels.push(q(s, 0.9))
}
console.log(`  p90 水平: p5 ${q(levels, 0.05).toFixed(0)}  p50 ${q(levels, 0.5).toFixed(0)}  p95 ${q(levels, 0.95).toFixed(0)} °/s`)

// 用相对判据：安静 = |ω| < max(floor, ratio × 动作强度)
console.log('\n=== 相对判据反解（安静 = |ω| < max(floor, ratio×p90强度)） ===')
console.log('  floor  ratio → 停顿数   间隔中位')
for (const floor of [10, 20, 30]) {
  for (const ratio of [0.15, 0.2, 0.3, 0.4, 0.5]) {
    const win = Math.max(4, Math.round(300 / medDt))
    const ring = []
    let quietSum = 0
    let edge = false
    let n = 0
    const times = []
    for (let i = 0; i < fr.length; i++) {
      const th = Math.max(floor, ratio * levels[i])
      const quiet = om[i] < th && avAbs[i] < Math.max(0.05, 0.5 * q(avAbs.slice(Math.max(0, i - win4 + 1), i + 1), 0.9))
      ring.push(quiet ? 1 : 0)
      quietSum += quiet ? 1 : 0
      if (ring.length > win) quietSum -= ring.shift()
      const frac = ring.length >= win ? quietSum / ring.length : 0
      if (frac < 0.7) edge = false
      else if (!edge) {
        edge = true
        n++
        times.push(ts[i])
      }
    }
    const gaps = times.slice(1).map((t, i) => t - times[i])
    const mark = n === 24 ? '  ← 命中' : ''
    console.log(`  ${String(floor).padStart(5)}  ${ratio.toFixed(2)} → ${String(n).padStart(4)}   ${(gaps.length ? q(gaps, 0.5) : 0).toFixed(0)}ms${mark}`)
  }
}
