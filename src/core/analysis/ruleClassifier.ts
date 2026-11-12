// 规则分类器：依据《当前错误分类标准.md》实现 5 类动作错误的规则判定 + 评分。
// 输入：单个动作的主轴时序数据（7 列：timestamp, ax, ay, az, gx, gy, gz）+ actionId。
// 输出：信号质量、是否标准、命中的错误码列表、特征值与分项/总分。
//
// 阈值、评分公式、严重度/置信度/关联阶段均与 Python 后端
// （src/motion_ai/analyzers/rule_based.py、actions/base.py）逐项对齐。
// 后端可用时以接口分析结果为最终依据，本模块作为离线/回退实现。

import { assessQuality, phaseRanges, type ErrorCode, type Phase, type Severity, type SensorSample, type SignalQualityResult } from './contract'

export type { ErrorCode, Severity, SensorSample } from './contract'

export interface RuleError {
  code: ErrorCode
  severity: Severity
  confidence: number
  startMs: number
  endMs: number
  phase: Phase | null
  source: 'rule'
}

export interface RuleFeatures {
  durationMs: number
  peakAngularVelocity: number
  stabilityStd: number
  energy: number
  topDurationMs: number
  endpointAngularVelocity: number
}

export interface RuleScore {
  rangeOfMotion: number
  tempo: number
  stability: number
  consistency: number
  overall: number
  /** 扣分明细（扣分制的依据）；旧记录没有该字段，读取时按缺失处理 */
  deductions?: { code: string; points: number }[]
}
export interface RuleResult {
  signalQuality: SignalQualityResult
  standard: boolean
  errors: RuleError[]
  features: RuleFeatures
  score: RuleScore
  /** 五阶段区间（按总时长比例，预标注基线） */
  phases: { name: Phase; startMs: number; endMs: number }[]
}

/** 各动作的主分析轴与最小峰值阈值（min_peak，°/s）—— 与后端 actions 注册表一致 */
export const ACTION_RULES: Record<number, { axis: 'gx' | 'gy' | 'gz'; minPeak: number; name: string }> = {
  1: { axis: 'gy', minPeak: 38, name: 'seated_shoulder_press' }, // 坐姿推举
  2: { axis: 'gx', minPeak: 34, name: 'standing_lateral_raise' }, // 站姿侧平举
}

/** 共用阈值（后端 ActionThresholds） */
export const THRESHOLDS = {
  fastMs: 1000,
  slowMs: 5000,
  unstableStd: 7.0,
  minCompleteMs: 1000,
  endpointRatio: 0.35,
  tempoIdealMs: 2400,
  /**
   * 行程不垂直：竖直方向运动能量占比 **低于** 该值即判为不垂直。
   * `verticalRatio = var(a_vert) / (var(a_vert) + var(a_horiz))`。
   *
   * 由 25 条标注数据初步标定：标准动作中位 0.380、标了不垂直的 3 条中位 0.190
   * → 取两组中点 0.28（原值 0.6 会把全部 25 条都判成不垂直）。
   * 正例仅 3 个，数据补齐后需重标。
   */
  verticalRatio: 0.28,
  /**
   * 手腕外翻：绕重力轴转动占转动路径的比例。
   *
   * **方向与最初假设相反**：标准动作中位 0.560、标了外翻的 2 条中位 0.349
   * ——外翻时该值**下降**。比较由 `>` 改为 `<` 后，全量一致率 4% → 44%，
   * WRIST_FLIP 的 F1 由 0 → 0.80。取两组中点 0.45。
   * 正例仅 2 个，高度不确认，补数据后必须重估，可能还需换特征。
   */
  twistRatio: 0.45,
} as const

const ERROR_META: Record<ErrorCode, { severity: Severity; confidence: number; phase: Phase | null }> = {
  INSUFFICIENT_RANGE: { severity: 'medium', confidence: 0.9, phase: 'top' },
  NOT_VERTICAL: { severity: 'low', confidence: 0.8, phase: 'lifting' },
  WRIST_FLIP: { severity: 'low', confidence: 0.8, phase: 'lifting' },
}

/** 各错误码的固定严重程度（依据《当前错误分类标准》8.3 节，不得随意修改） */
export const ERROR_SEVERITY: Record<string, Severity> = {
  INSUFFICIENT_RANGE: 'medium',
  NOT_VERTICAL: 'low',
  WRIST_FLIP: 'low',
}

