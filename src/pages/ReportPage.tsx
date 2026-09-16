import { useMemo, useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { useReportStore } from '../store/useReportStore'
import { buildReport } from '../core/report/reportEngine'
import { ADVICE_TEMPLATES, type AnalysisResult } from '../core/analysis/analyzer'
import { ACTION_NAMES } from '../core/protocol/types'

export default function ReportPage() {
  const events = useBleStore((s) => s.events)
  const analysis = useReportStore((s) => s.analysis)
  const setAnalysis = useReportStore((s) => s.setAnalysis)
  const reset = useReportStore((s) => s.reset)

  const report = useMemo(() => buildReport(events), [events])

  const [score, setScore] = useState(80)
  const [summary, setSummary] = useState('')
  const [advice, setAdvice] = useState<string[]>([])
  const [adviceInput, setAdviceInput] = useState('')

  if (!report) {
    return (
      <div className="page">
        <div className="card">
          <h3 className="card__title">锻炼报告</h3>
          <p className="card__desc" style={{ marginTop: 8 }}>
            暂无训练数据。请先到「连接」页连接设备并开始一次训练，事件回传后这里会自动生成报告。
          </p>
        </div>
      </div>
    )
  }

  const addAdvice = (text: string) => {
    const t = text.trim()
    if (!t || advice.includes(t)) return
    setAdvice((a) => [...a, t])
    setAdviceInput('')
  }

  const anomalies: AnalysisResult['anomalies'] = []
  if (report.wristFlipCount > 0)
    anomalies.push({ label: '腕部翻转', detail: `${report.wristFlipCount} 次` })
  if (report.shortRangeCount > 0)
    anomalies.push({ label: '行程不足', detail: `${report.shortRangeCount} 次` })
  if (report.momentumCount > 0)
    anomalies.push({ label: '借力甩动', detail: `${report.momentumCount} 次` })

  const save = () => {
    setAnalysis({ score, summary: summary.trim(), advice, anomalies })
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <h3 className="card__title">训练统计</h3>
          <span className="chip">{ACTION_NAMES[report.actionId] ?? '动作'}</span>
        </div>
        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="stat__value">{report.totalReps}</div>
            <div className="stat__label">总次数</div>
          </div>
          <div className="stat">
            <div className="stat__value">{(report.complianceRate * 100).toFixed(0)}%</div>
            <div className="stat__label">达标率</div>
          </div>
          <div className="stat">
            <div className="stat__value">{report.compensationCount}</div>
            <div className="stat__label">代偿次数</div>
          </div>
          <div className="stat">
            <div className="stat__value">{report.avgPeakAngleDeg.toFixed(0)}°</div>
            <div className="stat__label">平均峰值角度</div>
          </div>
        </div>
        <div className="flag-row" style={{ marginTop: 12 }}>
          <span className="flag">{report.wristFlipCount} 腕部翻转</span>
          <span className="flag">{report.shortRangeCount} 行程不足</span>
          <span className="flag">{report.momentumCount} 借力甩动</span>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">AI 分析</h3>
        <p className="card__desc">
          大模型分析接口已预留（Analyzer），训练完成后接入即可自动生成建议；当前阶段由人工输入。
        </p>
      </div>

      <div className="card">
        <h3 className="card__title">人工分析输入</h3>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            综合评分
          </span>
          <span className="stat__value" style={{ fontSize: 22 }}>
            {score}
          </span>
        </div>
        <input
          className="range"
          type="range"
          min={0}
          max={100}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
        />

        <label className="field" style={{ marginTop: 12 }}>
          <span className="field__label">结论</span>
          <textarea
            className="textarea"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="输入训练结论…"
          />
        </label>

        <div className="field" style={{ marginTop: 12 }}>
          <span className="field__label">建议</span>
          <div className="row">
            <input
              className="input input--text"
              style={{ flex: 1 }}
              value={adviceInput}
              onChange={(e) => setAdviceInput(e.target.value)}
              placeholder="输入建议…"
            />
            <button
              className="btn btn--ghost"
              onClick={() => addAdvice(adviceInput)}
              style={{ padding: '8px 14px' }}
            >
              添加
            </button>
          </div>
        </div>

        {advice.length > 0 && (
          <div className="log-list" style={{ marginTop: 10 }}>
            {advice.map((a, i) => (
              <div className="log-item" key={i}>
                <div className="row">
                  <span style={{ fontSize: 13 }}>{a}</span>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    onClick={() => setAdvice((x) => x.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flag-row" style={{ marginTop: 10 }}>
          {ADVICE_TEMPLATES.map((t) => (
            <button type="button" className="chip chip--btn" key={t} onClick={() => addAdvice(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="btn-grid">
        <button className="btn btn--ghost" onClick={reset}>
          清除结果
        </button>
        <button className="btn" onClick={save}>
          保存分析
        </button>
      </div>

      {analysis && (
        <div className="card" style={{ borderColor: 'rgba(53,226,124,0.35)' }}>
          <div className="row">
            <h3 className="card__title">分析结果</h3>
            <span className="stat__value" style={{ fontSize: 26, color: 'var(--accent)' }}>
              {analysis.score}
            </span>
          </div>
          {analysis.summary && (
            <p className="card__desc" style={{ marginTop: 8 }}>
              {analysis.summary}
            </p>
          )}
          {analysis.anomalies.length > 0 && (
            <div className="flag-row" style={{ marginTop: 8 }}>
              {analysis.anomalies.map((a) => (
                <span className="flag" key={a.label}>
                  {a.label} · {a.detail}
                </span>
              ))}
            </div>
          )}
          {analysis.advice.length > 0 && (
            <div className="log-list" style={{ marginTop: 10 }}>
              {analysis.advice.map((a, i) => (
                <div className="log-item" key={i}>
                  {a}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
