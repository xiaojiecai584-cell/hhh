import { useEffect, useMemo, useRef, useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { useBodyStore } from '../store/useBodyStore'
import { resolveSegments } from '../core/body/bodyProfile'
import { MOTION_TEMPLATES } from '../core/motion/templates'
import { templateToImuTarget } from '../core/motion/imuMapping'
import LiveSession from '../components/LiveSession'

const STATE_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
}

/** 用户界面：连接 → 选动作 + 目标次数 → 开始。开始后交给 LiveSession 全屏接管。 */
export default function TrainingPage() {
  const state = useBleStore((s) => s.state)
  const deviceName = useBleStore((s) => s.deviceName)
  const kind = useBleStore((s) => s.kind)
  const error = useBleStore((s) => s.error)
  const connect = useBleStore((s) => s.connect)
  const disconnect = useBleStore((s) => s.disconnect)
  const sendStartAction = useBleStore((s) => s.sendStartAction)
  const repCount = useBleStore((s) => s.repCount)
  const targetReps = useBleStore((s) => s.targetReps)
  const setTargetReps = useBleStore((s) => s.setTargetReps)
  const setActive = useBleStore((s) => s.setActive)

  const profile = useBodyStore((s) => s.profile)
  const seg = useMemo(() => resolveSegments(profile), [profile])

  const [selected, setSelected] = useState<number>(MOTION_TEMPLATES[0]?.actionId ?? 1)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ reps: number; durationMs: number; name: string } | null>(null)

  const isConnected = state === 'connected'
  const template = MOTION_TEMPLATES.find((t) => t.actionId === selected) ?? MOTION_TEMPLATES[0]

  // 记下本组结果，结束后显示（结束时 repCount 不会被清零，下一次开始才清）
  const startedAt = useRef(0)
  const wasActive = useRef(false)
  const lastReps = useRef(0)
  useEffect(() => {
    if (setActive) lastReps.current = repCount
  }, [repCount, setActive])
  useEffect(() => {
    if (!wasActive.current && setActive) {
      startedAt.current = Date.now()
      setResult(null)
    } else if (wasActive.current && !setActive) {
      setResult({
        reps: lastReps.current,
        durationMs: Date.now() - startedAt.current,
        name: template?.name ?? '训练',
      })
    }
    wasActive.current = setActive
  }, [setActive, template])

  const start = async () => {
    if (!template || busy) return
    setBusy(true)
    try {
      await sendStartAction(templateToImuTarget(template, undefined, seg), `开始·${template.name} (0x82)`)
    } finally {
      setBusy(false)
    }
  }

  const doConnect = async () => {
    setBusy(true)
    await connect()
    setBusy(false)
  }

  const doDisconnect = async () => {
    setBusy(true)
    await disconnect()
    setBusy(false)
  }

  const fmt = (ms: number) => {
    const s = Math.round(ms / 1000)
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  return (
    <div className="page">
      <LiveSession />

      <div className="card">
        <div className="row">
          <div>
            <span className={`badge badge--${state}`}>{STATE_LABEL[state]}</span>
            <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              {deviceName ?? (kind === 'web' ? 'Lindoway 智能哑铃' : '虚拟设备')}
            </div>
          </div>
          {isConnected ? (
            <button className="btn btn--ghost" onClick={doDisconnect} disabled={busy}>
              断开
            </button>
          ) : (
            <button className="btn" onClick={doConnect} disabled={busy || state === 'connecting'}>
              {state === 'connecting' ? '连接中…' : '连接设备'}
            </button>
          )}
        </div>
        {error && (
          <div className="error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card__title">选择动作</h3>
        <div className="seg" style={{ marginTop: 10 }}>
          {MOTION_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`seg__btn${selected === t.actionId ? ' seg__btn--active' : ''}`}
              onClick={() => setSelected(t.actionId)}
              disabled={setActive}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="train__target">
          <span>本组目标次数</span>
          <input
            className="input input--num"
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            value={targetReps}
            disabled={setActive}
            onChange={(e) => setTargetReps(Number(e.target.value))}
          />
          <span>次（0 = 不限）</span>
        </div>
      </div>

      <div className="card train">
        <div className="train__name">{template?.name}</div>
        {result ? (
          <>
            <div className="train__counter">
              <span className="train__count">{result.reps}</span>
              <span className="train__of">
                {targetReps > 0 ? `/ ${targetReps}` : '次'}
              </span>
            </div>
            <div className="train__timer">
              本组完成 · 用时 {fmt(result.durationMs)}
            </div>
          </>
        ) : (
          <div className="train__timer">
            {targetReps > 0 ? `目标 ${targetReps} 次` : '不限次数'}
          </div>
        )}
        <button className="btn btn--xl" onClick={start} disabled={!isConnected || busy || setActive}>
          开始
        </button>
        {!isConnected && <div className="train__hint">请先连接设备</div>}
      </div>
    </div>
  )
}
