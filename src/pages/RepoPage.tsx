import { useCallback, useEffect, useState } from 'react'

const ERROR_LABEL: Record<string, string> = {
  INSUFFICIENT_RANGE: '行程不足',
  TEMPO_TOO_FAST: '动作过快',
  TEMPO_TOO_SLOW: '动作过慢',
  UNSTABLE_MOTION: '动作不稳定',
  INCOMPLETE_REPETITION: '未完整完成',
}

interface RuleError {
  code: string
  severity?: string
}
interface SensorResult {
  available: boolean
  standard: boolean
  errors: RuleError[]
  score?: { overall: number } | null
  features?: { durationMs: number; peakAngularVelocity: number } | null
}
interface CollectItem {
  kind?: string
  name?: string
  description?: string | null
  basePosture?: string
  actionId?: number
  actionName?: string
  result?: SensorResult
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
  const standard = sensors.filter((s) => s.result?.available && s.result.standard)
  const nonStandard = sensors.filter((s) => s.result?.available && !s.result.standard)
  const unavailable = sensors.filter((s) => s.result && !s.result.available)

  const errorCounts: Record<string, number> = {}
  for (const s of nonStandard) {
    for (const e of s.result?.errors ?? []) errorCounts[e.code] = (errorCounts[e.code] ?? 0) + 1
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
          这里汇总所有用户上报的样本（D1 云端），按「标准 / 不标准 + 错误码」分类。
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
              <div className="stat__value">{unavailable.length}</div>
              <div className="stat__label">信号不可用</div>
            </div>
            <div className="stat">
              <div className="stat__value">{motions.length}</div>
              <div className="stat__label">生成样本</div>
            </div>
          </div>
        )}
      </div>

      {items && items.length === 0 && !error && (
        <div className="card">
          <p className="card__desc">暂无数据。到「连接」页录制动作、或在「动作」页保存动作后，这里就会出现。</p>
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
                <div className="row">
                  <span style={{ fontWeight: 600 }}>{s.actionName ?? `动作${s.actionId ?? ''}`}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {s.result?.features ? `${s.result.features.durationMs.toFixed(0)}ms` : ''}
                  </span>
                </div>
                <div className="flag-row" style={{ marginTop: 4 }}>
                  {(s.result?.errors ?? []).map((e) => (
                    <span className="flag" key={e.code}>
                      {ERROR_LABEL[e.code] ?? e.code}
                    </span>
                  ))}
                </div>
                {s.result?.score && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>总分 {s.result.score.overall.toFixed(1)}</div>
                )}
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
                {s.result?.features && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {s.result.features.durationMs.toFixed(0)}ms · 峰值 {s.result.features.peakAngularVelocity.toFixed(1)}°/s
                  </div>
                )}
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
