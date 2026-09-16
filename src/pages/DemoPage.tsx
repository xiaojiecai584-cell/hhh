import { useEffect, useRef } from 'react'
import { useMotionStore } from '../store/useMotionStore'
import { useBodyStore } from '../store/useBodyStore'
import { useBleStore } from '../store/useBleStore'
import { MOTION_TEMPLATES } from '../core/motion/templates'
import { useCustomMotionStore } from '../store/useCustomMotionStore'
import { sampleAngles } from '../core/motion/engine'
import { AXIS_LABELS, type JointAngles } from '../core/motion/types'
import { templateToImuTarget } from '../core/motion/imuMapping'
import HumanViewport from '../components/HumanViewport'
import AngleCurve, { type AngleCurveHandle } from '../components/AngleCurve'

const SPEEDS = [0.5, 1, 1.5, 2]

export default function DemoPage() {
  const templateId = useMotionStore((s) => s.templateId)
  const playing = useMotionStore((s) => s.playing)
  const loop = useMotionStore((s) => s.loop)
  const speed = useMotionStore((s) => s.speed)
  const setTemplateId = useMotionStore((s) => s.setTemplateId)
  const setPlaying = useMotionStore((s) => s.setPlaying)
  const setLoop = useMotionStore((s) => s.setLoop)
  const setSpeed = useMotionStore((s) => s.setSpeed)
  const profile = useBodyStore((s) => s.profile)
  const bleState = useBleStore((s) => s.state)
  const sendStartAction = useBleStore((s) => s.sendStartAction)

  const customs = useCustomMotionStore((s) => s.customs)
  const allTemplates = [...MOTION_TEMPLATES, ...customs]
  const template = allTemplates.find((t) => t.id === templateId) ?? MOTION_TEMPLATES[0]

  const poseRef = useRef<JointAngles | null>(sampleAngles(template, 0))
  const curveRef = useRef<AngleCurveHandle>(null)
  const progressRef = useRef(0)
  const sendingRef = useRef(false)

  // 切换动作时复位
  useEffect(() => {
    progressRef.current = 0
    poseRef.current = sampleAngles(template, 0)
    curveRef.current?.setCursor(0)
  }, [template])

  // 播放推进
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = 0
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const dur = template.durationMs / 1000
      progressRef.current += (dt * speed) / dur
      if (progressRef.current >= 1) {
        if (loop) progressRef.current %= 1
        else {
          progressRef.current = 1
          setPlaying(false)
        }
      }
      poseRef.current = sampleAngles(template, progressRef.current)
      curveRef.current?.setCursor(progressRef.current)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, loop, speed, template, setPlaying])

  const togglePlay = () => {
    if (!playing && progressRef.current >= 1) {
      progressRef.current = 0
      poseRef.current = sampleAngles(template, 0)
      curveRef.current?.setCursor(0)
    }
    setPlaying(!playing)
  }

  const sendToDevice = async () => {
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      await sendStartAction(templateToImuTarget(template), `开始·${template.name}`)
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h3 className="card__title">标准动作</h3>
        <div className="seg" style={{ marginTop: 10 }}>
          {allTemplates.map((t) => (
            <button
              key={t.id}
              className={`seg__btn${templateId === t.id ? ' seg__btn--active' : ''}`}
              onClick={() => setTemplateId(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <h3 className="card__title">实时演示</h3>
          <span className="chip">主运动轴 · {AXIS_LABELS[template.mainAxis]}</span>
        </div>
        <HumanViewport
          profile={profile}
          poseRef={poseRef}
          posture={template.basePosture}
          sensorPosition={template.sensorPosition}
        />
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          传感器坐标轴：
          <span style={{ color: '#ff4d4d' }}>红=X 屈伸(pitch)</span> ·{' '}
          <span style={{ color: '#4dff6a' }}>绿=Y 纵轴(yaw)</span> ·{' '}
          <span style={{ color: '#4d9fff' }}>蓝=Z 外展(roll)</span>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">关节角-时间曲线</h3>
        <AngleCurve ref={curveRef} template={template} />
      </div>

      <div className="card">
        <div className="btn-grid">
          <button className="btn" onClick={togglePlay}>
            {playing ? '暂停' : '播放'}
          </button>
          <button className={`btn ${loop ? '' : 'btn--ghost'}`} onClick={() => setLoop(!loop)}>
            循环 {loop ? '开' : '关'}
          </button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            倍速
          </span>
          <div className="seg" style={{ flex: 1 }}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`seg__btn${speed === s ? ' seg__btn--active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn btn--ghost"
          style={{ marginTop: 12, width: '100%' }}
          onClick={sendToDevice}
          disabled={bleState !== 'connected'}
        >
          {bleState === 'connected' ? `开始动作（0x82）· ${template.name}` : '开始动作（未连接）'}
        </button>
      </div>
    </div>
  )
}
