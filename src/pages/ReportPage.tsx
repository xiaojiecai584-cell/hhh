import { useEffect, useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { useDataStore } from '../store/useDataStore'
import { useReportStore } from '../store/useReportStore'
import { useSubjectStore } from '../store/useSubjectStore'
import { useApiConfigStore } from '../store/useApiConfigStore'
import { analyzeSet, type SetAnalysis } from '../core/analysis/setAnalysis'
import { SIGNAL_ISSUE_LABEL } from '../core/analysis/contract'
import { ERROR_SEVERITY } from '../core/analysis/ruleClassifier'
import { applySafetyOverride, coachAdvice, type CoachAdviceResult } from '../core/api/motionAi'
import type { AnalysisResult } from '../core/analysis/analyzer'
import { MOTION_TEMPLATES } from '../core/motion/templates'

const ERROR_LABEL: Record<string, string> = {
  INSUFFICIENT_RANGE: '行程不足',
  TEMPO_TOO_FAST: '动作过快',
  TEMPO_TOO_SLOW: '动作过慢',
  UNSTABLE_MOTION: '动作不稳定',
  INCOMPLETE_REPETITION: '未完整完成',
}
const PHASE_LABEL: Record<string, string> = {
  ready: '准备',
  lifting: '上举',
  top: '顶点',
  lowering: '下放',
  complete: '完成',
  unknown: '未知',
}

export default function ReportPage() {
  const repEvents = useBleStore((s) => s.repEvents)
  const currentActionId = useBleStore((s) => s.currentActionId)
  const { subjectId, sensorPosition } = useSubjectStore()
  const baseUrl = useApiConfigStore((s) => s.baseUrl)
  const analysisSaved = useReportStore((s) => s.analysis)
  const setAnalysisSaved = useReportStore((s) => s.setAnalysis)
  const reset = useReportStore((s) => s.reset)
  const saveSession = useDataStore((s) => s.saveSession)

  const [set, setSet] = useState<SetAnalysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [advice, setAdvice] = useState<CoachAdviceResult | null>(null)
  const [adviceErr, setAdviceErr] = useState<string | null>(null)
  const [savedTip, setSavedTip] = useState(false)

  const actionId = currentActionId ?? 1
  const actionName =
    MOTION_TEMPLATES.find((t) => t.actionId === actionId)?.name ?? `动作${actionId}`
  const reps = repEvents.map((r) => ({ index: r.index, samples: r.samples }))
  const analyzable = reps.filter((r) => r.samples.length >= 32).length

  const run = async () => {
    if (busy || analyzable === 0) return
    setBusy(true)
    setAdvice(null)
    setAdviceErr(null)
    try {
      const r = await analyzeSet(reps, {
        actionId,
        actionName,
        sensorPosition,
        sessionId: `session-${subjectId}-${actionId}`,
        baseUrl,
        onProgress: (d, t) => setProgress(`${d}/${t}`),
      })
      setSet(r)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  // 本组换动作/重新开始时清掉上一次的结果
  useEffect(() => {
    setSet(null)
    setAdvice(null)
  }, [currentActionId, repEvents.length === 0])

  const askCoach = async () => {
    if (!set || !baseUrl) return
    setAdviceErr(null)
    try {
      const first = set.reps.find((r) => r.usable)
      if (!first) return
      const a = await coachAdvice(baseUrl, {
        requestId: 'local',
        sessionId: `session-${subjectId}-${actionId}`,
        action: { id: actionId, name: actionName, confidence: 1 },
        state: { phase: 'complete', repCount: 1, isStarted: true, isComplete: true },
        score: first.score,
        errors: first.errors,
        signalQuality: first.signalQuality,
        features: {},
        model: {
          analyzerType: 'rule_based',
          name: actionName,
          version: '0.1.0',
          featureModelProbabilities: {},
          featureModelCandidates: [],
          conflicts: [],
        },
      })
      setAdvice(applySafetyOverride(a, {
        requestId: 'local',
        sessionId: '',
        action: { id: actionId, name: actionName, confidence: 1 },
        state: { phase: 'complete', repCount: 1, isStarted: true, isComplete: true },
        score: first.score,
        errors: first.errors,
        signalQuality: first.signalQuality,
        features: {},
        model: {
          analyzerType: 'rule_based',
          name: actionName,
          version: '0.1.0',
          featureModelProbabilities: {},
          featureModelCandidates: [],
          conflicts: [],
        },
      }))
    } catch (e) {
      setAdviceErr(e instanceof Error ? e.message : String(e))
    }
  }

  const saveToHistory = () => {
    if (!set) return
    const a: AnalysisResult = {
      score: Math.round(set.avgScore.overall),
      summary: `本组 ${set.totalReps} 次，可用 ${set.usableReps} 次，平均 ${set.avgScore.overall} 分`,
      advice: set.errors.map((e) => `${ERROR_LABEL[e.code] ?? e.code} ${e.count} 次`),
      anomalies: set.errors.map((e) => ({ label: ERROR_LABEL[e.code] ?? e.code, detail: `${e.count} 次` })),
    }
    setAnalysisSaved(a)
    saveSession({
      id: `s-${Date.now()}`,
      startedAt: Date.now(),
      actionId,
      actionName,
      set,
      analysis: a,
    })
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 2500)
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <h3 className="card__title">本组分析</h3>
          <span className="chip">{actionName}</span>
        </div>
        <p className="card__desc" style={{ marginTop: 8 }}>
          已识别 <b>{repEvents.length}</b> 次，其中 {analyzable} 次样本足够分析（每次需 ≥32 点）。
          {baseUrl ? `分析后端：${baseUrl}` : '未配置分析后端，使用本地规则分析器（阈值与后端一致）。'}
        </p>
        <div className="btn-grid" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => void run()} disabled={busy || analyzable === 0}>
            {busy ? `分析中 ${progress}` : '分析本组'}
          </button>
          {baseUrl && set && (
            <button className="btn btn--ghost" onClick={() => void askCoach()}>
              请求 AI 指导
            </button>
          )}
        </div>
        {analyzable === 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            还没有可分析的重复。到「训练」页开始一组，计数会自动记录每一次的原始样本。
          </div>
        )}
      </div>

      {set && (
        <>
          <div className="card">
            <div className="row">
              <h3 className="card__title">评分</h3>
              <span className="chip">
                {set.backendUsed ? '后端分析' : '本地规则'}
              </span>
            </div>
            {set.backendError && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                后端不可用（{set.backendError}），已回退本地分析。
              </div>
            )}
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat">
                <div className="stat__value">{set.avgScore.overall.toFixed(0)}</div>
                <div className="stat__label">总分</div>
              </div>
              <div className="stat">
                <div className="stat__value">{set.avgScore.rangeOfMotion.toFixed(0)}</div>
                <div className="stat__label">行程</div>
              </div>
              <div className="stat">
                <div className="stat__value">{set.avgScore.tempo.toFixed(0)}</div>
                <div className="stat__label">节奏</div>
              </div>
              <div className="stat">
                <div className="stat__value">{set.avgScore.stability.toFixed(0)}</div>
                <div className="stat__label">稳定</div>
              </div>
              <div className="stat">
                <div className="stat__value">{set.avgScore.consistency.toFixed(0)}</div>
                <div className="stat__label">一致性</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              共 {set.totalReps} 次 · 信号可用 {set.usableReps} 次
            </div>
            {set.hasHighRisk && <div className="error" style={{ marginTop: 10 }}>命中高风险错误（{ERROR_LABEL.INCOMPLETE_REPETITION}），建议降低负荷并停止本组。</div>}
          </div>

          {set.errors.length > 0 && (
            <div className="card">
              <h3 className="card__title">错误分布（规则确认）</h3>
              <div className="log-list" style={{ marginTop: 10 }}>
                {set.errors.map((e) => (
                  <div className="log-item" key={e.code}>
                    <div className="log-item__head">
                      <span style={{ fontWeight: 600 }}>{ERROR_LABEL[e.code] ?? e.code}</span>
                      <span className="log-item__meta">
                        {e.count} / {set.usableReps} 次 · 严重度 {e.severity}
                        {e.phase ? ` · 关联阶段 ${PHASE_LABEL[e.phase] ?? e.phase}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="card__desc" style={{ marginTop: 8 }}>
                仅展示规则确认的错误。特征模型提出的候选（conflicts）不作为结论展示。
              </p>
            </div>
          )}

          {set.signalIssues.length > 0 && (
            <div className="card">
              <h3 className="card__title">信号质量问题</h3>
              <div className="flag-row" style={{ marginTop: 10 }}>
                {set.signalIssues.map((s) => (
                  <span className="chip" key={s.issue}>
                    {SIGNAL_ISSUE_LABEL[s.issue] ?? s.issue} · {s.count} 次
                  </span>
                ))}
              </div>
              <p className="card__desc" style={{ marginTop: 8 }}>
                信号不可用的重复**不产生动作错误**（与后端一致），请重新佩戴或重新采集，不要把数据问题当成动作问题。
              </p>
            </div>
          )}

          <div className="card">
            <h3 className="card__title">逐次明细</h3>
            <div className="log-list" style={{ marginTop: 10 }}>
              {set.reps.map((r) => (
                <div className="log-item" key={r.index}>
                  <div className="log-item__head">
                    <span style={{ fontWeight: 600 }}>第 {r.index} 次</span>
                    <span className="log-item__meta">
                      {(r.durationMs / 1000).toFixed(1)}s · {r.sampleCount || '—'} 点 · {r.score.overall.toFixed(0)} 分
                    </span>
                  </div>
                  <div className="flag-row">
                    {!r.usable && <span className="flag">信号不可用</span>}
                    {r.errors.map((e) => (
                      <span className="flag" key={e.code}>
                        {ERROR_LABEL[e.code] ?? e.code}
                      </span>
                    ))}
                    {r.usable && r.errors.length === 0 && <span className="flag flag--ok">标准</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {(advice || adviceErr) && (
        <div className="card">
          <div className="row">
            <h3 className="card__title">AI 指导</h3>
            {advice && <span className="chip">风险 {advice.riskLevel}</span>}
          </div>
          {adviceErr && <div className="error" style={{ marginTop: 8 }}>{adviceErr}</div>}
          {advice && (
            <>
              <p className="card__desc" style={{ marginTop: 8 }}>{advice.summary}</p>
              <div className="flag-row" style={{ marginTop: 8 }}>
                <span className="flag">{advice.shouldStop ? '建议停止' : '可继续'}</span>
                <span className="flag">
                  负荷{' '}
                  {advice.loadRecommendation === 'increase' ? '增加' : advice.loadRecommendation === 'decrease' ? '降低' : '维持'}
                </span>
              </div>
              <div className="log-list" style={{ marginTop: 10 }}>
                {advice.suggestions.map((s, i) => (
                  <div className="log-item" key={i}>
                    {s.relatedErrorCode ? `【${ERROR_LABEL[s.relatedErrorCode] ?? s.relatedErrorCode}】` : ''}
                    {s.text}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {set && (
        <div className="btn-grid">
          <button className="btn btn--ghost" onClick={() => setSet(null)}>
            清除结果
          </button>
          <button className="btn" onClick={saveToHistory}>
            保存到历史
          </button>
        </div>
      )}

      {savedTip && (
        <div className="muted" style={{ fontSize: 12, color: 'var(--accent)' }}>
          已保存到「数据」页，可查看个人累计与历史记录。
        </div>
      )}

      {analysisSaved && (
        <button className="btn btn--ghost" style={{ width: '100%' }} onClick={reset}>
          清除已保存的分析
        </button>
      )}

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        错误类别与阈值来自《当前错误分类标准》：{Object.keys(ERROR_LABEL).map((c) => ERROR_LABEL[c]).join(' / ')}；
        严重度固定为 {Object.entries(ERROR_SEVERITY).map(([k, v]) => `${ERROR_LABEL[k]}=${v}`).join('、')}。
        当前阈值为工程基线，未经过真实用户与教练标定。
      </div>
    </div>
  )
}
