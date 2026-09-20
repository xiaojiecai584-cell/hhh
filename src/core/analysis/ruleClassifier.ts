// 规则分类器：依据《当前错误分类标准.md》实现 5 类动作错误的规则判定 + 评分。
// 输入：单个动作的主轴时序数据（7 列：timestamp, ax, ay, az, gx, gy, gz）+ actionId。
// 输出：是否可用、是否标准、命中的错误码列表、特征值与分项/总分。

export interface SensorSample {
  t: number // 毫秒时间戳
  ax: number // g
  ay: number // g
  az: number // g
  gx: number // °/s
  gy: number // °/s
  gz: number // °/s
}

export type ErrorCode =
  | 'INSUFFICIENT_RANGE'
  | 'TEMPO_TOO_FAST'
  | 'TEMPO_TOO_SLOW'
  | 'UNSTABLE_MOTION'
  | 'INCOMPLETE_REPETITION'

export interface RuleError {
  code: ErrorCode
  severity: 'low' | 'medium' | 'high'
  confidence: number
  phase: string | null
  source: 'rule'
}

export interface RuleFeatures {
  durationMs: number
  peakAngularVelocity: number
  stabilityStd: number
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
  available: boolean // 信号是否通过质量检查
  standard: boolean // 是否标准（无任何错误）
  errors: RuleError[]
  features: RuleFeatures | null
  score: RuleScore | null
}

/** 各动作的主分析轴与最小峰值阈值（min_peak，°/s） */
const ACTION_RULES: Record<number, { axis: 'gx' | 'gy' | 'gz'; minPeak: number }> = {
  1: { axis: 'gy', minPeak: 38 }, // 坐姿推举
  2: { axis: 'gx', minPeak: 34 }, // 站姿侧平举
}

const ERROR_META: Record<ErrorCode, { severity: RuleError['severity']; confidence: number; phase: string | null }> = {
  INSUFFICIENT_RANGE: { severity: 'medium', confidence: 0.9, phase: 'top' },
  TEMPO_TOO_FAST: { severity: 'medium', confidence: 0.9, phase: 'lifting' },
  TEMPO_TOO_SLOW: { severity: 'low', confidence: 0.85, phase: 'lifting' },
  UNSTABLE_MOTION: { severity: 'medium', confidence: 0.85, phase: 'lifting' },
  INCOMPLETE_REPETITION: { severity: 'high', confidence: 0.95, phase: null },
}

function std(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
  return Math.sqrt(v)
}

/** 信号质量检查：≥32 点、时间戳严格递增、无非有限值、无饱和（|值|≥2000） */
function checkSignal(samples: SensorSample[]): boolean {
  if (samples.length < 32) return false
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (i > 0 && s.t <= samples[i - 1].t) return false
    for (const v of [s.ax, s.ay, s.az, s.gx, s.gy, s.gz]) {
      if (!Number.isFinite(v)) return false
      if (Math.abs(v) >= 2000) return false
    }
  }
  return true
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
  if (!checkSignal(samples)) {
    return { available: false, standard: false, errors: [], features: null, score: null }
  }

  const rule = ACTION_RULES[actionId] ?? { axis: 'gy' as const, minPeak: 38 }
  const axis = samples.map((s) => s[rule.axis])
  const durationMs = samples[samples.length - 1].t - samples[0].t
  const peak = axis.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const endpoint = Math.abs(axis[axis.length - 1])
  const stab = stabilityStd(axis)

  const errors: ErrorCode[] = []
  if (peak < rule.minPeak) errors.push('INSUFFICIENT_RANGE')
  if (durationMs < 1000) errors.push('TEMPO_TOO_FAST')
  if (durationMs > 5000) errors.push('TEMPO_TOO_SLOW')
  if (stab > 7.0) errors.push('UNSTABLE_MOTION')
  if (durationMs < 1000 || endpoint > rule.minPeak * 0.35) errors.push('INCOMPLETE_REPETITION')

  const hasHigh = errors.some((c) => ERROR_META[c].severity === 'high')
  const rangeOfMotion = Math.min(100, (peak / rule.minPeak) * 85)
  const tempo = durationMs >= 1000 && durationMs <= 5000 ? 100 : Math.max(0, 100 - Math.abs(durationMs - 2400) / 30)
  const stability = Math.max(0, 100 - stab * 5)
  const consistency = Math.max(0, 100 - errors.length * 15)
  let overall = rangeOfMotion * 0.35 + tempo * 0.25 + stability * 0.25 + consistency * 0.15
  if (hasHigh) overall = Math.min(overall, 45)

  return {
    available: true,
    standard: errors.length === 0,
    errors: errors.map((code) => ({ code, ...ERROR_META[code], source: 'rule' as const })),
    features: { durationMs, peakAngularVelocity: peak, stabilityStd: stab, endpointAngularVelocity: endpoint },
    score: { rangeOfMotion, tempo, stability, consistency, overall },
  }
}
