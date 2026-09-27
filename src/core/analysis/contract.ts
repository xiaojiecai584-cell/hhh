/**
 * 与 Python 后端 `motion_ai` 的数据契约对齐层。
 *
 * 后端定义见工程包：
 *   src/motion_ai/schemas/__init__.py    —— Pydantic 数据契约
 *   src/motion_ai/preprocessing/__init__.py —— 信号质量检查
 *   src/motion_ai/actions/base.py        —— 动作阈值与五阶段
 *   当前错误分类标准.md                   —— 错误定义、评分、标注规范
 *
 * 这里只做三件事：
 *  1. 网站内部样本结构（`t`）与后端七列（`timestamp,ax,ay,az,gx,gy,gz`）的互转；
 *  2. 完整实现后端的信号质量检查（此前网站只做布尔检查，且缺 packet_gap）；
 *  3. 后端只支持上臂佩戴且区分左右，这里给出对齐后的枚举。
 */

/** 网站内部样本：七列同后端，仅把 `timestamp` 简写为 `t` */
export interface SensorSample {
  t: number // 毫秒时间戳
  ax: number // g
  ay: number // g
  az: number // g
  gx: number // °/s
  gy: number // °/s
  gz: number // °/s
}


// ---------- 枚举（与后端 ErrorCode/Severity/Phase/Quality 一一对应） ----------

export type ErrorCode =
  | 'INSUFFICIENT_RANGE'
  | 'TEMPO_TOO_FAST'
  | 'TEMPO_TOO_SLOW'
  | 'UNSTABLE_MOTION'
  | 'INCOMPLETE_REPETITION'

export type Severity = 'low' | 'medium' | 'high'
export type Phase = 'ready' | 'lifting' | 'top' | 'lowering' | 'complete' | 'unknown'
export type Quality = 'correct' | 'incorrect' | 'unknown'

export const PHASES: Phase[] = ['ready', 'lifting', 'top', 'lowering', 'complete']

/** 后端 actions/base.py 的 bounds；五阶段的相对区间（预标注基线，非峰谷识别结果） */
const PHASE_BOUNDS = [0, 0.12, 0.46, 0.58, 0.9, 1]

export interface PhaseRange {
  name: Phase
  startMs: number
  endMs: number
}

/** 按动作总时长比例生成五阶段区间（与后端 ActionPlugin.phases 完全一致） */
export function phaseRanges(durationMs: number): PhaseRange[] {
  return PHASES.map((name, i) => ({
    name,
    startMs: Math.round(durationMs * PHASE_BOUNDS[i]),
    endMs: Math.round(durationMs * PHASE_BOUNDS[i + 1]),
  }))
}

// ---------- 信号质量（与后端 assess_quality 逐条对齐） ----------

export interface SignalQualityResult {
  score: number // 0..1，每个问题扣 0.25
  isUsable: boolean
  issues: string[]
}

export const SIGNAL_CHANNELS = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'] as const
export const MIN_SAMPLES = 32
/** 绝对值超过它视为传感器饱和 */
export const SATURATION_LIMIT = 2000

/**
 * 信号质量检查。问题清单与后端一致：
 * insufficient_samples / non_finite_values / non_increasing_timestamps / packet_gap / saturation
 * 任何一项命中即 isUsable=false —— 此时后端**不输出五类动作错误**、各项评分归零、
 * 阶段为 unknown、指导降级为"重新佩戴并重新采集"。
 */
