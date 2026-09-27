import type {
  ErrorCode,
  Phase,
  Quality,
  SensorPosition,
  Severity,
} from '../analysis/contract'
import type { ApiSensorSample } from '../analysis/contract'

/**
 * Python 后端（fitness_motion_ai / FastAPI）客户端。
 *
 * 端点（见工程包 项目指导.md §9）：
 *   GET  /api/v1/actions
 *   POST /api/v1/motion/analyze      —— 一次动作（一次重复）的分析
 *   POST /api/v1/coach/advice        —— 大模型指导
 *
 * 契约见工程包 src/motion_ai/schemas/__init__.py。
 *
 * 两条硬性约束（前端必须遵守）：
 *  1. **以规则的 `errors` 为最终错误展示依据**；`model.conflicts` 是小模型提出但规则
 *     未确认的候选，**不得当作已确认错误展示**。
 *  2. `signalQuality.isUsable === false` 时后端不输出五类动作错误、评分全 0、
 *     阶段为 unknown，前端应提示重新佩戴 / 重新采集，而不是显示"动作有问题"。
 */

export interface MotionAnalysisRequest {
  sessionId: string
  actionId: number
  sensorPosition: SensorPosition
  samples: ApiSensorSample[] // 至少 32 条，时间戳严格递增
}

export interface DetectedError {
  code: ErrorCode
  severity: Severity
  confidence: number
  startMs: number
  endMs: number
  phase: Phase | null
  source: string
}

export interface ScoreResult {
  overall: number
  rangeOfMotion: number
  tempo: number
  stability: number
  consistency: number
}

export interface SignalQualityResult {
  score: number
  isUsable: boolean
  issues: string[]
}

export interface ModelInfo {
  analyzerType: string
  name: string
  version: string
  featureModelStatus?: string | null
  featureModelProbabilities: Record<string, number>
  featureModelCandidates: ErrorCode[]
  decisionPolicy?: string | null
  /** 小模型提出但规则未确认的候选错误：只能作为线索，不能当结论 */
  conflicts: ErrorCode[]
}

export interface MotionAnalysisResult {
  requestId: string
  sessionId: string
  action: { id: number; name: string; confidence: number }
  state: { phase: Phase; repCount: number; isStarted: boolean; isComplete: boolean }
  score: ScoreResult
  errors: DetectedError[]
  signalQuality: SignalQualityResult
  features: Record<string, number>
  model: ModelInfo
}

export interface CoachSuggestion {
  priority: string
  text: string
  relatedErrorCode: ErrorCode | null
}

export interface CoachAdviceResult {
  summary: string
  suggestions: CoachSuggestion[]
  riskLevel: 'low' | 'medium' | 'high'
  shouldStop: boolean
  loadRecommendation: 'increase' | 'maintain' | 'decrease'
  confidence: number
  source: string
}

export interface ActionInfo {
  id: number
  name: string
  displayName: string
  phases: Phase[]
  errorCodes: ErrorCode[]
  sensorPositions: string[]
  modelVersion: string
}

/** 后端不可用（未配置 / 网络失败 / 校验失败）时抛出，调用方据此回退本地规则分析 */
export class MotionAiUnavailable extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'MotionAiUnavailable'
  }
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function post<T>(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!baseUrl) throw new MotionAiUnavailable('未配置后端地址')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${trimBase(baseUrl)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* 非 JSON：当作不可用 */
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error
      throw new MotionAiUnavailable(err?.message ?? `后端返回 ${res.status}`, res.status, err?.code)
    }
    if (!data) throw new MotionAiUnavailable('后端返回内容无法解析')
    return data as T
  } catch (e) {
    if (e instanceof MotionAiUnavailable) throw e
    throw new MotionAiUnavailable(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** 分析一次动作（一次重复）。samples 至少 32 条且时间戳严格递增。 */
export function analyzeMotion(
  baseUrl: string,
  req: MotionAnalysisRequest,
  timeoutMs = 8000,
): Promise<MotionAnalysisResult> {
  return post<MotionAnalysisResult>(baseUrl, '/api/v1/motion/analyze', req, timeoutMs)
}

/** 请求大模型指导。分析结果原样透传，后端负责提示词与安全覆盖。 */
export function coachAdvice(
  baseUrl: string,
  analysis: MotionAnalysisResult,
  opts: { requestType?: string; question?: string; userContext?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<CoachAdviceResult> {
  const { requestType = 'single_rep_advice', question, userContext, timeoutMs = 20000 } = opts
  return post<CoachAdviceResult>(
    baseUrl,
    '/api/v1/coach/advice',
    { requestType, analysis, userContext: userContext ?? null, question: question ?? null },
    timeoutMs,
  )
}

export async function listActions(baseUrl: string, timeoutMs = 6000): Promise<ActionInfo[]> {
  if (!baseUrl) throw new MotionAiUnavailable('未配置后端地址')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${trimBase(baseUrl)}/api/v1/actions`, { signal: ctrl.signal })
    if (!res.ok) throw new MotionAiUnavailable(`后端返回 ${res.status}`, res.status)
    const data = (await res.json()) as { actions?: ActionInfo[] }
    return data.actions ?? []
  } catch (e) {
    if (e instanceof MotionAiUnavailable) throw e
    throw new MotionAiUnavailable(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 高风险安全覆盖（标准 §5.5）：命中 `INCOMPLETE_REPETITION` 时，
 * `riskLevel` 强制 high、`shouldStop` 强制 true、`loadRecommendation` 强制 decrease。
 * 后端已做，这里在前端再兜一层——指导内容绝不能因为后端没配好而变宽松。
 */
export function applySafetyOverride(advice: CoachAdviceResult, analysis: MotionAnalysisResult): CoachAdviceResult {
  const highRisk = analysis.errors.some((e) => e.severity === 'high')
  if (!highRisk) return advice
  return { ...advice, riskLevel: 'high', shouldStop: true, loadRecommendation: 'decrease' }
}

/** 标注质量：人工标了 standard 才是 correct；未标注一律 unknown */
export function qualityOf(standard: boolean | null): Quality {
  if (standard === true) return 'correct'
  if (standard === false) return 'incorrect'
  return 'unknown'
}
