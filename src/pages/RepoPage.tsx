import { useCallback, useEffect, useState } from 'react'

const ERROR_LABEL: Record<string, string> = {
  INSUFFICIENT_RANGE: '行程不足',
  TEMPO_TOO_FAST: '动作过快',
  TEMPO_TOO_SLOW: '动作过慢',
  UNSTABLE_MOTION: '动作不稳定',
  INCOMPLETE_REPETITION: '未完整完成',
}

interface CollectItem {
  kind?: string
  name?: string
  description?: string | null
  basePosture?: string
  actionId?: number
  actionName?: string
  annotations?: { code: string; severity?: string }[]
  // vision_review
  provider?: string
  correct?: boolean | null
  reason?: string | null
  error?: string | null
}

export default function RepoPage() {
  const [items, setItems] = useState<CollectItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/collect')
      if (!res.ok) throw new Error(`接口返回 ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('数据格式异常（不是数组）')
      setItems(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sensors = (items ?? []).filter((i) => i.kind === 'sensor_sample')
  const motions = (items ?? []).filter((i) => i.kind === 'motion_params')
  const reviews = (items ?? []).filter((i) => i.kind === 'vision_review')
  const standard = sensors.filter((s) => Array.isArray(s.annotations) && s.annotations.length === 0)
  const nonStandard = sensors.filter((s) => Array.isArray(s.annotations) && s.annotations.length > 0)

  const errorCounts: Record<string, number> = {}
  for (const s of nonStandard) {
    for (const a of s.annotations ?? []) errorCounts[a.code] = (errorCounts[a.code] ?? 0) + 1
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(items ?? [], null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lindoway-collect-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <h3 className="card__title">云端数据仓库</h3>
          <div className="row">
            <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => void load()} disabled={loading}>
              刷新
            </button>
            <button
              className="btn btn--ghost"
              style={{ padding: '6px 12px', fontSize: 12, marginLeft: 6 }}
              onClick={exportJson}
              disabled={!items || items.length === 0}
            >
              导出
            </button>
          </div>
        </div>
        <p className="card__desc" style={{ marginTop: 6 }}>
          汇总所有用户人工标注的样本，按「标准 / 不标准 + 错误码」分类。
        </p>

        {error && (
          <div className="error" style={{ marginTop: 10 }}>
            {error}
            {error.includes('500') || error.includes('404')
              ? ' —— 大概率是 D1 数据库还没绑定（Pages → Settings → Functions → D1 bindings，变量名填 DB）。'
              : ''}
          </div>
        )}
        {loading && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>加载中…</div>}

        {items && !error && (
          <div className="stat-grid" style={{ marginTop: 12 }}>
            <div className="stat">
              <div className="stat__value">{standard.length}</div>
              <div className="stat__label">标准</div>
            </div>
            <div className="stat">
              <div className="stat__value">{nonStandard.length}</div>
              <div className="stat__label">不标准</div>
            </div>
            <div className="stat">
              <div className="stat__value">{motions.length}</div>
              <div className="stat__label">生成样本</div>
            </div>
            <div className="stat">
              <div className="stat__value">{reviews.length}</div>
              <div className="stat__label">视觉评审</div>
            </div>
          </div>
        )}
      </div>

      {reviews.length > 0 && (
        <div className="card">
          <h3 className="card__title">视觉评审记录（后台异步）</h3>
          <div className="log-list" style={{ marginTop: 10 }}>
            {[...reviews].reverse().map((r, i) => (
              <div className="log-item" key={i}>
                <div className="row">
                  <span style={{ fontWeight: 600 }}>{r.name ?? '—'}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {r.provider ?? '—'}
                  </span>
                </div>
                <div className="flag-row" style={{ marginTop: 4 }}>
                  {r.error ? (
                    <span className="flag">评审失败：{r.error.slice(0, 60)}</span>
                  ) : r.correct === true ? (
                    <span className="flag flag--ok">姿势正确</span>
                  ) : (
                    <span className="flag">需修正</span>
                  )}
                </div>
                {r.reason && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{r.reason}</div>}
                {r.description && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>描述：{r.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {items && items.length === 0 && !error && (
        <div className="card">
          <p className="card__desc">暂无数据。到「连接」页录制并标注动作、或「动作」页保存动作后，这里就会出现。</p>
        </div>
      )}

      {nonStandard.length > 0 && (
        <div className="card">
          <h3 className="card__title">错误码分布（不标准）</h3>
          <div className="flag-row" style={{ marginTop: 10 }}>
            {Object.entries(errorCounts).map(([code, n]) => (
              <span className="flag" key={code}>
                {ERROR_LABEL[code] ?? code} × {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {nonStandard.length > 0 && (
        <div className="card">
          <h3 className="card__title">不标准样本</h3>
          <div className="log-list" style={{ marginTop: 10 }}>
            {nonStandard.map((s, i) => (
              <div className="log-item" key={i}>
                <span style={{ fontWeight: 600 }}>{s.actionName ?? `动作${s.actionId ?? ''}`}</span>
                <div className="flag-row" style={{ marginTop: 4 }}>
                  {(s.annotations ?? []).map((a) => (
                    <span className="flag" key={a.code}>
                      {ERROR_LABEL[a.code] ?? a.code}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {standard.length > 0 && (
        <div className="card">
          <h3 className="card__title">标准样本</h3>
          <div className="log-list" style={{ marginTop: 10 }}>
            {standard.map((s, i) => (
              <div className="log-item" key={i}>
                <div className="row">
                  <span style={{ fontWeight: 600 }}>{s.actionName ?? `动作${s.actionId ?? ''}`}</span>
                  <span className="flag flag--ok">标准</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {motions.length > 0 && (
        <div className="card">
          <h3 className="card__title">生成样本（动作参数）</h3>
          <div className="log-list" style={{ marginTop: 10 }}>
            {motions.map((m, i) => (
              <div className="log-item" key={i}>
                <div className="row">
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{m.basePosture}</span>
                </div>
                {m.description && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>描述：{m.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
