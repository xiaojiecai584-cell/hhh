import { useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { useSubjectStore } from '../store/useSubjectStore'
import { useApiConfigStore } from '../store/useApiConfigStore'
import { SIGNAL_ISSUE_LABEL } from '../core/analysis/contract'
import { ERROR_SEVERITY } from '../core/analysis/ruleClassifier'
import { applySafetyOverride, coachAdvice, type CoachAdviceResult } from '../core/api/motionAi'

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

/** 报告页：显示结束一组时**自动生成**的整组分析结果，可重新分析（例如刚配好后端地址） */
export default function ReportPage() {
  const lastReport = useBleStore((s) => s.lastReport)
  const analyzing = useBleStore((s) => s.analyzing)
  const analyzeError = useBleStore((s) => s.analyzeError)
  const analyzeLastSet = useBleStore((s) => s.analyzeLastSet)
  const repCount = useBleStore((s) => s.repCount)
  const setActive = useBleStore((s) => s.setActive)
  const { subjectId, sensorPosition } = useSubjectStore()
  const baseUrl = useApiConfigStore((s) => s.baseUrl)

  const [advice, setAdvice] = useState<CoachAdviceResult | null>(null)
  const [adviceErr, setAdviceErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = lastReport?.analysis ?? null

  const askCoach = async () => {
    if (!set || !baseUrl) return
    const first = set.reps.find((r) => r.usable)
    if (!first) return
    setBusy(true)
    setAdviceErr(null)
    try {
      const analysis = {
        requestId: 'local',
        sessionId: `session-${subjectId}`,
        action: { id: set.actionId, name: set.actionName, confidence: 1 },
        state: { phase: 'complete' as const, repCount: 1, isStarted: true, isComplete: true },
        score: first.score,
        errors: first.errors,
        signalQuality: first.signalQuality,
        features: {},
        model: {
          analyzerType: 'rule_based',
          name: set.actionName,
          version: '0.1.0',
          featureModelProbabilities: {},
          featureModelCandidates: [],
          conflicts: [],
        },
      }
      const a = await coachAdvice(baseUrl, analysis)
      setAdvice(applySafetyOverride(a, analysis))
    } catch (e) {
      setAdviceErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      {setActive && (
        <div className="card">
          <h3 className="card__title">本组进行中</h3>
          <p className="card__desc" style={{ marginTop: 8 }}>
            已识别 {repCount} 次。点「结束」后会自动分析并存入历史。
          </p>
        </div>
      )}

      {!set && !setActive && (
        <div className="card">
          <h3 className="card__title">锻炼报告</h3>
          <p className="card__desc" style={{ marginTop: 8 }}>
            还没有报告。到「训练」页开始一组，点「结束」后这里会自动生成，并存入「数据」页。
          </p>
          {analyzeError && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              上次分析提示：{analyzeError}
            </div>
          )}
        </div>
      )}

      {set && (
        <>
          <div className="card">
            <div className="row">
              <h3 className="card__title">本组报告</h3>
              <span className="chip">{set.actionName}</span>
            </div>
            <p className="card__desc" style={{ marginTop: 8 }}>
              {set.backendUsed ? `分析来源：后端 ${baseUrl}` : '分析来源：本地规则分析器（阈值与后端一致）'}
              {lastReport?.savedToHistory && ' · 已自动存入历史'}
            </p>
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
              共 {set.totalReps} 次 · 信号可用 {set.usableReps} 次 · 佩戴 {sensorPosition === 'right_upper_arm' ? '右上臂' : '左上臂'} ·{' '}
              {new Date(lastReport?.analyzedAt ?? Date.now()).toLocaleTimeString()}
            </div>

            {set.hasHighRisk && (
              <div className="error" style={{ marginTop: 10 }}>
                命中高风险错误（{ERROR_LABEL.INCOMPLETE_REPETITION}），建议降低负荷并停止本组。
              </div>
            )}

            <div className="btn-grid" style={{ marginTop: 12 }}>
              <button className="btn btn--ghost" onClick={() => void analyzeLastSet({ save: true })} disabled={analyzing}>
                {analyzing ? '分析中…' : '重新分析'}
              </button>
              {baseUrl && (
                <button className="btn" onClick={() => void askCoach()} disabled={busy || set.usableReps === 0}>
                  {busy ? '请求中…' : '请求 AI 指导'}
                </button>
              )}
            </div>
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
                仅展示规则确认的错误；特征模型提出的候选（conflicts）不作为结论展示。
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
                信号不可用的重复不产生动作错误（与后端一致）；请重新佩戴或重新采集，不要把数据问题当成动作问题。
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
                      {r.source === 'backend' ? ' · 后端' : ''}
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
          {adviceErr && (
            <div className="error" style={{ marginTop: 8 }}>
              {adviceErr}
            </div>
          )}
          {advice && (
            <>
              <p className="card__desc" style={{ marginTop: 8 }}>{advice.summary}</p>
              <div className="flag-row" style={{ marginTop: 8 }}>
                <span className="flag">{advice.shouldStop ? '建议停止' : '可继续'}</span>
                <span className="flag">
                  负荷{' '}
                  {advice.loadRecommendation === 'increase'
                    ? '增加'
                    : advice.loadRecommendation === 'decrease'
                      ? '降低'
                      : '维持'}
                </span>
                <span className="flag">来源 {advice.source}</span>
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

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        错误类别与阈值来自《当前错误分类标准》：{Object.keys(ERROR_LABEL).map((c) => ERROR_LABEL[c]).join(' / ')}；
        严重度固定为 {Object.entries(ERROR_SEVERITY).map(([k, v]) => `${ERROR_LABEL[k]}=${v}`).join('、')}。
        当前阈值为工程基线，未经过真实用户与教练标定。
      </div>
    </div>
  )
}
