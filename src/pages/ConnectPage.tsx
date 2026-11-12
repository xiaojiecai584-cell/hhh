import { useMemo, useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { ACTION_NAMES } from '../core/protocol/types'
import {
  SAMPLE_CONDITION_LABEL,
  estimateStoreBytes,
  useSampleStore,
  type SampleCondition,
} from '../store/useSampleStore'

const STATE_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
}

/** 当前生效的三类错误（与 core/analysis/ruleClassifier.ts 的 ERROR_DEDUCTION 一致） */
const ERROR_LABEL: Record<string, string> = {
  INSUFFICIENT_RANGE: '行程不足（−25）',
  WRIST_FLIP: '手腕外翻（−15）',
  NOT_VERTICAL: '行程不垂直（−10）',
}
const ERROR_CODES = Object.keys(ERROR_LABEL)

/**
 * 调试站 · 采集专用页面。
 *
 * 只保留这一轮需要的东西：连接设备 → 录制一段 → 人工填真实次数与错误类型
 * → 提交到独立数据集（useSampleStore，key 为 lindoway-samples-v2）。
 *
 * 原来的 BLE 参数面板、原始帧监视、0x02 事件回传、指令日志、姿态显示、
 * 旧的「整段/逐段 + 标注入库」流程都已移除——那些属于调试用途，
 * 与本次重采无关，留着反而容易误操作。
 */
