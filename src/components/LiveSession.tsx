import { useEffect, useRef, useState } from 'react'
import { useBleStore } from '../store/useBleStore'
import { ACTION_NAMES } from '../core/protocol/types'
import { MOTION_TEMPLATES } from '../core/motion/templates'

export interface LiveSessionViewProps {
  name: string
  repCount: number
  targetReps: number
  clock: string
  reached: boolean
  onStop: () => void
}

/**
 * 纯展示层：屏上只有「动作名 / 计时 / 次数 / 进度 / 结束」。
 * 与 store 解耦，便于单独渲染与测试。
 */
export function LiveSessionView({ name, repCount, targetReps, clock, reached, onStop }: LiveSessionViewProps) {
  const pct = targetReps > 0 ? Math.min(100, (repCount / targetReps) * 100) : 0
  return (
    <div className="live">
      <div className="live__top">
        <span className="live__name">{name}</span>
        <span className="live__clock">{clock}</span>
      </div>

      <div className="live__body">
        <div className="live__count">{repCount}</div>
        <div className="live__unit">{targetReps > 0 ? `/ ${targetReps} 次` : '次'}</div>
      </div>

      {targetReps > 0 && (
        <div className="live__bar">
          <div className="live__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="live__hint">{reached ? '已达标，正在结束本组…' : '保持节奏'}</div>

      <button className="live__stop" onClick={onStop}>
        结束
      </button>
    </div>
  )
}

/**
 * 运动进行中的全屏界面：一组开始时自动接管整个屏幕（含顶栏与底部导航），结束后自动退出。
 *
 * 顺手做了两件对实战有用的：
 *  - Wake Lock：运动时不让屏幕自动息屏（浏览器不支持就静默跳过）
 *  - 每计一次振动一下，不用一直盯着屏幕
 */
export default function LiveSession() {
  const setActive = useBleStore((s) => s.setActive)
  const repCount = useBleStore((s) => s.repCount)
  const targetReps = useBleStore((s) => s.targetReps)
  const currentActionId = useBleStore((s) => s.currentActionId)
  const sendStopAction = useBleStore((s) => s.sendStopAction)

  const [elapsedMs, setElapsedMs] = useState(0)
  const wakelockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const lastCountRef = useRef(0)

  // 计时
  useEffect(() => {
    if (!setActive) {
      setElapsedMs(0)
      return
    }
    const t0 = Date.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 200)
    return () => clearInterval(id)
  }, [setActive])

  // 屏幕常亮
  useEffect(() => {
    if (!setActive) return
    let cancelled = false
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
    }
    nav.wakeLock
      ?.request('screen')
      .then((s) => {
        if (cancelled) void s.release()
        else wakelockRef.current = s
      })
      .catch(() => {
        /* 不支持或被拒绝：忽略 */
      })
    return () => {
      cancelled = true
      void wakelockRef.current?.release().catch(() => {})
      wakelockRef.current = null
    }
  }, [setActive])

  // 每计一次振动一下
  useEffect(() => {
    if (!setActive) {
      lastCountRef.current = 0
      return
    }
    if (repCount > lastCountRef.current) navigator.vibrate?.(35)
    lastCountRef.current = repCount
  }, [repCount, setActive])

  if (!setActive) return null

  const name =
    MOTION_TEMPLATES.find((t) => t.actionId === currentActionId)?.name ??
    (currentActionId ? ACTION_NAMES[currentActionId] : undefined) ??
    '训练中'
  const s = Math.floor(elapsedMs / 1000)
  const clock = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <LiveSessionView
      name={name}
      repCount={repCount}
      targetReps={targetReps}
      clock={clock}
      reached={targetReps > 0 && repCount >= targetReps}
      onStop={() => void sendStopAction('结束本组 (0x83)')}
    />
  )
}