/** 高风险错误：命中后总分强制不高于 45，且教练建议强制降载 */
export const HIGH_RISK_CODES: ErrorCode[] = []

/**
 * **扣分表**：每类错误命中一次扣多少分（扣分制评分的唯一依据）。
 *
 * 取值按严重度分档：high 最重、medium 次之、low 最轻。
 * 注意：
 *  - 同一次动作里同一类错误只存在一条（错误码是集合语义），所以这里扣的是"每类"；
 *  - 高风险码另有 45 分封顶，扣分值不必大到破坏可读性；
 *  - 五类全部命中合计扣 88 分，仍保留 12 分余地，不会直接归零。
 */
export const ERROR_DEDUCTION: Record<string, number> = {
  INSUFFICIENT_RANGE: 25,
  NOT_VERTICAL: 10,
  WRIST_FLIP: 15,
}

/**
 * 结束点角速度阈值 = min_peak × 0.35，**四舍五入到 1 位小数**。
 *
 * 为什么要取整：浮点下 `38 * 0.35 === 13.299999999999999`，会让"恰好等于阈值"
 * （标准规定为**严格大于**才命中）被误判命中。标准文档里写的就是 13.3 / 11.9，
 * 取整后与文档一致、边界行为也可预测。
 * 注：Python 后端用的是 `endpoint > min_peak * 0.35`，存在同样的浮点边界问题。
 */
export function endpointThresholdFor(minPeak: number): number {
  return Math.round(minPeak * THRESHOLDS.endpointRatio * 10) / 10
}

function std(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
  return Math.sqrt(v)
}

/** 主轴稳定性残差：主轴波形 - 同长度正弦参考波形(×峰峰值一半)，取残差标准差 */
function stabilityStd(mainAxis: number[]): number {
  const n = mainAxis.length
  if (n < 2) return 0
  let max = -Infinity
  let min = Infinity
  for (const v of mainAxis) {
    if (v > max) max = v
    if (v < min) min = v
  }
  const amp = (max - min) / 2
  const residual = mainAxis.map((v, i) => v - amp * Math.sin((2 * Math.PI * i) / (n - 1)))
  return std(residual)
}

/**
 * 计算「竖直能量占比」与「手腕外翻占比」。
 *
 * - 竖直占比：把加速度按估出的重力方向分解，`var(a_vert)` 占 `var(a_vert)+var(a_horiz)` 的比例。
 *   标准推举几乎全是竖直运动 → 接近 1；横向甩动会显著下降。
 * - 外翻占比：`Σ|ω·ĝ| / Σ|ω|`，即绕重力轴的转动占转动路径的比例。
 *   哑铃被手腕拧动时升高。
 *
 * 重力方向用一阶低通估计（τ≈1s，与 repCounter 里同一套做法），
 * 只用到加速度与角速度，不依赖固件姿态解算。
 */