export default function ConnectPage() {
  const state = useBleStore((s) => s.state)
  const deviceName = useBleStore((s) => s.deviceName)
  const error = useBleStore((s) => s.error)
  const connect = useBleStore((s) => s.connect)
  const disconnect = useBleStore((s) => s.disconnect)
  const recording = useBleStore((s) => s.recording)
  const recordingCount = useBleStore((s) => s.recordingCount)
  const startRecording = useBleStore((s) => s.startRecording)
  const stopRecording = useBleStore((s) => s.stopRecording)
  const takeRawRecording = useBleStore((s) => s.takeRawRecording)
  const currentActionId = useBleStore((s) => s.currentActionId)

  const samples = useSampleStore((s) => s.samples)
  const addSample = useSampleStore((s) => s.addSample)
  const removeSample = useSampleStore((s) => s.removeSample)
  const clearSamples = useSampleStore((s) => s.clearSamples)
  const usedBytes = useMemo(() => estimateStoreBytes(samples), [samples])

  const [busy, setBusy] = useState(false)
  // 待标注的内容（提交后清空次数/错误/备注，工况保留以便连续采同一工况）
  const [trueReps, setTrueReps] = useState(0)
  const [condition, setCondition] = useState<SampleCondition>('normal')
  const [errors, setErrors] = useState<string[]>([])
  const [note, setNote] = useState('')
  /** 已停止录制、等待标注提交的缓冲区是否存在 */
  const [ready, setReady] = useState(false)
  /** 停止录制后对这段录音做的有效性审计 */
  const [audit, setAudit] = useState<ReturnType<typeof peekRecordingAudit>>(null)
  const peekRecordingAudit = useBleStore((s) => s.peekRecordingAudit)

  const isConnected = state === 'connected'

  const doConnect = async () => {
    setBusy(true)
    try {
      if (isConnected) await disconnect()
      else await connect()
    } finally {
      setBusy(false)
    }
  }

  const doStart = () => {
    startRecording()
    setReady(false)
  }

  const doStop = () => {
    stopRecording({ skipSegment: true }) // 整段保留，不做自动切段
    setAudit(peekRecordingAudit()) // 立刻审计这段录音是否可用（只读，不清缓冲）
    setReady(true)
  }

  const doSubmit = () => {
    const raw = takeRawRecording()
    if (!raw) return
    addSample({
      id: `s-${Date.now().toString(36)}`,
      actionId: raw.actionId,
      actionName: raw.actionName,
      condition,
      trueReps,
      errorCodes: errors,
      note,
      samplingRateHz: raw.samplingRateHz,
      durationMs: raw.durationMs,
      frameCount: raw.frames.length,
      capturedAt: new Date().toISOString(),
      frames: raw.frames,
    })
    setTrueReps(0)
    setErrors([])
    setNote('')
    setReady(false)
  }

  const doExport = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      dataset: 'seated_shoulder_press_v2',
      device: { name: deviceName ?? 'unknown', placement: 'dumbbell' },
      sampleCount: samples.length,
      samples,
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lindoway-samples-v2-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      {/* ---------- 设备连接 ---------- */}
      <div className="card">
        <div className="row">
          <h3 className="card__title">设备</h3>
          <span className="muted" style={{ fontSize: 12 }}>{STATE_LABEL[state] ?? state}</span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {deviceName ?? '尚未连接（需 Chrome / Edge，且为 localhost 或 HTTPS）'}
        </div>
        <button className="btn" style={{ marginTop: 10, width: '100%' }} onClick={() => void doConnect()} disabled={busy}>
          {isConnected ? '断开连接' : '连接设备'}
        </button>
        {error && <div className="train__hint" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>

      {/* ---------- 录制 ---------- */}
      <div className="card">
        <div className="row">
          <h3 className="card__title">录制</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {currentActionId ? ACTION_NAMES[currentActionId] ?? `动作${currentActionId}` : '等待设备启动'}
          </span>
        </div>
        <p className="card__desc" style={{ marginTop: 6 }}>
          在**设备上**启动一组，做完动作后回到这里点「停止录制」，然后填写真实次数与错误类型。
        </p>
        <div className="btn-grid" style={{ marginTop: 10 }}>
          {recording ? (
            <button className="btn" onClick={doStop}>停止录制</button>
          ) : (
            <button className="btn" onClick={doStart}>开始录制</button>
          )}
        </div>
        {recording && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>采集中 · 已缓存 {recordingCount} 个采样点</div>
        )}
        {ready && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6, color: 'var(--accent)' }}>
            已停止，缓冲区里有一段数据待标注 → 填完下面提交
          </div>
        )}
        {ready && audit && (
          <div
            className="log-item"
            style={{
              marginTop: 8,
              borderLeft: `3px solid ${audit.ok ? 'var(--ok, #16a34a)' : 'var(--danger, #dc2626)'}`,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {audit.ok ? '✓ 录音可用' : '⚠ 这段录音可能无法用于计数标定'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              时长 {(audit.metrics.durationMs / 1000).toFixed(1)}s · {audit.metrics.frameCount} 帧 ·{' '}
              {audit.metrics.samplingRateHz}Hz · 最大间隔 {audit.metrics.maxGapMs}ms
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              |a_vert| p10 {audit.metrics.accelP10.toFixed(3)}g / p50 {audit.metrics.accelP50.toFixed(3)}g · |ω| p10{' '}
              {audit.metrics.omegaP10.toFixed(0)} / p50 {audit.metrics.omegaP50.toFixed(0)} °/s ·{' '}
              <b>静止占比 {(audit.metrics.restFraction * 100).toFixed(1)}%</b>
            </div>
            {audit.issues.map((msg) => (
              <div key={msg} style={{ fontSize: 12, marginTop: 4, color: 'var(--danger, #dc2626)' }}>
                · {msg}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- 标注与提交 ---------- */}
      <div className="card">
        <div className="row">
          <h3 className="card__title">标注与提交</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            已存 {samples.length} 条 · 约 {Math.round(usedBytes / 1024)} KB
          </span>
        </div>

        <div className="row" style={{ marginTop: 10, gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">真实次数（人工数）</span>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={trueReps}
              onChange={(e) => setTrueReps(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">工况</span>
            <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as SampleCondition)}>
              {Object.entries(SAMPLE_CONDITION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 10 }}>
          <span className="field__label">错误类型（可多选；都不勾 = 标准动作）</span>
          <div className="flag-row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            {ERROR_CODES.map((code) => {
              const on = errors.includes(code)
              return (
                <button
                  key={code}
                  type="button"
                  className="chip chip--btn"
                  style={on ? { outline: '2px solid var(--accent)' } : undefined}
                  onClick={() => setErrors((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))}
                >
                  {ERROR_LABEL[code]}
                </button>
              )
            })}
          </div>
        </div>

        <label className="field" style={{ marginTop: 10 }}>
          <span className="field__label">备注（可选）</span>
          <input className="input" value={note} placeholder="例如：第 5 次幅度明显不足" onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="btn-grid" style={{ marginTop: 10 }}>
          <button className="btn" onClick={doSubmit} disabled={recording || !ready}>提交到新库</button>
          <button className="btn btn--ghost" onClick={doExport} disabled={!samples.length}>导出新库（JSON）</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          提交会取走当前缓冲区（同一段不会重复提交）。localStorage 上限约 5MB，
          采够一轮请先导出再清空。
        </div>
      </div>

      {/* ---------- 已采集列表 ---------- */}
      {!!samples.length && (
        <div className="card">
          <div className="row">
            <h3 className="card__title">已采集</h3>
            <button
              className="btn btn--ghost"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => {
                if (window.confirm(`确定清空 ${samples.length} 条？不可恢复。`)) clearSamples()
              }}
            >
              清空
            </button>
          </div>
          {samples.map((s) => (
            <div key={s.id} className="log-item">
              <div className="log-item__head">
                <span style={{ fontWeight: 600 }}>
                  {ACTION_NAMES[s.actionId] ?? s.actionName} · {SAMPLE_CONDITION_LABEL[s.condition]} · {s.trueReps} 次
                </span>
                <button
                  className="btn btn--ghost"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => removeSample(s.id)}
                >
                  删除
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {(s.durationMs / 1000).toFixed(1)}s · {s.frameCount} 帧 · {s.samplingRateHz}Hz
                {s.errorCodes.length ? ` · ${s.errorCodes.map((c) => ERROR_LABEL[c] ?? c).join('、')}` : ' · 无错误标注'}
                {s.note ? ` · ${s.note}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
