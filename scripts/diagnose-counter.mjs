// 用工程包里「一条 = 一次重复」的 213 条真实样本，直接测 RepCounter 的单次识别率。
// 这是"计数器该输出 1"的天然测试集，能直接量化「坐姿推举识别一般、侧平举不错」。
// 运行：node scripts/diagnose-counter.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const P = 'D:/lindoway/.tmp-data/pkg/fitness_motion_ai_package'
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RepCounter, DEFAULT_REP_OPTIONS } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')

const manifest = readFileSync(`${P}/data/real_experiment/annotations/manifest.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

function readCsv(rel) {
  const f = join(P, 'data/real_experiment', rel.replace('../', ''))
  if (!existsSync(f)) return null
  const lines = readFileSync(f, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',').map((h) => h.trim())
  const idx = (k) => head.indexOf(k)
  if (idx('gz') < 0) return null
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    const v = (k) => Number(c[idx(k)])
    out.push({ t: v('timestamp'), ax: v('ax'), ay: v('ay'), az: v('az'), gx: v('gx'), gy: v('gy'), gz: v('gz') })
  }
  return out
}

/** 跑一次计数，同时记录峰值/角速度峰值供诊断 */
function run(samples, opts) {
  const c = new RepCounter(opts)
  const evs = []
  for (const s of samples) {
    const e = c.push(s)
    if (e) evs.push(e)
  }
  const tail = c.flush(samples[samples.length - 1].t)
  if (tail) evs.push(tail)
  return { count: c.repCount, evs }
}

const byAction = new Map()
for (const r of manifest) {
  const samples = readCsv(r.file)
  if (!samples || samples.length < 32) continue
  const list = byAction.get(r.actionId) ?? []
  list.push({ sampleId: r.sampleId, samples, codes: r.label.errors.map((e) => e.code) })
  byAction.set(r.actionId, list)
}

const NAME = { 1: '坐姿推举', 2: '站姿侧平举' }

console.log('=== 单次识别率（每条样本都是一次重复，理想输出 = 1）===\n')
async function rate(signal) {
  const summary = {}
  const lines = []
  for (const [actionId, list] of byAction) {
    let one = 0
    let zero = 0
    let many = 0
    const details = []
    for (const s of list) {
      const { count, evs } = run(s.samples, { signal })
      if (count === 1) one++
      else if (count === 0) zero++
      else many++
      details.push({ ...s, count, ev: evs[0] })
    }
    summary[actionId] = details
    lines.push(
      `${(NAME[actionId] ?? actionId).padEnd(12)} ${String(list.length).padStart(4)}  ${String(one).padStart(6)}  ${String(zero).padStart(6)}  ` +
        `${String(many).padStart(6)}   ${((one / list.length) * 100).toFixed(1)}%`,
    )
  }
  return { summary, lines }
}

console.log('信号 = gravity（重力方向姿态改变量）')
console.log('动作         样本   数出1   数出0   数出≥2   正确率')
const g = await rate('gravity')
for (const l of g.lines) console.log(l)
console.log('\n信号 = gyro（角速度模长包络）')
console.log('动作         样本   数出1   数出0   数出≥2   正确率')
const y = await rate('gyro')
for (const l of y.lines) console.log(l)
const summary = y.summary

// ---- 网格搜索：两种信号 × 关键参数 ----
console.log('\n=== 参数网格（按动作分别报告"数出 1"的比例）===')
const grids = []
for (const signal of ['gravity', 'gyro']) {
  const minReps = signal === 'gyro' ? [700, 1000, 1300, 1600] : [700, 1000]
  const omegas = signal === 'gyro' ? [30, 40, 50] : [40]
  const taus = signal === 'gyro' ? [120, 250] : [120]
  const fallFracs = signal === 'gyro' ? [0.4, 0.25] : [0.4]
  for (const minRepMs of minReps)
    for (const minOmegaPeakDps of omegas)
      for (const omegaTauMs of taus)
        for (const fallFrac of fallFracs) {
          const opts = { signal, minRepMs, minOmegaPeakDps, omegaTauMs, fallFrac }
          const acc = {}
          const over = {}
          for (const [actionId, list] of byAction) {
            let one = 0
            let many = 0
            for (const s of list) {
              const { count } = run(s.samples, opts)
              if (count === 1) one++
              if (count >= 2) many++
            }
            acc[actionId] = one / list.length
            over[actionId] = many
          }
          grids.push({
            ...opts,
            a1: acc[1],
            a2: acc[2],
            avg: (acc[1] + acc[2]) / 2,
            over1: over[1],
            over2: over[2],
          })
        }
}
grids.sort((a, b) => b.avg - a.avg)
console.log('信号     minRep ω门限 τ    fallFrac | 坐姿推举 侧平举  平均  | 重复计数(推/侧)')
for (const g of grids.slice(0, 12)) {
  console.log(
    `${g.signal.padEnd(8)} ${String(g.minRepMs).padStart(5)} ${String(g.minOmegaPeakDps).padStart(5)} ${String(g.omegaTauMs).padStart(4)} ${String(g.fallFrac).padStart(8)} | ` +
      `${(g.a1 * 100).toFixed(1).padStart(7)}% ${(g.a2 * 100).toFixed(1).padStart(6)}% ${(g.avg * 100).toFixed(1).padStart(6)}% | ${String(g.over1).padStart(3)}/${String(g.over2).padStart(3)}`,
  )
}
console.log('\n=== 按动作分别选最优（数据驱动）===')
for (const actionId of [1, 2]) {
  const key = actionId === 1 ? 'a1' : 'a2'
  const overKey = actionId === 1 ? 'over1' : 'over2'
  const best = [...grids].sort((a, b) => b[key] - a[key] || a[overKey] - b[overKey])[0]
  console.log(
    `${NAME[actionId]}：signal=${best.signal} minRepMs=${best.minRepMs} minOmegaPeakDps=${best.minOmegaPeakDps} ` +
      `omegaTauMs=${best.omegaTauMs} fallFrac=${best.fallFrac} → 识别率 ${(best[key] * 100).toFixed(1)}%，重复计数 ${best[overKey]} 条`,
  )
}

// ---- 关键：按「人工是否标了行程不足」分开看 ----
// 一个几乎没幅度的动作，"数出 0" 未必是漏检，可能正是对的。
console.log('\n=== 按人工标签分组（行程不足 vs 其余）===')
for (const opts of [
  { label: '当前默认（gravity）', o: { signal: 'gravity' } },
  { label: 'gyro τ250 ω30 fall0.25', o: { signal: 'gyro', minOmegaPeakDps: 30, omegaTauMs: 250, fallFrac: 0.25 } },
]) {
  console.log(`\n  ${opts.label}`)
  console.log('    动作        分组              样本  数出1  数出0  数出≥2  应计率')
  for (const [actionId, list] of byAction) {
    for (const [gname, pred] of [
      ['未标行程不足（应数出1）', (d) => !d.codes.includes('INSUFFICIENT_RANGE')],
      ['标了行程不足（可不计）', (d) => d.codes.includes('INSUFFICIENT_RANGE')],
    ]) {
      const sub = list.filter(pred)
      if (!sub.length) continue
      let one = 0
      let zero = 0
      let many = 0
      for (const s of sub) {
        const { count } = run(s.samples, opts.o)
        if (count === 1) one++
        else if (count === 0) zero++
        else many++
      }
      console.log(
        `    ${(NAME[actionId] ?? actionId).padEnd(11)} ${gname.padEnd(22)} ${String(sub.length).padStart(4)}  ${String(one).padStart(5)}  ${String(zero).padStart(5)}  ` +
          `${String(many).padStart(5)}   ${((one / sub.length) * 100).toFixed(1)}%`,
      )
    }
  }
}

// ---- 拒因统计：用最优配置跑一遍，看漏检都卡在哪道闸 ----
console.log('\n=== 漏检拒因统计（gyro τ250 ω30 fall0.25）===')
for (const [aid2, list] of Object.entries(summary)) {
  const actionId = Number(aid2)
  const tally = {}
  for (const s of list) {
    const c = new RepCounter({ signal: 'gyro', minOmegaPeakDps: 30, omegaTauMs: 250, fallFrac: 0.25 })
    for (const x of s.samples) c.push(x)
    c.flush(s.samples[s.samples.length - 1].t)
    if (c.repCount === 0) {
      const r = c.lastRejectReason ?? 'no_fall_detected（一直没回落到 fallFrac 以下）'
      tally[r] = (tally[r] ?? 0) + 1
    }
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0)
  console.log(`  ${NAME[actionId]}：漏 ${total} 条 → ${JSON.stringify(tally)}`)
}

// ---- 数出 0 的那些：卡在哪一道闸 ----
console.log('\n=== 没数出来的（count=0）卡在哪 ===')
for (const [aid, list] of Object.entries(summary)) {
  const actionId = Number(aid)
  const miss = list.filter((d) => d.count === 0)
  if (!miss.length) continue
  console.log(`\n${NAME[actionId]}：漏 ${miss.length}/${list.length} 条`)
  // 用整段自己算一遍峰值姿态改变量与角速度峰值（复刻计数器内部量）
  const info = []
  for (const d of miss) {
    const { RepCounter: RC } = { RepCounter }
    const c = new RC()
    let maxD = 0
    let maxOmega = 0
    for (const s of d.samples) {
      c.push(s)
      if (c.currentDisplacementDeg > maxD) maxD = c.currentDisplacementDeg
      const om = Math.hypot(s.gx, s.gy, s.gz)
      if (om > maxOmega) maxOmega = om
    }
    info.push({ id: d.sampleId, n: d.samples.length, maxD, maxOmega, codes: d.codes })
  }
  const nums = (k) => info.map((x) => x[k]).sort((a, b) => a - b)
  const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))]
  const dArr = nums('maxD')
  const oArr = nums('maxOmega')
  console.log(
    `  漏检样本的姿态改变量峰值 maxD：min ${q(dArr, 0).toFixed(1)}  中位 ${q(dArr, 0.5).toFixed(1)}  max ${q(dArr, 1).toFixed(1)}°` +
      `   （门限 minRangeDeg=${DEFAULT_REP_OPTIONS.minRangeDeg}，有基线后为已计次中位数×${DEFAULT_REP_OPTIONS.adaptiveFloorRatio}）`,
  )
  console.log(
    `  漏检样本的角速度峰值：min ${q(oArr, 0).toFixed(0)}  中位 ${q(oArr, 0.5).toFixed(0)}  max ${q(oArr, 1).toFixed(0)}°/s` +
      `   （门限 minOmegaPeakDps=${DEFAULT_REP_OPTIONS.minOmegaPeakDps}）`,
  )
  console.log(`  前 8 条：${info.slice(0, 8).map((x) => `${x.id}(maxD=${x.maxD.toFixed(0)}°,ω=${x.maxOmega.toFixed(0)})`).join(' ')}`)
}

// ---- 数出来的那些：maxD 分布，用于定合理门限 ----
console.log('\n=== 数出来了的（count≥1）姿态改变量峰值分布（用于定 minRangeDeg）===')
for (const [aid, list] of Object.entries(summary)) {
  const actionId = Number(aid)
  const hit = list.filter((d) => d.count >= 1)
  if (!hit.length) continue
  const ds = []
  for (const d of hit) {
    const c = new RepCounter()
    let maxD = 0
    for (const s of d.samples) {
      c.push(s)
      if (c.currentDisplacementDeg > maxD) maxD = c.currentDisplacementDeg
    }
    ds.push(maxD)
  }
  ds.sort((a, b) => a - b)
  const q = (p) => ds[Math.floor(p * (ds.length - 1))]
  console.log(
    `${NAME[actionId]}：n=${ds.length}  p5 ${q(0.05).toFixed(1)}  p25 ${q(0.25).toFixed(1)}  中位 ${q(0.5).toFixed(1)}  p75 ${q(0.75).toFixed(1)}  max ${q(1).toFixed(1)}°`,
  )
}

await server.close()