function verticalAndTwist(samples: SensorSample[]): { verticalRatio: number; twistRatio: number } {
  let g: { x: number; y: number; z: number } | null = null
  let vEnergy = 0
  let hEnergy = 0
  let twistPath = 0
  let totalPath = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const a = { x: s.ax, y: s.ay, z: s.az }
    if (!g) g = { ...a }
    else {
      const dt = i > 0 ? Math.max(1e-3, (s.t - samples[i - 1].t) / 1000) : 0.02
      const k = 1 - Math.exp(-dt / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    const ux = g.x / gm
    const uy = g.y / gm
    const uz = g.z / gm
    const along = a.x * ux + a.y * uy + a.z * uz
    const aMag2 = a.x * a.x + a.y * a.y + a.z * a.z
    const horiz2 = Math.max(0, aMag2 - along * along)
    vEnergy += (along - 1) * (along - 1)
    hEnergy += horiz2
    const wmag = Math.hypot(s.gx, s.gy, s.gz)
    twistPath += Math.abs(s.gx * ux + s.gy * uy + s.gz * uz)
    totalPath += wmag
  }
  const denom = vEnergy + hEnergy
  return {
    verticalRatio: denom > 0 ? vEnergy / denom : 1,
    twistRatio: totalPath > 0 ? twistPath / totalPath : 0,
  }
}

export function classifyMotion(samples: SensorSample[], actionId: number): RuleResult {
  const signalQuality = assessQuality(samples)
  const rule = ACTION_RULES[actionId] ?? { axis: 'gy' as const, minPeak: 38, name: 'unknown' }

  // 信号不可用：按标准 §6.3，不输出任何动作错误，各项评分归零，阶段 unknown
  if (!signalQuality.isUsable) {
    const zero: RuleScore = { rangeOfMotion: 0, tempo: 0, stability: 0, consistency: 0, overall: 0 }
    return {
      signalQuality,
      standard: false,
      errors: [],
      features: {
        durationMs: 0,
        peakAngularVelocity: 0,
        stabilityStd: 0,
        energy: 0,
        topDurationMs: 0,
        endpointAngularVelocity: 0,
      },
      score: zero,
      phases: [],
    }
  }

  const axis = samples.map((s) => s[rule.axis])
  const durationMs = samples[samples.length - 1].t - samples[0].t
  const peak = axis.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const endpoint = Math.abs(axis[axis.length - 1])
  const stab = stabilityStd(axis)
  const energy = axis.reduce((a, v) => a + v * v, 0) / axis.length
  const topDurationMs = durationMs * 0.1

  // ---- 竖直能量占比 与 手腕外翻占比 ----
  // 竖直：把加速度按重力方向分解，取"沿重力方向的动态能量"占全部动态能量的比例；
  //       标准推举几乎全是竖直运动，占比接近 1；横着甩会明显下降。
  // 外翻：绕重力轴的转动量占转动路径的比例；哑铃被手腕拧动时该值升高。
  const { verticalRatio, twistRatio } = verticalAndTwist(samples)

  const codes: ErrorCode[] = []
  // ① 行程不足：主轴峰值低于该动作的 min_peak
  if (peak < rule.minPeak) codes.push('INSUFFICIENT_RANGE')
  // ② 行程不垂直：竖直方向的运动能量占比过低
  if (verticalRatio < THRESHOLDS.verticalRatio) codes.push('NOT_VERTICAL')
  // ③ 手腕外翻：绕重力轴的转动占比 **低于** 门槛（方向与直觉相反，见 THRESHOLDS.twistRatio 注释）
  if (twistRatio < THRESHOLDS.twistRatio) codes.push('WRIST_FLIP')

  const hasHigh = codes.some((c) => ERROR_META[c].severity === 'high')
  // 四个维度分**保留为诊断信息**（报告里仍展示，便于解释分数构成），
  // 但不再参与总分计算——总分改为下面的扣分制。
  const rangeOfMotion = Math.min(100, (peak / rule.minPeak) * 85)
  const tempo =
    durationMs >= THRESHOLDS.fastMs && durationMs <= THRESHOLDS.slowMs
      ? 100
      : Math.max(0, 100 - Math.abs(durationMs - THRESHOLDS.tempoIdealMs) / 30)
  const stability = Math.max(0, 100 - stab * 5)
  const consistency = Math.max(0, 100 - codes.length * 15)

  // ================= 扣分制总分 =================
  // 从 100 分起扣，每命中一类错误按其固定扣分扣除，下限 0。
  // 相比原来的「四维加权」，扣分制的好处是**可解释**：
  // 用户能直接看到"因为行程不足扣了 15 分"，而不是一个加权出来的抽象数字。
  const deductions = codes.map((code) => ({
    code,
    points: ERROR_DEDUCTION[code] ?? 0,
  }))
  const totalDeduction = deductions.reduce((a, d) => a + d.points, 0)
  let overall = Math.max(0, 100 - totalDeduction)
  if (hasHigh) overall = Math.min(overall, 45)

  return {
    signalQuality,
    standard: codes.length === 0,
    errors: codes.map((code) => ({
      code,
      ...ERROR_META[code],
      // 自动结果的时间区间当前覆盖整个动作区间（标准 §9 约束 1）
      startMs: 0,
      endMs: Math.max(0, durationMs),
      source: 'rule' as const,
    })),
    features: {
      durationMs,
      peakAngularVelocity: peak,
      stabilityStd: stab,
      energy,
      topDurationMs,
      endpointAngularVelocity: endpoint,
    },
    score: { rangeOfMotion, tempo, stability, consistency, overall: Math.round(overall * 100) / 100, deductions },
    phases: phaseRanges(durationMs),
  }
}
