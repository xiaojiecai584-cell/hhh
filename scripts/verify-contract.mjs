// 契约对齐验证：与 Python 后端（fitness_motion_ai）的判定逐条比对
// 运行：node scripts/verify-contract.mjs
import { createServer } from 'vite'

const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const contract = await server.ssrLoadModule('/src/core/analysis/contract.ts')
const { classifyMotion } = await server.ssrLoadModule('/src/core/analysis/ruleClassifier.ts')

let fail = 0
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`)
  if (!cond) fail++
}

// ============ 1. 采集上传格式：后端 json_importer 会怎么判 quality ============
// 复刻 src/motion_ai/data/json_importer.py 的判定：
//   has_standard_label = isinstance(item["label"], dict) and "standard" in item["label"]
//   standard = item["label"]["standard"] if has_standard_label else None
//   if standard is True and not errors: correct
//   elif standard is False or errors:   incorrect
//   else:                               unknown
function importerQuality(item) {
  const hasStd = item.label && typeof item.label === 'object' && 'standard' in item.label
  const standard = hasStd ? item.label.standard : null
  const errors = item.annotations ?? []
  if (standard === true && errors.length === 0) return 'correct'
  if (standard === false || errors.length > 0) return 'incorrect'
  return 'unknown'
}

const OLD_STANDARD = { kind: 'sensor_sample', actionId: 1, actionName: '坐姿推举', samples: [], annotations: [] }
const OLD_BAD = { ...OLD_STANDARD, annotations: [{ code: 'UNSTABLE_MOTION', severity: 'medium', startMs: 0, endMs: 2000 }] }
const NEW_STANDARD = { ...OLD_STANDARD, label: { standard: true }, labelSource: 'human', isWeakLabel: false, subjectId: 'subject-abc123', sessionId: 'session-x', sensor: { position: 'right_upper_arm', samplingRate: 50, channels: [...contract.SIGNAL_CHANNELS] }, phases: contract.phaseRanges(2000) }
const NEW_BAD = { ...NEW_STANDARD, label: { standard: false }, annotations: OLD_BAD.annotations }

console.log('=== 1. 采集上传格式对后端 quality 判定的影响 ===')
check('旧格式 · 手工"标准"样本 → 变成 unknown（这就是 178 条样本被记成 unknown 的原因）', importerQuality(OLD_STANDARD) === 'unknown', `实际 ${importerQuality(OLD_STANDARD)}`)
check('新格式 · 标准样本 → correct', importerQuality(NEW_STANDARD) === 'correct', `实际 ${importerQuality(NEW_STANDARD)}`)
check('新格式 · 不标准样本 → incorrect', importerQuality(NEW_BAD) === 'incorrect', `实际 ${importerQuality(NEW_BAD)}`)
check('新格式带 subjectId', NEW_STANDARD.subjectId.startsWith('subject-'))
check('新格式带 sensorPosition', NEW_STANDARD.sensor.position === 'right_upper_arm')
check('新格式标注 labelSource=human / isWeakLabel=false', NEW_STANDARD.labelSource === 'human' && NEW_STANDARD.isWeakLabel === false)
check('新格式带五阶段区间', NEW_STANDARD.phases.length === 5 && NEW_STANDARD.phases[0].name === 'ready')

// ============ 2. 信号质量（对齐 preprocessing.assess_quality）============
console.log('\n=== 2. 信号质量检查 ===')
const mk = (n, over = () => ({})) => Array.from({ length: n }, (_, i) => ({ t: i * 20, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, ...over(i) }))
const q = (s) => contract.assessQuality(s)

check('32 点正常 → 可用', q(mk(32)).isUsable)
const short = q(mk(31))
check('31 点 → insufficient_samples', !short.isUsable && short.issues.includes('insufficient_samples'))
const dup = q(mk(40, (i) => (i === 5 ? { t: 80 } : {})))
check('时间戳重复 → non_increasing_timestamps', dup.issues.includes('non_increasing_timestamps'))
// 纯丢包：把第 20 点之后的全部时间戳后移，只触发 packet_gap 一项
const gapOnly = mk(40).map((s, i) => (i >= 20 ? { ...s, t: s.t + 500 } : s))
const gapQ = q(gapOnly)
check('间隔超中位数 3 倍 → packet_gap', gapQ.issues.includes('packet_gap'), `（旧实现的布尔检查漏掉了这一项）`)
check('仅丢包 → 只扣 0.25，得分 0.75', gapQ.issues.length === 1 && Math.abs(gapQ.score - 0.75) < 1e-9, `issues=${JSON.stringify(gapQ.issues)} score=${gapQ.score}`)
const sat = q(mk(40, (i) => (i === 7 ? { gx: 2001 } : {})))
check('|值| > 2000 → saturation', sat.issues.includes('saturation'))
const nan = q(mk(40, (i) => (i === 3 ? { az: NaN } : {})))
check('NaN → non_finite_values', nan.issues.includes('non_finite_values'))

// ============ 3. 五阶段区间（对齐 actions/base.py）============
console.log('\n=== 3. 五阶段区间 ===')
const ph = contract.phaseRanges(2000)
const expect = [['ready', 0, 240], ['lifting', 240, 920], ['top', 920, 1160], ['lowering', 1160, 1800], ['complete', 1800, 2000]]
check('时长 2000ms 的区间与后端 bounds 一致', expect.every((e, i) => ph[i].name === e[0] && ph[i].startMs === e[1] && ph[i].endMs === e[2]), JSON.stringify(ph))

// ============ 4. 规则分类边界（对齐 当前错误分类标准.md §10）============
console.log('\n=== 4. 规则分类边界值 ===')
/** 构造一段主轴为 gy（动作1）的样本，指定峰值与时长 */
const axisSamples = (durationMs, peak, endpoint, opts = {}) => {
  const n = Math.max(32, Math.round(durationMs / 20) + 1)
  const arr = Array.from({ length: n }, (_, i) => ({
    t: i * (durationMs / (n - 1)),
    ax: 0,
    ay: 0,
    az: 1,
    gx: 0,
    gy: 0,
    gz: 0,
  }))
  // 让 gy 在中点达到 peak，末尾为 endpoint
  arr.forEach((s, i) => {
    const p = i / (n - 1)
    s.gy = peak * Math.sin(p * Math.PI)
  })
  arr[n - 1].gy = endpoint
  return arr
}
const codes = (s) => classifyMotion(s, 1).errors.map((e) => e.code).sort()

const r3799 = classifyMotion(axisSamples(2400, 37.99, 0), 1)
const r3800 = classifyMotion(axisSamples(2400, 38.0, 0), 1)
check('坐姿推举峰值 37.99 → 命中行程不足', r3799.errors.some((e) => e.code === 'INSUFFICIENT_RANGE'))
check('坐姿推举峰值 38.00 → 不命中', !r3800.errors.some((e) => e.code === 'INSUFFICIENT_RANGE'))

const f999 = classifyMotion(axisSamples(999, 60, 0), 1)
const f1000 = classifyMotion(axisSamples(1000, 60, 0), 1)
check('时长 999ms → 过快 + 未完整', f999.errors.some((e) => e.code === 'TEMPO_TOO_FAST') && f999.errors.some((e) => e.code === 'INCOMPLETE_REPETITION'))
check('时长 1000ms → 不因时长判过快/未完整', !f1000.errors.some((e) => e.code === 'TEMPO_TOO_FAST') && !f1000.errors.some((e) => e.code === 'INCOMPLETE_REPETITION'))

const s5000 = classifyMotion(axisSamples(5000, 60, 0), 1)
const s5001 = classifyMotion(axisSamples(5001, 60, 0), 1)
check('时长 5000ms → 不过慢', !s5000.errors.some((e) => e.code === 'TEMPO_TOO_SLOW'))
check('时长 5001ms → 过慢', s5001.errors.some((e) => e.code === 'TEMPO_TOO_SLOW'))

// 结束点角速度阈值（动作1 = 38 × 0.35 = 13.3）
const e133 = classifyMotion(axisSamples(2400, 60, 13.3), 1)
const e134 = classifyMotion(axisSamples(2400, 60, 13.4), 1)
check('结束点 13.3 → 不因结束点判未完整', !e133.errors.some((e) => e.code === 'INCOMPLETE_REPETITION'))
check('结束点 13.4 → 命中未完整', e134.errors.some((e) => e.code === 'INCOMPLETE_REPETITION'))

// 高风险总分上限 45
check('命中 high 时总分 ≤ 45', e134.score.overall <= 45, `实际 ${e134.score.overall}`)
check('严重度固定为 INCOMPLETE_REPETITION=high', e134.errors.find((e) => e.code === 'INCOMPLETE_REPETITION').severity === 'high')

// 信号不可用时不输出动作错误
const unusable = classifyMotion(mk(31), 1)
check('信号不可用 → 不输出任何动作错误且评分归零', unusable.errors.length === 0 && unusable.score.overall === 0 && unusable.phases.length === 0)

console.log(`\n${fail === 0 ? '全部通过' : `${fail} 项未通过`}`)
await server.close()
process.exit(fail === 0 ? 0 : 1)
