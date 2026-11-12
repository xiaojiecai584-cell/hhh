// 按人工标注分组，考察三个判据特征的实际分布，并评估当前阈值。
// 运行：node scripts/feature-labels.mjs <json...>
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
const rows = []
for (const path of files) {
  const d = JSON.parse(readFileSync(path, 'utf8'))
  for (const s of d.samples ?? []) rows.push(s)
}

const MAIN_AXIS = { 1: 'gy', 2: 'gx' }

/** 复刻计数/判别用的三个特征（只用加速度与角速度） */
function features(s) {
  const fr = s.frames
  const ax = MAIN_AXIS[s.actionId] ?? 'gy'
  let peak = 0
  for (const f of fr) peak = Math.max(peak, Math.abs(f[ax]))

  let g = null
  let vE = 0
  let hE = 0
  let twist = 0
  let total = 0
  for (let i = 0; i < fr.length; i++) {
    const a = { x: fr[i].ax, y: fr[i].ay, z: fr[i].az }
    if (!g) g = { ...a }
    else {
      const dt = i > 0 ? Math.max(1e-3, (fr[i].t - fr[i - 1].t) / 1000) : 0.02
      const k = 1 - Math.exp(-dt / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    const ux = g.x / gm
    const uy = g.y / gm
    const uz = g.z / gm
    const along = a.x * ux + a.y * uy + a.z * uz
    const a2 = a.x * a.x + a.y * a.y + a.z * a.z
    vE += (along - 1) * (along - 1)
    hE += Math.max(0, a2 - along * along)
    twist += Math.abs(fr[i].gx * ux + fr[i].gy * uy + fr[i].gz * uz)
    total += Math.hypot(fr[i].gx, fr[i].gy, fr[i].gz)
  }
  return {
    peak,
    verticalRatio: vE + hE > 0 ? vE / (vE + hE) : 1,
    twistRatio: total > 0 ? twist / total : 0,
  }
}

const data = rows.map((s) => ({ s, f: features(s) }))
const q = (arr, p) => {
  if (!arr.length) return NaN
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]
}

console.log(`样本 ${data.length} 条\n`)

console.log('=== 按标注分组的特征分布 ===')
console.log('分组                  n   peak(中位)   verticalRatio(中位)   twistRatio(中位)')
const groups = [
  ['无错误（标准）', (d) => d.s.errorCodes.length === 0],
  ['行程不足', (d) => d.s.errorCodes.includes('INSUFFICIENT_RANGE')],
  ['行程不垂直', (d) => d.s.errorCodes.includes('NOT_VERTICAL')],
  ['手腕外翻', (d) => d.s.errorCodes.includes('WRIST_FLIP')],
]
for (const [name, pred] of groups) {
  const g = data.filter(pred)
  if (!g.length) {
    console.log(`${name.padEnd(20)}  0   —`)
    continue
  }
  const p = g.map((d) => d.f.peak)
  const v = g.map((d) => d.f.verticalRatio)
  const t = g.map((d) => d.f.twistRatio)
  console.log(
    `${name.padEnd(20)} ${String(g.length).padStart(2)}   ${q(p, 0.5).toFixed(1).padStart(8)}   ` +
      `${q(v, 0.5).toFixed(3).padStart(17)}   ${q(t, 0.3).toFixed(3).padStart(16)}`,
  )
}

console.log('\n=== 逐条明细（便于人工核对标注是否合理）===')
console.log('条件         次数  peak  vRatio tRatio  标注')
for (const { s, f } of data.sort((a, b) => a.f.peak - b.f.peak)) {
  console.log(
    `${(s.condition ?? '').padEnd(10)} ${String(s.trueReps).padStart(4)}  ${f.peak.toFixed(0).padStart(5)}  ` +
      `${f.verticalRatio.toFixed(3)}  ${f.twistRatio.toFixed(3)}  ${s.errorCodes.join(',') || '—'}${s.note ? '  「' + s.note + '」' : ''}`,
  )
}

console.log('\n=== 当前阈值下的判定一致性 ===')
const minPeak = 38
const V = 0.6
const T = 0.25
let agree = 0
let fp = 0
let fn = 0
for (const { s, f } of data) {
  const pred = []
  if (f.peak < minPeak) pred.push('INSUFFICIENT_RANGE')
  if (f.verticalRatio < V) pred.push('NOT_VERTICAL')
  if (f.twistRatio > T) pred.push('WRIST_FLIP')
  const truth = [...s.errorCodes].sort()
  const p = pred.sort()
  const same = JSON.stringify(p) === JSON.stringify(truth)
  if (same) agree++
  else {
    for (const c of p) if (!truth.includes(c)) fp++
    for (const c of truth) if (!p.includes(c)) fn++
  }
  if (!same) {
    console.log(`  不一致  真值[${truth.join(',') || '—'}]  预测[${p.join(',') || '—'}]  peak=${f.peak.toFixed(0)} vR=${f.verticalRatio.toFixed(3)} tR=${f.twistRatio.toFixed(3)}`)
  }
}
console.log(`\n完全一致 ${agree}/${data.length} = ${((agree / data.length) * 100).toFixed(1)}%  误报 ${fp}  漏报 ${fn}`)
