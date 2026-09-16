import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { sampleAngles } from '../core/motion/engine'
import { AXIS_LABELS, type JointAngles, type MotionTemplate } from '../core/motion/types'

export interface AngleCurveHandle {
  setCursor: (t: number) => void
}

function mainAxisOf(tmpl: MotionTemplate, a: JointAngles): number {
  switch (tmpl.mainAxis) {
    case 1:
      return a.shoulderFlexion
    case 2:
      return a.shoulderAbduction
    case 3:
      return a.elbowFlexion
    case 4:
      return a.hipFlexion
    default:
      return a.kneeFlexion
  }
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  tmpl: MotionTemplate,
  kind: 'main' | 'elbow',
  toX: (t: number) => number,
  toY: (deg: number) => number,
  color: string,
  width: number,
) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const N = 64
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = sampleAngles(tmpl, t)
    const deg = kind === 'main' ? mainAxisOf(tmpl, a) : a.elbowFlexion
    const x = toX(t)
    const y = toY(deg)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

const AngleCurve = forwardRef<AngleCurveHandle, { template: MotionTemplate }>(
  function AngleCurve({ template }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const cursorRef = useRef(0)

    const draw = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth || 300
      const h = canvas.clientHeight || 160
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const padL = 34
      const padR = 10
      const padT = 14
      const padB = 22
      const plotW = w - padL - padR
      const plotH = h - padT - padB
      const maxDeg = 180
      const toX = (t: number) => padL + t * plotW
      const toY = (deg: number) => padT + (1 - deg / maxDeg) * plotH

      // 横向网格 + 角度标注
      ctx.font = '10px sans-serif'
      ctx.lineWidth = 1
      ctx.textAlign = 'right'
      for (let deg = 0; deg <= 180; deg += 45) {
        const y = toY(deg)
        ctx.strokeStyle = 'rgba(107,122,136,0.18)'
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(w - padR, y)
        ctx.stroke()
        ctx.fillStyle = 'rgba(167,180,192,0.75)'
        ctx.fillText(String(deg), padL - 6, y + 3)
      }

      // 中线（动作顶点）
      ctx.strokeStyle = 'rgba(107,122,136,0.3)'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(toX(0.5), padT)
      ctx.lineTo(toX(0.5), padT + plotH)
      ctx.stroke()

      // 峰值参考线
      ctx.strokeStyle = 'rgba(255,154,60,0.7)'
      ctx.beginPath()
      ctx.moveTo(padL, toY(template.peakAngleDeg))
      ctx.lineTo(w - padR, toY(template.peakAngleDeg))
      ctx.stroke()
      ctx.setLineDash([])

      // 肘屈曲线（次要）
      drawSeries(ctx, template, 'elbow', toX, toY, 'rgba(167,180,192,0.5)', 1.5)
      // 主运动轴曲线（强调）
      drawSeries(ctx, template, 'main', toX, toY, '#35e27c', 2.5)

      // 游标
      const t = cursorRef.current
      const angles = sampleAngles(template, t)
      const main = mainAxisOf(template, angles)
      const cx = toX(t)
      const cy = toY(main)
      ctx.strokeStyle = '#eaf1f7'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, padT)
      ctx.lineTo(cx, padT + plotH)
      ctx.stroke()
      ctx.fillStyle = '#35e27c'
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fill()

      // 图例
      ctx.textAlign = 'left'
      ctx.fillStyle = '#35e27c'
      ctx.fillText(`${AXIS_LABELS[template.mainAxis]} · 主运动轴`, padL, padT - 3)
    }, [template])

    useImperativeHandle(
      ref,
      () => ({
        setCursor: (t: number) => {
          cursorRef.current = t
          draw()
        },
      }),
      [draw],
    )

    useEffect(() => {
      draw()
    }, [draw])

    return <canvas ref={canvasRef} className="curve" />
  },
)

export default AngleCurve
