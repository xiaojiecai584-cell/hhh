// 错误阈值标定：用「一次录制 = 一次重复 + 人工标注」的数据，看五个阈值该定在哪。
//
// 前置：在网站上用「逐段（标定阈值）」方式采集——一次录制只做一次动作，
//       停止后逐段标注「标准 / 不标准 + 错误码」。
// 运行：node scripts/calibrate-errors.mjs [--local] [--collect-url http://...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const optOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const COLLECT_URL = optOf('collect-url', process.env.COLLECT_URL || 'https://lindoway1.pages.dev')

const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { classifyMotion, ACTION_RULES, THRESHOLDS } = await server.ssrLoadModule('/src/core/analysis/ruleClassifier.ts')

let rows
if (args.includes('--local')) rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
else {
  try {
    rows = await (await fetch(`${COLLECT_URL}/api/collect`)).json()
    if (!Array.isArray(rows)) throw new Error('返回不是数组')
    console.log(`已从 ${COLLECT_URL} 拉取 ${rows.length} 条`)
  } catch (e) {
    console.log(`线上拉取失败（${e.message}），改用本地快照`)
    rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
  }
}

/** 只取「人工标注过」的单次记录：有 label.standard 或有 annotations */
const labeled = rows.filter(
  (r) =>
    Array.isArray(r.samples) &&
    r.samples.length >= 32 &&
    (r.labelSource === 'human' || (r.label && typeof r.label.standard === 'boolean') || (r.annotations ?? []).length > 0),
)

console.log(`\n可用于阈值标定的人工标注样本：${labeled.length} 条`)
if (labeled.length === 0) {
  console.log(`
没有找到人工标注样本。请先在网站上采集：
  调试站 → 动作录制与标注 → 上传方式选「逐段（标定阈值）」
  → 开始录制 → **只做一次动作** → 停止录制
  → 标注「标准」或「不标准 + 错误码」→ 提交入库

要点：
  1. 一次录制只做一次动作，这样标注粒度天然等于一次重复，不依赖自动切段；
  2. 先自己判断，再看规则结果——不要被自动标注锚定；
  3. 「标准」样本要占多数（阈值靠正常分布的尾部来定），建议每个动作 ≥30 条标准样本；
  4. 五类错误各至少 20 条，刻意做出来：行程不足=只做 1/3 幅度、过快=最快速度甩、
     过慢=极慢、不稳定=中途抖动换向、未完整=做到一半停。
`)
  await server.close()
  process.exit(1)
}

const sev = (r) => (r.label?.standard === true ? 'correct' : (r.annotations ?? []).length ? 'incorrect' : 'unknown')
const codesOf = (r) => (r.annotations ?? []).map((a) => a.code)

// ---- 逐样本算特征 ----
const data = labeled.map((r) => {
  const actionId = r.actionId ?? 1
  const res = classifyMotion(r.samples, actionId)
  return {
    actionId,
    human: sev(r),
    humanCodes: codesOf(r),
    feature: res.features,
    ruleCodes: res.errors.map((e) => e.code),
    usable: res.signalQuality.isUsable,
  }
})
const usable = data.filter((d) => d.usable)
const dropped = data.length - usable.length
console.log(`其中信号可用 ${usable.length} 条${dropped ? `（${dropped} 条因信号质量问题剔除）` : ''}`)

const byAction = new Map()
for (const d of usable) {
  const a = byAction.get(d.actionId) ?? []
  a.push(d)
  byAction.set(d.actionId, a)
}

const q = (arr, p) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]
}

