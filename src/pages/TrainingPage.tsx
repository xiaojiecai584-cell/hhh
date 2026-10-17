import { useEffect, useRef, useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { MOTION_TEMPLATES } from '../core/motion/templates'
import { START_MODE_LABEL } from '../core/protocol/types'
import LiveSession from '../components/LiveSession'

const STATE_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
}

/**
 * 用户界面：连接设备 → 等待**设备端**启动（语音关键词 / 隐私倒计时）。
 * 启动后设备发 0x02 动作开始事件，本页自动进入 LiveSession 全屏计时。
 * App 不再主动下发 0x82 —— 启动权在设备端。
 */
export default function TrainingPage() {
  const state = useBleStore((s) => s.state)
  const deviceName = useBleStore((s) => s.deviceName)
  const kind = useBleStore((s) => s.kind)
  const error = useBleStore((s) => s.error)
  const connect = useBleStore((s) => s.connect)
  const disconnect = useBleStore((s) => s.disconnect)
  const targetReps = useBleStore((s) => s.targetReps)
  const setActive = useBleStore((s) => s.setActive)
  const currentActionId = useBleStore((s) => s.currentActionId)
  const lastMode = useBleStore((s) => s.startMode)

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ reps: number; durationMs: number; name: string } | null>(null)

  const isConnected = state === 'connected'
  // 动作以设备发来的 actionId 为准；还没启动过时用模板列表第一个做展示
  const selected = currentActionId ?? MOTION_TEMPLATES[0]?.actionId ?? 1
  const template = MOTION_TEMPLATES.find((t) => t.actionId === selected) ?? MOTION_TEMPLATES[0]

  // 记下本组结果，结束后显示（结束时 repCount 不会被清零，下一次开始才清）
  const startedAt = useRef(0)
  const wasActive = useRef(false)
  // 记下本组结果，结束后显示。
  // 注意最后一个次数必须从 store 直接读：达标时「计数 +1」与「setActive=false」
  // 是同一批更新，用 ref 缓存会读到倒数第二次的值，结果卡片就永远少 1 次
  // （现场表现正是"总是到目标值减一"）。
  useEffect(() => {
    if (!wasActive.current && setActive) {
      startedAt.current = Date.now()
      setResult(null)
    } else if (wasActive.current && !setActive) {
      setResult({
        reps: useBleStore.getState().repCount,
        durationMs: Date.now() - startedAt.current,
        name: template?.name ?? '训练',
      })
    }
    wasActive.current = setActive
  }, [setActive, template])

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
        <h3 className="card__title">当前动作</h3>
        <div className="seg" style={{ marginTop: 10 }}>
          {MOTION_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`seg__btn${selected === t.actionId ? ' seg__btn--active' : ''}`}
              disabled
            >
              {t.name}
            </button>
          ))}
        </div>
        <p className="card__desc">动作由设备菜单选择，App 会在设备启动后自动切换。</p>
        <div className="train__target">
          <span>本组目标次数</span>
          <b className="train__target-val">{targetReps > 0 ? `${targetReps} 次` : '由设备决定'}</b>
        </div>
        <p className="card__desc" style={{ marginTop: 8 }}>
          次数由设备菜单设置，启动也在设备端（语音关键词或隐私倒计时）。
          设备开始后这里会自动进入计时界面。
        </p>
      </div>

      <div className="card train">
        <div className="train__name">{template?.name}</div>
        {result && (
          <>
            <div className="train__counter">
              <span className="train__count">{result.reps}</span>
              <span className="train__of">{targetReps > 0 ? `/ ${targetReps}` : '次'}</span>
            </div>
          </>
        )}
        {result ? (
          <div className="train__timer">本组完成 · 用时 {fmt(result.durationMs)}</div>
        ) : (
          <div className="train__timer">
            {isConnected ? '等待设备启动…' : '请先连接设备'}
          </div>
        )}
        {/* 启动权在设备端（语音关键词 / 隐私倒计时），App 只等待 0x02 动作开始事件 */}
        <div className="train__waiting">
          <span className={`dot${isConnected ? ' dot--live' : ''}`} />
          {isConnected ? '已就绪 · 请在设备上开始' : '未连接'}
        </div>
        {lastMode && (
          <div className="train__hint">上次启动方式：{START_MODE_LABEL[lastMode]}</div>
        )}
      </div>
    </div>
  )
}
