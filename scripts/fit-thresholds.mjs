// 用工程包里的人工标注样本拟合五类错误阈值。
//
// 数据来源：data/real_experiment/manifest.jsonl（213 条，其中 165 条带人工错误码）
//          + data/real_experiment/raw/**/*.csv（切好的单次样本）
// 方法：对每个错误码，以「人工标了该码」为正类、「人工没标该码」为负类，
//       扫描阈值取 F1 最大点；同时给出当前阈值的表现与一致性诊断。
//
// 运行：node scripts/fit-thresholds.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const P = 'D:/lindoway/.tmp-data/pkg/fitness_motion_ai_package'
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { classifyMotion } = await server.ssrLoadModule('/src/core/analysis/ruleClassifier.ts')

// ---- 读样本 ----
const manifest = readFileSync(`${P}/data/real_experiment/annotations/manifest.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

function readCsv(rel) {
  const f = join(P, 'data/real_experiment', rel.replace('../', ''))
  if (!existsSync(f)) return null
  // 注意：CSV 是 CRLF，行尾的 \r 会让表头最后一列变成 'gz\r'，
  // indexOf('gz') 返回 -1 → 该列全 NaN → 被信号质量检查判成 non_finite_values
  const lines = readFileSync(f, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',').map((h) => h.trim())
  const idx = (k) => head.indexOf(k)
  if (idx('gz') < 0 || idx('timestamp') < 0) return null
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    const v = (k) => Number(c[idx(k)])
    out.push({ t: v('timestamp'), ax: v('ax'), ay: v('ay'), az: v('az'), gx: v('gx'), gy: v('gy'), gz: v('gz') })
  }
  return out
}

const rows = []
for (const r of manifest) {
  const samples = readCsv(r.file)
  if (!samples || samples.length < 32) continue
  const res = classifyMotion(samples, r.actionId)
  if (!res.signalQuality.isUsable) continue
  rows.push({
    actionId: r.actionId,
    codes: r.label.errors.map((e) => e.code),
    quality: r.label.quality,
    n: samples.length,
    f: res.features,
    ruleCodes: res.errors.map((e) => e.code),
  })
}

console.log(`=== 可用样本 ${rows.length} 条（manifest ${manifest.length} 条）===`)
console.log(`按动作：1 坐姿推举 ${rows.filter((r) => r.actionId === 1).length} 条，2 站姿侧平举 ${rows.filter((r) => r.actionId === 2).length} 条`)

// ---- 一致性诊断：人工标签 vs 特征是否说得通 ----
console.log('\n=== 一、标签与特征的一致性诊断（先看标签能不能用）===')

// 按记录长度分组：短记录（≤100 点 ≈2s）大概率就是一次重复，边界天然正确；
// 长记录来自旧 segmentMotion 切段，边界可能根本不对。
const buckets = [
  ['≤100 点（≈≤2s，疑似单次）', (r) => r.n <= 100],
  ['101~200 点', (r) => r.n > 100 && r.n <= 200],
  ['>200 点（>4s，疑似切错）', (r) => r.n > 200],
]
console.log('  按记录长度分组（点数来自 manifest 里切好的 CSV）：')
for (const [name, pred] of buckets) {
  const sub = rows.filter((r) => pred({ n: r.n }))
  const slow = sub.filter((r) => r.codes.includes('TEMPO_TOO_SLOW'))
  const fast = sub.filter((r) => r.codes.includes('TEMPO_TOO_FAST'))
  const slowOk = slow.filter((r) => r.f.durationMs > 5000).length
  const fastOk = fast.filter((r) => r.f.durationMs < 1000).length
  console.log(
    `    ${name.padEnd(26)} 共 ${String(sub.length).padStart(3)} 条 | ` +
      `标"过慢" ${String(slow.length).padStart(2)} 条中时长>5s 的 ${slowOk} 条 | ` +
      `标"过快" ${String(fast.length).padStart(2)} 条中时长<1s 的 ${fastOk} 条`,
  )
}

const diag = [
  ['TEMPO_TOO_FAST', 'durationMs', (v) => v < 1000, '时长 <1000ms'],
  ['TEMPO_TOO_SLOW', 'durationMs', (v) => v > 5000, '时长 >5000ms'],
]
for (const [code, feat, pred, desc] of diag) {
  const pos = rows.filter((r) => r.codes.includes(code))
  const ok = pos.filter((r) => pred(r.f[feat])).length
  console.log(`  ${code.padEnd(22)} 人工标了 ${String(pos.length).padStart(3)} 条，其中特征也符合「${desc}」的只有 ${ok} 条 = ${pos.length ? ((ok / pos.length) * 100).toFixed(0) : '—'}%`)
}
const irPos = rows.filter((r) => r.codes.includes('INSUFFICIENT_RANGE'))
const irByAction = [1, 2].map((a) => {
  const p = irPos.filter((r) => r.actionId === a)
  const minPeak = a === 1 ? 38 : 34
  const below = p.filter((r) => r.f.peakAngularVelocity < minPeak).length
  return `动作${a}: ${below}/${p.length}`
})
console.log(`  INSUFFICIENT_RANGE     人工标的样本里峰值低于当前 min_peak 的比例 → ${irByAction.join('，')}`)
const umPos = rows.filter((r) => r.codes.includes('UNSTABLE_MOTION'))
console.log(
  `  UNSTABLE_MOTION        人工标了 ${umPos.length} 条，其中 stabilityStd>7 的 ${umPos.filter((r) => r.f.stabilityStd > 7).length} 条`,
)
const negUm = rows.filter((r) => !r.codes.includes('UNSTABLE_MOTION'))
console.log(
  `                         人工**没**标 UNSTABLE_MOTION 的 ${negUm.length} 条里，stabilityStd>7 的有 ${negUm.filter((r) => r.f.stabilityStd > 7).length} 条（= 当前阈值的误报）`,
)
console.log('\n  各错误码下 stabilityStd / peak / duration 的中位数：')
for (const code of ['INSUFFICIENT_RANGE', 'TEMPO_TOO_FAST', 'TEMPO_TOO_SLOW', 'UNSTABLE_MOTION', 'INCOMPLETE_REPETITION']) {
  const pos = rows.filter((r) => r.codes.includes(code))
  const neg = rows.filter((r) => !r.codes.includes(code))
  const med = (arr, k) => {
    if (!arr.length) return NaN
    const s = arr.map((r) => r.f[k]).sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  console.log(
    `    ${code.padEnd(22)} n+=${String(pos.length).padStart(3)} n-=${String(neg.length).padStart(3)} | ` +
      `peak ${med(pos, 'peakAngularVelocity').toFixed(0)}/${med(neg, 'peakAngularVelocity').toFixed(0)}  ` +
      `stab ${med(pos, 'stabilityStd').toFixed(1)}/${med(neg, 'stabilityStd').toFixed(1)}  ` +
      `dur ${med(pos, 'durationMs').toFixed(0)}/${med(neg, 'durationMs').toFixed(0)}`,
  )
}

// ---- 阈值拟合 ----
function sweep(pos, neg, key, dir, lo, hi, steps = 200) {
  let best = null
  for (let i = 0; i <= steps; i++) {
    const th = lo + ((hi - lo) * i) / steps
    const hit = (v) => (dir === 'lt' ? v < th : v > th)
    const tp = pos.filter((r) => hit(r.f[key])).length
    const fp = neg.filter((r) => hit(r.f[key])).length
    const fn = pos.length - tp
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = pos.length > 0 ? tp / pos.length : 0
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
    const youden = recall - (neg.length ? fp / neg.length : 0)
    if (!best || f1 > best.f1) best = { th, f1, precision, recall, tp, fp, fn, youden }
  }
  return best
}

const fit = {}
console.log('\n=== 二、阈值拟合（F1 最大点）===')
for (const actionId of [1, 2]) {
  const sub = rows.filter((r) => r.actionId === actionId)
  const pos = sub.filter((r) => r.codes.includes('INSUFFICIENT_RANGE'))
  const neg = sub.filter((r) => !r.codes.includes('INSUFFICIENT_RANGE'))
  const cur = actionId === 1 ? 38 : 34
  if (pos.length < 5 || neg.length < 5) {
    console.log(`  动作${actionId} INSUFFICIENT_RANGE：正/负样本不足（${pos.length}/${neg.length}），跳过`)
    continue
  }
  const b = sweep(pos, neg, 'peakAngularVelocity', 'lt', 0, 120)
  console.log(
    `  动作${actionId} min_peak：当前 ${cur} → 拟合 ${b.th.toFixed(1)}  ` +
      `P=${(b.precision * 100).toFixed(0)}% R=${(b.recall * 100).toFixed(0)}% F1=${b.f1.toFixed(2)}  (n+=${pos.length} n-=${neg.length})`,
  )
  fit[`minPeak_${actionId}`] = Math.round(b.th * 10) / 10
}

const globalFits = [
  ['TEMPO_TOO_FAST', 'durationMs', 'gt', 0, 4000, 1000, 'fastMs'],
  ['TEMPO_TOO_SLOW', 'durationMs', 'lt', 800, 20000, 5000, 'slowMs'],
  ['UNSTABLE_MOTION', 'stabilityStd', 'gt', 0, 60, 7.0, 'unstableStd'],
]
for (const [code, key, dir, lo, hi, cur, slot] of globalFits) {
  const pos = rows.filter((r) => r.codes.includes(code))
  const neg = rows.filter((r) => !r.codes.includes(code))
  if (pos.length < 5 || neg.length < 5) {
    console.log(`  ${code}：正/负样本不足（${pos.length}/${neg.length}），跳过`)
    continue
  }
  const b = sweep(pos, neg, key, dir, lo, hi)
  console.log(
    `  ${code.padEnd(22)} 当前阈值 ${String(cur).padStart(5)} → 拟合 ${b.th.toFixed(1).padStart(7)}  ` +
      `P=${(b.precision * 100).toFixed(0)}% R=${(b.recall * 100).toFixed(0)}% F1=${b.f1.toFixed(2)}  (n+=${pos.length} n-=${neg.length})`,
  )
  fit[slot] = Math.round(b.th * 100) / 100
}

// INCOMPLETE_REPETITION 是「时长过短 或 结束点角速度过高」的或关系，分别拟合
{
  const pos = rows.filter((r) => r.codes.includes('INCOMPLETE_REPETITION'))
  const neg = rows.filter((r) => !r.codes.includes('INCOMPLETE_REPETITION'))
  console.log(`  INCOMPLETE_REPETITION  正样本只有 ${pos.length} 条（负 ${neg.length}），样本太少，本次不拟合`)
}

// ---- 用拟合阈值重算，看整体改善 ----
console.log('\n=== 三、整体指标（在同一批标注样本上复算）===')
function evaluate(th) {
  const use = (code, f, actionId) =>
    ({
      INSUFFICIENT_RANGE: f.peakAngularVelocity < (th[`minPeak_${actionId}`] ?? (actionId === 1 ? 38 : 34)),
      TEMPO_TOO_FAST: f.durationMs < (th.fastMs ?? 1000),
      TEMPO_TOO_SLOW: f.durationMs > (th.slowMs ?? 5000),
      UNSTABLE_MOTION: f.stabilityStd > (th.unstableStd ?? 7.0),
      INCOMPLETE_REPETITION: f.durationMs < 1000 || f.endpointAngularVelocity > (th[`minPeak_${actionId}`] ?? 38) * 0.35,
    })[code]

  let exact = 0
  const stat = {}
  for (const r of rows) {
    const predicted = ['INSUFFICIENT_RANGE', 'TEMPO_TOO_FAST', 'TEMPO_TOO_SLOW', 'UNSTABLE_MOTION', 'INCOMPLETE_REPETITION'].filter(
      (c) => use(c, r.f, r.actionId),
    )
    if (predicted.length === r.codes.length && predicted.every((c) => r.codes.includes(c))) exact++
    for (const c of ['INSUFFICIENT_RANGE', 'TEMPO_TOO_FAST', 'TEMPO_TOO_SLOW', 'UNSTABLE_MOTION', 'INCOMPLETE_REPETITION']) {
      const s = (stat[c] ??= { tp: 0, fp: 0, fn: 0 })
      const p = predicted.includes(c)
      const a = r.codes.includes(c)
      if (p && a) s.tp++
      else if (p && !a) s.fp++
      else if (!p && a) s.fn++
    }
  }
  return { exact, stat }
}

const before = evaluate({})
const after = evaluate(fit)
console.log(`  当前阈值：完全命中 ${before.exact}/${rows.length} = ${((before.exact / rows.length) * 100).toFixed(1)}%`)
console.log(`  拟合阈值：完全命中 ${after.exact}/${rows.length} = ${((after.exact / rows.length) * 100).toFixed(1)}%`)
console.log('\n  逐类别的 P / R / F1：')
console.log('    错误码                  当前 P/R/F1            拟合 P/R/F1')
for (const c of ['INSUFFICIENT_RANGE', 'TEMPO_TOO_FAST', 'TEMPO_TOO_SLOW', 'UNSTABLE_MOTION', 'INCOMPLETE_REPETITION']) {
  const prf = (s) => {
    if (!s) return '   —   '
    const p = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : 0
    const r = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : 0
    const f = p + r > 0 ? (2 * p * r) / (p + r) : 0
    return `${String(Math.round(p * 100)).padStart(3)}/${String(Math.round(r * 100)).padStart(3)}/${f.toFixed(2)}`
  }
  console.log(`    ${c.padEnd(22)} ${prf(before.stat[c]).padEnd(20)} ${prf(after.stat[c])}`)
}

console.log('\n=== 四、拟合出的阈值 ===')
console.log(JSON.stringify(fit, null, 2))
mkdirSync('D:/lindoway/.tmp-data/calib', { recursive: true })
writeFileSync(
  'D:/lindoway/.tmp-data/calib/fitted-thresholds.json',
  JSON.stringify({ fit, before: before.exact, after: after.exact, n: rows.length, fittedFrom: 'fitness_motion_ai_package real_experiment manifest' }, null, 2),
)
console.log('已写入 .tmp-data/calib/fitted-thresholds.json')

console.log(`
注意（必须写进结论里）：
  · 正负类来自「人工有没有标这个错误码」，负类里混着其他错误，所以是**带噪标定**；
  · 只有 1 条 correct 样本，没有干净的"标准动作"负类；
  · 样本边界是旧 segmentMotion 切出来的，时长类标签（过快/过慢）的可靠性受此限制；
  · 这批标签来自网站逐段人工标注，是**真人判断**，不是规则弱标签。`)

await server.close()
