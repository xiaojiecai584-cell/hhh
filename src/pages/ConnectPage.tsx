import { useRef, useState } from 'react'
import { useBleStore, type LoggedEvent } from '../store/useBleStore'
import { useBleConfigStore } from '../store/useBleConfigStore'
import { ACTION_NAMES } from '../core/protocol/types'
import { MOTION_TEMPLATES } from '../core/motion/templates'
import { templateToImuTarget } from '../core/motion/imuMapping'

const STATE_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
}

const ERROR_LABEL: Record<string, string> = {
  INSUFFICIENT_RANGE: '行程不足',
  TEMPO_TOO_FAST: '动作过快',
  TEMPO_TOO_SLOW: '动作过慢',
  UNSTABLE_MOTION: '动作不稳定',
  INCOMPLETE_REPETITION: '未完整完成',
}
const ERROR_CODES = Object.keys(ERROR_LABEL)

export default function ConnectPage() {
  const kind = useBleStore((s) => s.kind)
  const state = useBleStore((s) => s.state)
  const deviceName = useBleStore((s) => s.deviceName)
  const latestPose = useBleStore((s) => s.latestPose)
  const lastAck = useBleStore((s) => s.lastAck)
  const events = useBleStore((s) => s.events)
  const txLog = useBleStore((s) => s.txLog)
  const error = useBleStore((s) => s.error)
  const setKind = useBleStore((s) => s.setKind)
  const connect = useBleStore((s) => s.connect)
  const disconnect = useBleStore((s) => s.disconnect)
  const sendStartAction = useBleStore((s) => s.sendStartAction)
  const clearEvents = useBleStore((s) => s.clearEvents)
  const rawRx = useBleStore((s) => s.rawRx)
  const rxCounts = useBleStore((s) => s.rxCounts)
  const clearRawRx = useBleStore((s) => s.clearRawRx)
  const recording = useBleStore((s) => s.recording)
  const recordingCount = useBleStore((s) => s.recordingCount)
  const currentActionId = useBleStore((s) => s.currentActionId)
  const pending = useBleStore((s) => s.pending)
  const startRecording = useBleStore((s) => s.startRecording)
  const stopRecording = useBleStore((s) => s.stopRecording)
  const submitLabel = useBleStore((s) => s.submitLabel)
  const discardPending = useBleStore((s) => s.discardPending)
  const bleConfig = useBleConfigStore((s) => s.config)
  const setBleField = useBleConfigStore((s) => s.setField)
  const resetBleConfig = useBleConfigStore((s) => s.reset)
  const [busy, setBusy] = useState(false)
  const [showBleConfig, setShowBleConfig] = useState(false)
  const [labelStandard, setLabelStandard] = useState<boolean | null>(null)
  const [labelErrors, setLabelErrors] = useState<string[]>([])
  const sendingRef = useRef(false)

  const toggleError = (code: string) =>
    setLabelErrors((es) => (es.includes(code) ? es.filter((c) => c !== code) : [...es, code]))

  const handleSubmit = async () => {
    await submitLabel({ standard: labelStandard === true, errorCodes: labelErrors })
    setLabelStandard(null)
    setLabelErrors([])
  }

  const handleDiscard = () => {
    discardPending()
    setLabelStandard(null)
    setLabelErrors([])
  }

  const isConnected = state === 'connected'

  const startPreset = async (id: number) => {
    if (sendingRef.current) return
    const t = MOTION_TEMPLATES.find((t) => t.actionId === id)
    if (!t) return
    sendingRef.current = true
    setBusy(true)
    try {
      await sendStartAction(templateToImuTarget(t), `开始·${t.name} (0x82)`)
    } finally {
      sendingRef.current = false
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

  return (
    <div className="page">
      <div className="card">
        <h3 className="card__title">设备类型</h3>
        <div className="seg" style={{ marginTop: 10 }}>
          <button
            className={`seg__btn${kind === 'virtual' ? ' seg__btn--active' : ''}`}
            onClick={() => setKind('virtual')}
          >
            虚拟设备
          </button>
          <button
            className={`seg__btn${kind === 'web' ? ' seg__btn--active' : ''}`}
            onClick={() => setKind('web')}
          >
            Web 蓝牙
          </button>
        </div>
        <p className="card__desc" style={{ marginTop: 10 }}>
          {kind === 'virtual'
            ? '内置模拟设备，按 BT36 协议模拟 50Hz 姿态流 + ACK + 事件。'
            : '通过 Web Bluetooth 连接 BLE 透传模块（Android Chrome / Edge）。'}
        </p>
      </div>

      <div className="card">
        <div className="row">
          <h3 className="card__title">BLE 参数（Web 蓝牙）</h3>
          <button
            className="btn btn--ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => setShowBleConfig((v) => !v)}
          >
            {showBleConfig ? '收起' : '配置'}
          </button>
        </div>
        {showBleConfig && (
          <>
            <div className="field-grid" style={{ marginTop: 10 }}>
              <label className="field">
                <span className="field__label">服务 UUID</span>
                <input
                  className="input input--text"
                  value={bleConfig.serviceUuid}
                  onChange={(e) => setBleField('serviceUuid', e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">写特征 UUID</span>
                <input
                  className="input input--text"
                  value={bleConfig.writeUuid}
                  onChange={(e) => setBleField('writeUuid', e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">通知特征 UUID</span>
                <input
                  className="input input--text"
                  value={bleConfig.notifyUuid}
                  onChange={(e) => setBleField('notifyUuid', e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">设备名称前缀（可选）</span>
                <input
                  className="input input--text"
                  value={bleConfig.deviceNameFilter}
                  onChange={(e) => setBleField('deviceNameFilter', e.target.value)}
                />
              </label>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">设备筛选方式</span>
              <div className="seg" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className={`seg__btn${!bleConfig.acceptAllDevices ? ' seg__btn--active' : ''}`}
                  onClick={() => setBleField('acceptAllDevices', false)}
                >
                  按 UUID 过滤
                </button>
                <button
                  type="button"
                  className={`seg__btn${bleConfig.acceptAllDevices ? ' seg__btn--active' : ''}`}
                  onClick={() => setBleField('acceptAllDevices', true)}
                >
                  扫描全部
                </button>
              </div>
            </div>
            <p className="card__desc" style={{ marginTop: 8 }}>
              支持短 UUID（如 ffe0 / ffe1），系统自动补全 128 位；改完参数后重新「连接」生效。
            </p>
            <button className="btn btn--ghost" style={{ marginTop: 8 }} onClick={resetBleConfig}>
              恢复默认
            </button>
          </>
        )}
      </div>

      <div className="card">
        <div className="row">
          <div>
            <span className={`badge badge--${state}`}>{STATE_LABEL[state]}</span>
            {deviceName && (
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                {deviceName}
              </div>
            )}
          </div>
          {isConnected ? (
            <button className="btn btn--ghost" onClick={doDisconnect} disabled={busy}>
              断开
            </button>
          ) : (
            <button className="btn" onClick={doConnect} disabled={busy || state === 'connecting'}>
              {state === 'connecting' ? '连接中…' : '连接'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {isConnected && (
        <div className="card">
          <h3 className="card__title">指令下发</h3>
          <div className="btn-grid" style={{ marginTop: 10 }}>
            {MOTION_TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="btn btn--ghost"
                onClick={() => startPreset(t.actionId)}
                disabled={busy}
              >
                开始·{t.name}
              </button>
            ))}
          </div>
          {txLog.length > 0 && (
            <div className="log-list" style={{ marginTop: 12 }}>
              {[...txLog].reverse().map((t) => (
                <div className="log-item" key={t.id}>
                  <div className="log-item__head">
                    <span>{t.label}</span>
                    <span className="log-item__meta">{t.hex}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {latestPose && (
        <div className="card">
          <div className="row">
            <h3 className="card__title">实时姿态（0x01 · 50Hz）</h3>
            <span className="chip">
              {latestPose.timestampMs === 0 ? '待机' : `${latestPose.timestampMs} ms`}
            </span>
          </div>
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <PoseStat label="roll 横滚" value={`${latestPose.rollDeg.toFixed(2)}°`} />
            <PoseStat label="pitch 俯仰" value={`${latestPose.pitchDeg.toFixed(2)}°`} />
            <PoseStat label="yaw 偏航" value={`${latestPose.yawDeg.toFixed(2)}°`} />
            <PoseStat label="az 加速度" value={`${latestPose.azG.toFixed(3)}g`} />
            <PoseStat label="gx 角速度" value={`${latestPose.gxDps.toFixed(1)}°/s`} />
            <PoseStat label="gy 角速度" value={`${latestPose.gyDps.toFixed(1)}°/s`} />
            <PoseStat label="gz 角速度" value={`${latestPose.gzDps.toFixed(1)}°/s`} />
            <PoseStat label="ax / ay" value={`${latestPose.axG.toFixed(3)} / ${latestPose.ayG.toFixed(3)}g`} />
          </div>
          {lastAck && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              最近 ACK：动作 {ACTION_NAMES[lastAck.actionId] ?? lastAck.actionId}
            </div>
          )}
        </div>
      )}

      {isConnected && (
        <div className="card">
          <div className="row">
            <h3 className="card__title">动作录制与标注</h3>
            <span className="chip">
              {recording
                ? `录制中 ${recordingCount} 点`
                : pending
                  ? `${pending.actionName} · ${pending.count} 点`
                  : currentActionId
                    ? ACTION_NAMES[currentActionId] ?? `动作${currentActionId}`
                    : '未选动作'}
            </span>
          </div>

          {pending ? (
            <>
              <p className="card__desc" style={{ marginTop: 8 }}>
                录制完成（{pending.count} 个采样点）。请人工确认该动作是否标准。
              </p>
              <div className="seg" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className={`seg__btn${labelStandard === true ? ' seg__btn--active' : ''}`}
                  onClick={() => {
                    setLabelStandard(true)
                    setLabelErrors([])
                  }}
                >
                  标准
                </button>
                <button
                  type="button"
                  className={`seg__btn${labelStandard === false ? ' seg__btn--active' : ''}`}
                  onClick={() => setLabelStandard(false)}
                >
                  不标准
                </button>
              </div>
              {labelStandard === false && (
                <>
                  <p className="muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>
                    选择错误类型（可多选）：
                  </p>
                  <div className="flag-row">
                    {ERROR_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        className="chip chip--btn"
                        style={labelErrors.includes(code) ? { outline: '2px solid var(--accent)' } : undefined}
                        onClick={() => toggleError(code)}
                      >
                        {ERROR_LABEL[code]}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="btn-grid" style={{ marginTop: 12 }}>
                <button className="btn btn--ghost" onClick={handleDiscard}>
                  丢弃
                </button>
                <button
                  className="btn"
                  onClick={() => void handleSubmit()}
                  disabled={labelStandard === null || (labelStandard === false && labelErrors.length === 0)}
                >
                  提交入库
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="card__desc" style={{ marginTop: 8 }}>
                先「开始·动作」下发指令，再点「开始录制」做一次动作，点「停止录制」后人工标注「标准 / 不标准 + 错误码」并入库。
              </p>
              <div className="btn-grid" style={{ marginTop: 10 }}>
                {recording ? (
                  <button className="btn" onClick={stopRecording}>
                    停止录制
                  </button>
                ) : (
                  <button className="btn" onClick={startRecording}>
                    开始录制
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="row">
          <h3 className="card__title">事件回传（0x02）</h3>
          <button
            className="btn btn--ghost"
            onClick={clearEvents}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            清空
          </button>
        </div>
        {events.length === 0 ? (
          <p className="card__desc" style={{ marginTop: 8 }}>
            暂无事件。连接并「开始」后，设备回传的判姿事件会显示在这里。
          </p>
        ) : (
          <div className="log-list" style={{ marginTop: 10 }}>
            {[...events].reverse().map((e) => (
              <EventItem key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <h3 className="card__title">调试 · 接收数据</h3>
          <button
            className="btn btn--ghost"
            onClick={clearRawRx}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            清空
          </button>
        </div>
        <div className="flag-row" style={{ marginTop: 8 }}>
          <span className="chip">姿态 {rxCounts.pose}</span>
          <span className="chip">事件 {rxCounts.event}</span>
          <span className="chip">ACK {rxCounts.ack}</span>
        </div>
        {rawRx.length === 0 ? (
          <p className="card__desc" style={{ marginTop: 8 }}>
            暂无接收数据。连接设备后会实时显示原始帧（十六进制）。
          </p>
        ) : (
          <div className="log-list" style={{ marginTop: 10, maxHeight: 360 }}>
            {[...rawRx].reverse().map((e) => (
              <div className="log-item" key={e.id}>
                <div className="log-item__head">
                  <span style={{ fontWeight: 600 }}>{e.typeLabel}</span>
                  <span className="log-item__meta">{e.time}</span>
                </div>
                <div className="debug-hex">{e.hex}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PoseStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat__value" style={{ fontSize: 16 }}>
        {value}
      </div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

function EventItem({ e }: { e: LoggedEvent }) {
  const hasFlag = e.flags.wristFlip || e.flags.shortRange || e.flags.momentum
  return (
    <div className="log-item">
      <div className="log-item__head">
        <span style={{ fontWeight: 600 }}>判姿事件</span>
        <span className="log-item__meta">{ACTION_NAMES[e.actionId] ?? `动作${e.actionId}`}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        峰值 {e.peakAngleDeg.toFixed(1)}° · 耗时 {(e.durationMs / 1000).toFixed(2)}s
      </div>
      <div className="flag-row">
        {hasFlag ? (
          <>
            {e.flags.wristFlip && <span className="flag">腕部翻转</span>}
            {e.flags.shortRange && <span className="flag">行程不足</span>}
            {e.flags.momentum && <span className="flag">借力甩动</span>}
          </>
        ) : (
          <span className="flag flag--ok">动作标准</span>
        )}
      </div>
    </div>
  )
}
