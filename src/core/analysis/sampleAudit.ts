// 录音有效性审计：采集现场即时判断"这段音频能不能用来标定计数"。
//
// 为什么需要：实测 25 条里 5 条（快节奏）在任何参数下都数不出次数——
// 因为 0.77 秒做一次时，两次之间根本没有回到静止，信号里不存在可分辨的重复单元。
// 这类录音采下来也无法用于标定，必须在采集当场就提示，避免白采。

export interface SampleAuditMetrics {
  durationMs: number
  frameCount: number
  samplingRateHz: number
  /** |a_vert| 的低分位与中位（g） */
  accelP10: number
  accelP50: number
  /** |ω| 的低分位与中位（°/s） */
  omegaP10: number
  omegaP50: number
  /** 处于"接近静止"（|a_vert|<0.2g 且 |ω|<40°/s）的时间占比 */
  restFraction: number
  /** 折算出的平均每次间隔（ms）；次数未知时用不上，仍返回时长 */
  maxGapMs: number
}

export interface SampleAudit {
  ok: boolean
  /** 不合格的具体原因（面向现场人员的话术） */
  issues: string[]
  metrics: SampleAuditMetrics
}

const ACC_REST = 0.2 // g
const OMEGA_REST = 40 // °/s

function quantile(a: number[], p: number): number {
  if (!a.length) return 0
  const b = [...a].sort((x, y) => x - y)
  return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]
}

/**
 * 审计一段原始帧。判据只用"信号形态"，不依赖真实次数（现场录入前就能给结论）。
 */
export function auditFrames(frames: { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }[]): SampleAudit {
  const n = frames.length
  if (n < 32) {
    return {
      ok: false,
      issues: ['采样点不足（少于 32 个）'],
      metrics: {
        durationMs: 0,
        frameCount: n,
        samplingRateHz: 0,
        accelP10: 0,
        accelP50: 0,
        omegaP10: 0,
        omegaP50: 0,
        restFraction: 0,
        maxGapMs: 0,
      },
    }
  }

  // 重力方向低通 + 竖直动态加速度
  let g: { x: number; y: number; z: number } | null = null
  const av: number[] = []
  const om: number[] = []
  let restCount = 0
  for (let i = 0; i < n; i++) {
    const a = { x: frames[i].ax, y: frames[i].ay, z: frames[i].az }
    if (!g) g = { ...a }
    else {
      const dt = Math.max(1e-3, (frames[i].t - frames[i - 1].t) / 1000)
      const k = 1 - Math.exp(-dt / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    const v = Math.abs((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1)
    const w = Math.hypot(frames[i].gx, frames[i].gy, frames[i].gz)
    av.push(v)
    om.push(w)
    if (v < ACC_REST && w < OMEGA_REST) restCount++
  }

  const dts: number[] = []
  for (let i = 1; i < n; i++) dts.push(frames[i].t - frames[i - 1].t)

  const metrics: SampleAuditMetrics = {
    durationMs: Math.round(frames[n - 1].t - frames[0].t),
    frameCount: n,
    samplingRateHz: dts.length ? Number((1000 / quantile(dts, 0.5)).toFixed(1)) : 0,
    accelP10: quantile(av, 0.1),
    accelP50: quantile(av, 0.5),
    omegaP10: quantile(om, 0.1),
    omegaP50: quantile(om, 0.5),
    restFraction: restCount / n,
    maxGapMs: dts.length ? Math.max(...dts) : 0,
  }

  const issues: string[] = []
  if (metrics.durationMs < 5000) issues.push(`时长过短（${(metrics.durationMs / 1000).toFixed(1)}s，建议 ≥5s）`)
  if (metrics.samplingRateHz > 0 && metrics.samplingRateHz < 40) issues.push(`采样率偏低（${metrics.samplingRateHz}Hz）`)
  if (metrics.maxGapMs > 150) issues.push(`存在明显丢包（最大间隔 ${metrics.maxGapMs}ms）`)
  if (metrics.restFraction < 0.06) {
    issues.push(
      `几乎全程无静止（静止时间仅占 ${(metrics.restFraction * 100).toFixed(1)}%）——` +
        `说明动作之间没有回到静止，这类录音数不出次数，建议放慢节奏重采`,
    )
  }
  if (metrics.accelP10 > 0.25) issues.push(`加速度基线偏高（p10 ${metrics.accelP10.toFixed(2)}g）——可能整段都在晃动`)

  return { ok: issues.length === 0, issues, metrics }
}
