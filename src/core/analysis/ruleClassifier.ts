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
  fastMs: 1000, // durationMs < 1000 → TEMPO_TOO_FAST
  slowMs: 5000, // durationMs > 5000 → TEMPO_TOO_SLOW
  unstableStd: 7.0, // stabilityStd > 7.0 → UNSTABLE_MOTION
  minCompleteMs: 1000, // durationMs < 1000 → 未完整完成
  endpointRatio: 0.35, // endpoint > min_peak × 0.35 → 未完整完成
  tempoIdealMs: 2400,
} as const

const ERROR_META: Record<ErrorCode, { severity: Severity; confidence: number; phase: Phase | null }> = {
  INSUFFICIENT_RANGE: { severity: 'medium', confidence: 0.9, phase: 'top' },
  TEMPO_TOO_FAST: { severity: 'medium', confidence: 0.9, phase: 'lifting' },
  TEMPO_TOO_SLOW: { severity: 'low', confidence: 0.85, phase: 'lifting' },
  UNSTABLE_MOTION: { severity: 'medium', confidence: 0.85, phase: 'lifting' },
  INCOMPLETE_REPETITION: { severity: 'high', confidence: 0.95, phase: null },
}

/** 各错误码的固定严重程度（依据《当前错误分类标准》8.3 节，不得随意修改） */
export const ERROR_SEVERITY: Record<string, Severity> = {
  INSUFFICIENT_RANGE: 'medium',
  TEMPO_TOO_FAST: 'medium',
  TEMPO_TOO_SLOW: 'low',
  UNSTABLE_MOTION: 'medium',
  INCOMPLETE_REPETITION: 'high',
}

/** 高风险错误：命中后总分强制不高于 45，且教练建议强制降载 */
export const HIGH_RISK_CODES: ErrorCode[] = ['INCOMPLETE_REPETITION']

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

  const endpointThreshold = endpointThresholdFor(rule.minPeak)
  const codes: ErrorCode[] = []
  if (peak < rule.minPeak) codes.push('INSUFFICIENT_RANGE')
  if (durationMs < THRESHOLDS.fastMs) codes.push('TEMPO_TOO_FAST')
  if (durationMs > THRESHOLDS.slowMs) codes.push('TEMPO_TOO_SLOW')
  if (stab > THRESHOLDS.unstableStd) codes.push('UNSTABLE_MOTION')
  if (durationMs < THRESHOLDS.minCompleteMs || endpoint > endpointThreshold) {
    codes.push('INCOMPLETE_REPETITION')
  }

  const hasHigh = codes.some((c) => ERROR_META[c].severity === 'high')
  const rangeOfMotion = Math.min(100, (peak / rule.minPeak) * 85)
  const tempo =
    durationMs >= THRESHOLDS.fastMs && durationMs <= THRESHOLDS.slowMs
      ? 100
      : Math.max(0, 100 - Math.abs(durationMs - THRESHOLDS.tempoIdealMs) / 30)
  const stability = Math.max(0, 100 - stab * 5)
  const consistency = Math.max(0, 100 - codes.length * 15)
  let overall = rangeOfMotion * 0.35 + tempo * 0.25 + stability * 0.25 + consistency * 0.15
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
    score: { rangeOfMotion, tempo, stability, consistency, overall: Math.round(overall * 100) / 100 },
    phases: phaseRanges(durationMs),
  }
}
