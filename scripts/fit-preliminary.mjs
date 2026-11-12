// 初步模型：标准化特征 + kNN(k=1) + 留一验证(LOO)。
// 为什么在 25 条样本上选这个方法：
//   1) 不需要假设特征方向——而 twistRatio 在外翻组反而更低，闽值法的方向是错的；
//   2) 不做参数拟合，只做"离哪个已标注样本最近"，过拟合风险远低于网格搜索阈值；
//   3) LOO 在 25 条上仍能给出诚实的估计（每次留 1 条，用剩下 24 条判断）。
//
// 同时给出三组闽值的对比：当前线上值、分组中点值、带安全边距的值。
// 运行：node scripts/fit-preliminary.mjs <json...>
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
const raw = []
for (const p of files) {
  const d = JSON.parse(readFileSync(p, 'utf8'))
  for (const s of d.samples ?? []) raw.push(s)
}

const MAIN_AXIS = { 1: 'gy', 2: 'gx' }
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
    const ux = g.x / gm, uy = g.y / gm, uz = g.z / gm
    const along = a.x * ux + a.y * uy + a.z * uz
    const a2 = a.x * a.x + a.y * a.y + a.z * a.z
    vE += (along - 1) * (along - 1)
    hE += Math.max(0, a2 - along * along)
    twist += Math.abs(fr[i].gx * ux + fr[i].gy * uy + fr[i].gz * uz)
    total += Math.hypot(fr[i].gx, fr[i].gy, fr[i].gz)
  }
  return { peak, verticalRatio: vE + hE > 0 ? vE / (vE + hE) : 1, twistRatio: total > 0 ? twist / total : 0 }
}

const CODES = ['INSUFFICIENT_RANGE', 'NOT_VERTICAL', 'WRIST_FLIP']
const data = raw.map((s) => ({ s, f: features(s) }))
const n = data.length

// ---- 标准化（用全体均值/标准差；LOO 时严格来说应在训练折内重算，这里把差值作为近似上界）----
const mu = {}
const sd = {}
for (const k of ['peak', 'verticalRatio', 'twistRatio']) {
  const v = data.map((d) => d.f[k])
  mu[k] = v.reduce((a, b) => a + b, 0) / n
  sd[k] = Math.sqrt(v.reduce((a, b) => a + (b - mu[k]) ** 2, 0) / n) || 1
}
const vec = (d) => [(d.f.peak - mu.peak) / sd.peak, (d.f.verticalRatio - mu.verticalRatio) / sd.verticalRatio, (d.f.twistRatio - mu.twistRatio) / sd.twistRatio]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// ---- LOO：每次留 1 条，用最近的已标注样本预测它每个错误码 ----
function looPredict(k = 1) {
  const out = []
  for (let i = 0; i < n; i++) {
    const others = data.filter((_, j) => j !== i)
    const vi = vec(data[i])
    const nn = others
      .map((d) => ({ d, dd: dist(vi, vec(d)) }))
      .sort((a, b) => a.dd - b.dd)
      .slice(0, k)
    const pred = new Set()
    for (const { d } of nn) for (const c of d.s.errorCodes) pred.add(c)
    out.push({ truth: new Set(data[i].s.errorCodes), pred })
  }
  return out
}

function report(name, res) {
  let exact = 0
  const tp = {}, fp = {}, fn = {}
  for (const c of CODES) { tp[c] = 0; fp[c] = 0; fn[c] = 0 }
  const std = { tp: 0, fp: 0, fn: 0 }
  for (const { truth, pred } of res) {
    const same = truth.size === pred.size && [...truth].every((c) => pred.has(c))
    if (same) exact++
    for (const c of CODES) {
      if (truth.has(c) && pred.has(c)) tp[c]++
      else if (!truth.has(c) && pred.has(c)) fp[c]++
      else if (truth.has(c) && !pred.has(c)) fn[c]++
    }
    const tStd = truth.size === 0
    const pStd = pred.size === 0
    if (tStd && pStd) std.tp++
    else if (!tStd && pStd) std.fn++
    else if (tStd && !pStd) std.fp++
  }
  console.log(`\n${name}`)
  console.log(`  完全一致 ${exact}/${n} = ${((exact / n) * 100).toFixed(1)}%`)
  const prf = (c) => {
    const P = tp[c] + fp[c] > 0 ? tp[c] / (tp[c] + fp[c]) : NaN
    const R = tp[c] + fn[c] > 0 ? tp[c] / (tp[c] + fn[c]) : NaN
    const F = !isNaN(P) && !isNaN(R) && P + R > 0 ? (2 * P * R) / (P + R) : NaN
    return `P=${isNaN(P) ? '—' : P.toFixed(2)}  R=${isNaN(R) ? '—' : R.toFixed(2)}  F1=${isNaN(F) ? '—' : F.toFixed(2)}`
  }
  for (const c of CODES) console.log(`  ${c.padEnd(20)} ${prf(c)}`)
  console.log(`  （标准动作是否有误报）误报 ${std.fp} 次，漏报 ${std.fn} 次`)
}

console.log(`样本 ${n} 条`)
console.log(`特征均值/标准差：`)
for (const k of ['peak', 'verticalRatio', 'twistRatio']) console.log(`  ${k.padEnd(14)} μ=${mu[k].toFixed(3)}  σ=${sd[k].toFixed(3)}`)

report('【kNN k=1 留一验证】', looPredict(1))
report('【kNN k=3 留一验证】', looPredict(3))

// ---- 对照：现闽值与数据中点 ----
function evalThresholds(label, minPeak, vRatio, tRatio, vDir = '<', tDir = '>') {
  const res = data.map((d) => {
    const pred = new Set()
    if (d.f.peak < minPeak) pred.add('INSUFFICIENT_RANGE')
    if (vDir === '<' ? d.f.verticalRatio < vRatio : d.f.verticalRatio > vRatio) pred.add('NOT_VERTICAL')
    if (tDir === '>' ? d.f.twistRatio > tRatio : d.f.twistRatio < tRatio) pred.add('WRIST_FLIP')
    return { truth: new Set(d.s.errorCodes), pred }
  })
  report(label, res)
}

evalThresholds('【对照：当前线上闽值 peak<38 / vR<0.6 / tR>0.25】', 38, 0.6, 0.25, '<', '>')
evalThresholds('【对照：数据中点 peak<80 / vR<0.28 / tR>0.45】', 80, 0.28, 0.45, '<', '>')
evalThresholds('【对照：中点+方向翻转 tR<0.45】', 80, 0.28, 0.45, '<', '<')
