import { classifyMotion, type RuleResult } from './ruleClassifier'
import {
  phaseRanges,
  toApiSample,
  type ErrorCode,
  type Phase,
  type SensorPosition,
  type Severity,
  type SensorSample,
} from './contract'
import { analyzeMotion, MotionAiUnavailable, type DetectedError, type MotionAnalysisResult, type ScoreResult, type SignalQualityResult } from '../api/motionAi'

/**
 * 整组分析：把一次训练里识别出的每一次重复，逐次交给分析器，再汇总成本组报告。
 *
 * 后端（Python `/api/v1/motion/analyze`）可用时用后端；不可用则回退到本地规则分析器
 * （阈值与评分公式与后端逐项一致，见 ruleClassifier.ts）。每条结果都标明来源，
 * 便于判断当前看到的是后端结果还是本地回退结果。
 *
 * 硬性约束：信号质量不可用的那一次**不产生动作错误**（后端同样如此），
 * 只计入"不可用"，不参与错误统计。
 */

export interface RepAnalysis {
  index: number
  sampleCount: number
  durationMs: number
  usable: boolean
  errors: DetectedError[]
  score: ScoreResult
  signalQuality: SignalQualityResult
  phases: { name: Phase; startMs: number; endMs: number }[]
  source: 'backend' | 'local'
}

export interface ErrorStat {
  code: ErrorCode
  count: number
  severity: Severity
  phase: Phase | null
}

export interface SetAnalysis {
  actionId: number
  actionName: string
  totalReps: number
  usableReps: number
  avgScore: ScoreResult
  errors: ErrorStat[]
  signalIssues: { issue: string; count: number }[]
  hasHighRisk: boolean
  reps: RepAnalysis[]
  backendUsed: boolean
  backendError: string | null
}

const EMPTY_SCORE: ScoreResult = { overall: 0, rangeOfMotion: 0, tempo: 0, stability: 0, consistency: 0 }

/** 把本地规则结果归一化成与后端一致的形状 */
function fromLocal(samples: SensorSample[], actionId: number): RepAnalysis {
  const r: RuleResult = classifyMotion(samples, actionId)
  const durationMs = samples.length ? samples[samples.length - 1].t - samples[0].t : 0
  return {
    index: 0,
    sampleCount: samples.length,
    durationMs,
    usable: r.signalQuality.isUsable,
    errors: r.errors.map((e) => ({
      code: e.code,
      severity: e.severity,
      confidence: e.confidence,
      startMs: e.startMs,
      endMs: e.endMs,
      phase: e.phase,
      source: e.source,
    })),
    score: r.score,
    signalQuality: r.signalQuality,
    phases: r.phases,
    source: 'local',
  }
}

/** 把后端结果归一化成同一形状 */
function fromBackend(r: MotionAnalysisResult): RepAnalysis {
  const durationMs = r.features?.durationMs ?? 0
  return {
    index: 0,
    sampleCount: 0,
    durationMs,
    usable: r.signalQuality.isUsable,
    errors: r.errors,
    score: r.score,
    signalQuality: r.signalQuality,
    phases: durationMs > 0 ? phaseRanges(durationMs) : [],
    source: 'backend',
  }
}

function mean(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
}

export interface AnalyzeSetOptions {
  actionId: number
  actionName: string
  sensorPosition: SensorPosition
  sessionId: string
  baseUrl?: string
  /** 逐次分析的回调，用于显示进度 */
  onProgress?: (done: number, total: number) => void
}

/**
 * 逐次分析并汇总。返回 null 表示本组没有任何可分析的重复
 * （样本少于 32 点的会被跳过——后端契约要求至少 32 点）。
 */
export async function analyzeSet(
  reps: { index: number; samples: SensorSample[] }[],
  opts: AnalyzeSetOptions,
): Promise<SetAnalysis | null> {
  const analyzable = reps.filter((r) => r.samples.length >= 32)
  if (!analyzable.length) return null

  const baseUrl = (opts.baseUrl ?? '').trim()
  let backendError: string | null = null
  let backendUsed = false
  const out: RepAnalysis[] = []

  for (let i = 0; i < analyzable.length; i++) {
    const rep = analyzable[i]
    let analysis: RepAnalysis | null = null
    if (baseUrl) {
      try {
        const res = await analyzeMotion(baseUrl, {
          sessionId: opts.sessionId,
          actionId: opts.actionId,
          sensorPosition: opts.sensorPosition,
          samples: rep.samples.map(toApiSample),
        })
        analysis = fromBackend(res)
        backendUsed = true
      } catch (e) {
        // 后端不可用：记录原因，回退本地规则分析（阈值与后端一致）
        backendError = e instanceof MotionAiUnavailable ? e.message : String(e)
      }
    }
    if (!analysis) analysis = fromLocal(rep.samples, opts.actionId)
    analysis.index = rep.index
    out.push(analysis)
    opts.onProgress?.(i + 1, analyzable.length)
  }

  const usable = out.filter((r) => r.usable)
  const errorMap = new Map<ErrorCode, ErrorStat>()
  const issueMap = new Map<string, number>()
  for (const r of out) {
    for (const issue of r.signalQuality.issues) issueMap.set(issue, (issueMap.get(issue) ?? 0) + 1)
  }
  for (const r of usable) {
    for (const e of r.errors) {
      const cur = errorMap.get(e.code)
      if (cur) cur.count++
      else errorMap.set(e.code, { code: e.code, count: 1, severity: e.severity, phase: e.phase })
    }
  }

  return {
    actionId: opts.actionId,
    actionName: opts.actionName,
    totalReps: out.length,
    usableReps: usable.length,
    avgScore: {
      overall: mean(usable.map((r) => r.score.overall)),
      rangeOfMotion: mean(usable.map((r) => r.score.rangeOfMotion)),
      tempo: mean(usable.map((r) => r.score.tempo)),
      stability: mean(usable.map((r) => r.score.stability)),
      consistency: mean(usable.map((r) => r.score.consistency)),
    },
    errors: [...errorMap.values()].sort((a, b) => b.count - a.count),
    signalIssues: [...issueMap.entries()].map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count),
    hasHighRisk: usable.some((r) => r.errors.some((e) => e.severity === 'high')),
    reps: out,
    backendUsed,
    backendError,
  }
}

/** 空白的整组结果，供无数据时占位 */
export function emptySetAnalysis(actionId: number, actionName: string): SetAnalysis {
  return {
    actionId,
    actionName,
    totalReps: 0,
    usableReps: 0,
    avgScore: EMPTY_SCORE,
    errors: [],
    signalIssues: [],
    hasHighRisk: false,
    reps: [],
    backendUsed: false,
    backendError: null,
  }
}
