// 单条录音的波形诊断：细粒度打印包络，并列出峰值与突出度。
// 用来回答"为什么 576 组参数都救不了 #15/#16/#17"。
// 运行：node scripts/diag-sample.mjs <index> <json...>
import { readFileSync } from 'node:fs'

const idx = Number(process.argv[2])
const files = process.argv.slice(3)
const all = []
for (const p of files) {
  const d = JSON.parse(readFileSync(p, 'utf8'))
  for (const s of d.samples ?? []) all.push(s)
}
const s = all[idx]
if (!s) {
  console.error('样本不存在')
  process.exit(1)
}
const fr = s.frames
const MAIN_AXIS = { 1: 'gy', 2: 'gx' }

// 竖直动态加速度 |a·ĝ − 1|
function accelSeries(frames) {
  let g = null
  const out = []
  for (let i = 0; i < frames.length; i++) {
    const a = { x: frames[i].ax, y: frames[i].ay, z: frames[i].az }
    if (!g) g = { ...a }
    else {
      const dt = Math.max(1e-3, (frames[i].t - frames[i - 1].t) / 1000)
      const k = 1 - Math.exp(-dt / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    out.push(Math.abs((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1))
  }
  return out
}

const env = (raw, tau) => {
  const o = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const dt = Math.max(1e-3, (fr[i].t - fr[i - 1].t) / 1000)
    const k = 1 - Math.exp((-dt * 1000) / tau)
    o.push(o[i - 1] + (raw[i] - o[i - 1]) * k)
  }
  return o
}

const om = fr.map((f) => Math.hypot(f.gx, f.gy, f.gz))
const av = accelSeries(fr)
const q = (a, p) => {
  const b = [...a].sort((x, y) => x - y)
  return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]
}

console.log(`样本 #${idx + 1}  ${s.condition}  真值 ${s.trueReps} 次  时长 ${(s.durationMs / 1000).toFixed(1)}s  帧 ${fr.length}`)
console.log(`平均间隔 ${(s.durationMs / s.trueReps / 1000).toFixed(2)}s/次`)
console.log(`\n|ω|      p10 ${q(om, 0.1).toFixed(1)}  p50 ${q(om, 0.5).toFixed(1)}  p90 ${q(om, 0.9).toFixed(1)}  max ${Math.max(...om).toFixed(1)} °/s`)
console.log(`|a_vert| p10 ${q(av, 0.1).toFixed(3)}  p50 ${q(av, 0.5).toFixed(3)}  p90 ${q(av, 0.9).toFixed(3)}  max ${Math.max(...av).toFixed(3)} g`)

// 每 0.5 秒一个采样点，便于看节奏
console.log('\n=== 时间轴（每 0.2s 取样，|a_vert| 与 |ω|）===')
const step = 200
let nextT = fr[0].t
const rows = []
for (let i = 0; i < fr.length; i++) {
  if (fr[i].t >= nextT) {
    rows.push(`${((fr[i].t - fr[0].t) / 1000).toFixed(1)}s  a=${av[i].toFixed(3)}  w=${om[i].toFixed(0)}`)
    nextT += step
  }
}
// 折成每行 4 个，省版面
for (let i = 0; i < rows.length; i += 4) console.log('  ' + rows.slice(i, i + 4).join('   '))

// 突出度峰值（与 peakCounter 同算法，tau=350）
const e = env(av, 350)
const n = e.length
const p90 = q(e, 0.9)
const maxima = []
for (let i = 1; i < n - 1; i++) if (e[i] > e[i - 1] && e[i] >= e[i + 1]) maxima.push(i)
console.log(`\n=== 局部极大值 ${maxima.length} 个（tau=350, accel）===`)
console.log('时刻    峰值   两侧谷   突出度')
for (const mi of maxima) {
  const v = e[mi]
  let l = v
  for (let i = mi - 1; i >= 0; i--) { if (e[i] > v) break; l = Math.min(l, e[i]) }
  let r = v
  for (let i = mi + 1; i < n; i++) { if (e[i] > v) break; r = Math.min(r, e[i]) }
  const base = Math.max(l, r)
  const prom = v > 0 ? (v - base) / v : 0
  console.log(`  ${((fr[mi].t - fr[0].t) / 1000).toFixed(1).padStart(6)}s  ${v.toFixed(3)}  ${base.toFixed(3)}  ${prom.toFixed(3)}`)
}
console.log(`\np90(env) = ${p90.toFixed(3)}，minPeakRatio 0.15 → 门槛 ${(0.15 * p90).toFixed(3)}`)
void MAIN_AXIS