export function assessQuality(samples: SensorSample[]): SignalQualityResult {
  const issues: string[] = []
  if (samples.length < MIN_SAMPLES) issues.push('insufficient_samples')

  let nonFinite = false
  let saturated = false
  for (const s of samples) {
    for (const ch of SIGNAL_CHANNELS) {
      const v = s[ch]
      if (!Number.isFinite(v)) nonFinite = true
      else if (Math.abs(v) > SATURATION_LIMIT) saturated = true
    }
  }
  if (nonFinite) issues.push('non_finite_values')
  if (saturated) issues.push('saturation')

  const dt: number[] = []
  for (let i = 1; i < samples.length; i++) dt.push(samples[i].t - samples[i - 1].t)
  if (dt.some((d) => d <= 0)) issues.push('non_increasing_timestamps')

  if (dt.length > 0) {
    const sorted = [...dt].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    if (median > 0 && Math.max(...dt) > 3 * median) issues.push('packet_gap')
  }

  return {
    score: Math.max(0, 1 - 0.25 * issues.length),
    isUsable: issues.length === 0,
    issues,
  }
}

export const SIGNAL_ISSUE_LABEL: Record<string, string> = {
  missing_channels: '缺少通道',
  insufficient_samples: '采样点不足（需 ≥32）',
  non_finite_values: '存在非法数值',
  non_increasing_timestamps: '时间戳非严格递增',
  packet_gap: '存在明显丢包',
  saturation: '传感器饱和',
}

// ---------- 对外样本格式（后端 SensorSample：七列，字段名为 timestamp） ----------

export interface ApiSensorSample {
  timestamp: number
  ax: number
  ay: number
  az: number
  gx: number
  gy: number
  gz: number
}

/** 网站内部样本 → 后端接口样本。仅字段名不同（t → timestamp）。 */
export function toApiSample(s: SensorSample): ApiSensorSample {
  return { timestamp: s.t, ax: s.ax, ay: s.ay, az: s.az, gx: s.gx, gy: s.gy, gz: s.gz }
}

/** 后端样本 → 网站内部样本（录进来的历史数据可能是七列格式） */
export function fromApiSample(s: ApiSensorSample): SensorSample {
  return { t: s.timestamp, ax: s.ax, ay: s.ay, az: s.az, gx: s.gx, gy: s.gy, gz: s.gz }
}

// ---------- 佩戴位置（后端只支持上臂，且区分左右） ----------

export type SensorPosition = 'right_upper_arm' | 'left_upper_arm'

export const SENSOR_POSITION_LABEL: Record<SensorPosition, string> = {
  right_upper_arm: '右上臂',
  left_upper_arm: '左上臂',
}

export const SENSOR_POSITIONS: SensorPosition[] = ['right_upper_arm', 'left_upper_arm']

// ---------- 标注记录（后端 DatasetLabel） ----------

export interface ErrorAnnotation {
  code: ErrorCode
  severity: Severity
  startMs: number
  endMs: number
}

/**
 * 采集上传用的标注块。后端 `json_importer` 的关键行为：
 *  - 先读 `label.standard`（布尔），再读 `annotations` 推断 quality；
 *  - 若 `label.standard` 缺失，则「无错误」的样本会落成 `unknown` 而不是 `correct`
 *    —— 之前网站只传 annotations，导致手工标的「标准」样本全部被记成 unknown；
 *  - `labelSource` / `isWeakLabel` 由后端按「是否有错误」硬编码，
 *    所以网站必须显式说明这是人工标注，否则会被当成规则弱标签。
 */
export interface DatasetLabel {
  quality: Quality
  standard: boolean
  errors: ErrorAnnotation[]
  labelSource: 'human' | 'rule_engine' | 'unknown'
  isWeakLabel: boolean
}

export interface SensorMetadata {
  position: SensorPosition | 'unknown'
  samplingRate: number
  channels: string[]
}

/** 采样率：由时间戳中位间隔推算（后端固定按 50Hz 重采样，这里如实上报原始值） */
export function estimateSamplingRate(samples: SensorSample[]): number {
  if (samples.length < 2) return 0
  const dt: number[] = []
  for (let i = 1; i < samples.length; i++) dt.push(samples[i].t - samples[i - 1].t)
  const sorted = [...dt].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (!(median > 0)) return 0
  return Math.round((1000 / median) * 10) / 10
}