console.log('\n=== 一、阈值当前表现（规则判定 vs 人工判定） ===')
for (const [actionId, list] of byAction) {
  const rule = ACTION_RULES[actionId]
  const correct = list.filter((d) => d.human === 'correct')
  const incorrect = list.filter((d) => d.human === 'incorrect')
  console.log(`\n动作 ${actionId} ${rule?.name ?? ''}（主分析轴 ${rule?.axis}，当前 min_peak=${rule?.minPeak}）`)
  console.log(`  人工：标准 ${correct.length} 条 / 不标准 ${incorrect.length} 条`)
  if (correct.length) {
    const pk = correct.map((d) => d.feature.peakAngularVelocity)
    console.log(
      `  标准样本主轴峰值：min ${q(pk, 0).toFixed(1)}  p5 ${q(pk, 0.05).toFixed(1)}  ` +
        `中位 ${q(pk, 0.5).toFixed(1)}  p95 ${q(pk, 0.95).toFixed(1)}  max ${q(pk, 1).toFixed(1)} °/s`,
    )
    const st = correct.map((d) => d.feature.stabilityStd)
    console.log(
      `  标准样本 stabilityStd：min ${q(st, 0).toFixed(2)}  中位 ${q(st, 0.5).toFixed(2)}  ` +
        `p95 ${q(st, 0.95).toFixed(2)}  max ${q(st, 1).toFixed(2)}   （当前阈值 ${THRESHOLDS.unstableStd}）`,
    )
    const du = correct.map((d) => d.feature.durationMs)
    console.log(
      `  标准样本时长：min ${q(du, 0).toFixed(0)}  中位 ${q(du, 0.5).toFixed(0)}  max ${q(du, 1).toFixed(0)} ms   （当前 ${THRESHOLDS.fastMs}~${THRESHOLDS.slowMs}）`,
    )
    // 误报：人工判标准，规则却报了错
    const fp = correct.filter((d) => d.ruleCodes.length > 0)
    console.log(`  ⚠ 误报（人工=标准但规则报错）：${fp.length}/${correct.length} = ${((fp.length / correct.length) * 100).toFixed(1)}%`)
    const fpCodes = {}
    for (const d of fp) for (const c of d.ruleCodes) fpCodes[c] = (fpCodes[c] ?? 0) + 1
    if (Object.keys(fpCodes).length) console.log(`     误报构成：${JSON.stringify(fpCodes)}`)
  }
  if (incorrect.length) {
    // 漏报：人工报了某错误码，规则没报
    let miss = 0
    let total = 0
    for (const d of incorrect) {
      for (const c of d.humanCodes) {
        total++
        if (!d.ruleCodes.includes(c)) miss++
      }
    }
    console.log(`  人工标注的错误共 ${total} 个，规则漏报 ${miss} 个 = ${total ? ((miss / total) * 100).toFixed(1) : '—'}%`)
  }
}

console.log('\n=== 二、阈值建议（按人工标签的分布） ===')
for (const [actionId, list] of byAction) {
  const correct = list.filter((d) => d.human === 'correct')
  const incorrect = list.filter((d) => d.human === 'incorrect')
  if (correct.length < 10) {
    console.log(`\n动作 ${actionId}：标准样本只有 ${correct.length} 条，不足以定阈值（建议 ≥30 条）`)
    continue
  }
  const rule = ACTION_RULES[actionId]
  // min_peak：取标准样本峰值的 p5 作为下限（低于它的正常动作会被误判为行程不足）
  const pkC = correct.map((d) => d.feature.peakAngularVelocity)
  const pkI = incorrect.flatMap((d) => d.humanCodes.includes('INSUFFICIENT_RANGE') ? [d.feature.peakAngularVelocity] : [])
  const sugMinPeak = q(pkC, 0.05)
  console.log(`\n动作 ${actionId}：`)
  console.log(
    `  min_peak: 当前 ${rule.minPeak}  →  建议 ${sugMinPeak.toFixed(1)}` +
      `（标准样本 p5 = ${sugMinPeak.toFixed(1)}，行程不足样本峰值中位 = ${pkI.length ? q(pkI, 0.5).toFixed(1) : '样本不足'}）`,
  )
  const stC = correct.map((d) => d.feature.stabilityStd)
  const stI = incorrect.flatMap((d) => (d.humanCodes.includes('UNSTABLE_MOTION') ? [d.feature.stabilityStd] : []))
  console.log(
    `  unstable_std: 当前 ${THRESHOLDS.unstableStd}  →  建议 ${q(stC, 0.95).toFixed(2)}` +
      `（标准样本 p95 = ${q(stC, 0.95).toFixed(2)}，不稳定样本中位 = ${stI.length ? q(stI, 0.5).toFixed(2) : '样本不足'}）`,
  )
  const duC = correct.map((d) => d.feature.durationMs)
  console.log(
    `  fast_ms/slow_ms: 当前 ${THRESHOLDS.fastMs}/${THRESHOLDS.slowMs}  →  建议 ${q(duC, 0.02).toFixed(0)}/${q(duC, 0.98).toFixed(0)}` +
      `（标准样本时长 2%~98% 分位）`,
  )
}

mkdirSync('D:/lindoway/.tmp-data/calib', { recursive: true })
writeFileSync('D:/lindoway/.tmp-data/calib/error-features.json', JSON.stringify(data, null, 2))
console.log('\n逐样本特征已写入 .tmp-data/calib/error-features.json，可用于后续拟合')
await server.close()
