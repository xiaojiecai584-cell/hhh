import { useMemo } from 'react'
import { useDataStore } from '../store/useDataStore'

export default function DataPage() {
  const sessions = useDataStore((s) => s.sessions)
  const removeSession = useDataStore((s) => s.removeSession)
  const clearSessions = useDataStore((s) => s.clearSessions)

  const stats = useMemo(() => {
    if (sessions.length === 0) return null
    const totalReps = sessions.reduce((a, s) => a + (s.set?.totalReps ?? s.report?.totalReps ?? 0), 0)
    const scored = sessions.map((s) => s.set?.avgScore.overall).filter((v): v is number => typeof v === 'number')
    const avgScore =
      scored.length > 0
        ? scored.reduce((a, b) => a + b, 0) / scored.length
        : sessions.reduce((a, s) => a + (s.analysis?.score ?? 0), 0) /
          Math.max(1, sessions.filter((s) => s.analysis).length)
    const totalErrors = sessions.reduce((a, s) => a + (s.set?.errors.reduce((x, e) => x + e.count, 0) ?? 0), 0)
    return {
      totalSessions: sessions.length,
      totalReps,
      avgScore,
      totalErrors,
    }
  }, [sessions])

  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lindoway-sessions-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div className="card">
        <h3 className="card__title">个人累计</h3>
        {stats ? (
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <div className="stat">
              <div className="stat__value">{stats.totalSessions}</div>
              <div className="stat__label">训练次数</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.totalReps}</div>
              <div className="stat__label">总动作次数</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.totalErrors}</div>
              <div className="stat__label">累计问题次数</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.avgScore.toFixed(0)}</div>
              <div className="stat__label">平均评分</div>
            </div>
          </div>
        ) : (
          <p className="card__desc" style={{ marginTop: 8 }}>
            暂无训练记录。完成一次训练后，到「报告」页点「保存到历史」即可累积。
          </p>
        )}
      </div>

      <div className="card">
        <div className="row">
          <h3 className="card__title">历史记录</h3>
          {sessions.length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn--ghost"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={exportJson}
              >
                导出 JSON
              </button>
              <button
                className="btn btn--ghost"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={clearSessions}
              >
                清空
              </button>
            </div>
          )}
        </div>

        {sorted.length === 0 ? (
          <p className="card__desc" style={{ marginTop: 8 }}>暂无记录。</p>
        ) : (
          <div className="log-list" style={{ marginTop: 10 }}>
            {sorted.map((s) => (
              <div className="log-item" key={s.id}>
                <div className="log-item__head">
                  <span style={{ fontWeight: 600 }}>{s.actionName}</span>
                  <span className="log-item__meta">{new Date(s.startedAt).toLocaleString()}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {s.set ? (
                    <>
                      次数 {s.set.totalReps} · 可用 {s.set.usableReps} · 平均分 {s.set.avgScore.overall} ·
                      问题 {s.set.errors.reduce((a, e) => a + e.count, 0)}
                      {s.set.hasHighRisk && ' · ⚠ 高风险'}
                    </>
                  ) : (
                    <>
                      次数 {s.report?.totalReps ?? 0} · 达标率 {((s.report?.complianceRate ?? 0) * 100).toFixed(0)}% ·
                      代偿 {s.report?.compensationCount ?? 0}
                    </>
                  )}
                  {s.analysis && <> · 评分 {s.analysis.score}</>}
                </div>
                {s.analysis?.summary && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {s.analysis.summary}
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={() => removeSession(s.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
