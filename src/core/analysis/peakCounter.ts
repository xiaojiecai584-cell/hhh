// 基于「峰值突出度（prominence）」的活动计数。
//
// 为什么放弃阈值判定：
//   现场反馈"每次之间确实有静止，但时长不同"。而阈值法要求信号回到某个绝对/相对
//   水平并维持一段时间，静止时长一短就被 250ms 的平滑抹平，于是整段只剩 1 段。
//
// 突出度法的核心：**不关心信号是否回到静止，只关心两次动作之间有没有明显的低洼。**
//   一次动作 = 包络上的一个峰
//   峰的突出度 = (峰值 − 两侧较低的那条谷) / 峰值
//   只保留突出度足够大的峰 —— 这样静止 200ms 或 800ms 都不影响判定。
//
// 另加两道过滤：
//   · 峰值必须达到本组 p90 的一定比例（滤掉噪声小峰）
//   · 相邻两峰至少间隔 minPeakGapMs（滤掉一次动作里的双峰抖动）

export interface PeakOptions {
  signal: 'omega' | 'accel'
  /** 包络平滑常数（ms）。**必须小**——大了会把短暂静止抹平 */
  smoothTauMs: number
  /** 峰的突出度下限：(峰值 − 谷) / 峰值 超过它才算一次 */
  prominenceRatio: number
  /** 峰值下限 = 该比例 × p90（滤噪声） */
  minPeakRatio: number
  /** 相邻两峰的最小间隔（ms）。`adaptiveGap` 为 false 时用这个固定值 */
  minPeakGapMs: number
  /**
   * **是否让间隔自适应本组节奏**（默认开）。
   *
   * 为什么需要：固定 1200ms 在慢组（3.5s/次）上合适，但快组（0.75s/次）
   * 会把 10 次并成 1 次——实测 #15/#16/#17 就是这样被数成 1 的。
   *
   * 做法是两遍式：先用 gapFloorMs 这种小间隔检出候选峰，
   * 用候选峰的中位间隔估出本组周期 T，再用 gapRatio × T 重筛。
   * 这样慢组自动得到大间隔、快组自动得到小间隔。
   *
   * **回退**：设为 false 即完全退回固定 minPeakGapMs 的旧行为。
   */
  adaptiveGap: boolean
  /** 自适应间隔 = 该比例 × 候选峰中位间隔 */
  gapRatio: number
  /** 自适应间隔的下限（ms） */
  gapFloorMs: number
  /** 自适应间隔的上限（ms） */
  gapCapMs: number
  /** 峰的最小高度（绝对下限，随信号单位） */
  absFloor: number
}

export const DEFAULT_PEAK_OPTIONS: PeakOptions = {
  signal: 'omega',
  smoothTauMs: 100,
  prominenceRatio: 0.3,
  minPeakRatio: 0.25,
  minPeakGapMs: 1200,
  adaptiveGap: true,
  gapRatio: 0.35,
  gapFloorMs: 150,
  gapCapMs: 2500,
  absFloor: 6,
}

export interface ActivityPeak {
  tMs: number
  value: number
  /** (峰值 − 两侧较低谷) / 峰值 */
  prominence: number
}

export function detectActivityPeaks(
  samples: { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }[],
  opt: Partial<PeakOptions> = {},
): ActivityPeak[] {
  const o = { ...DEFAULT_PEAK_OPTIONS, ...opt }
  const n = samples.length
  if (n < 4) return []

  // ---- 取通道 + 轻平滑 ----
  const raw = new Array<number>(n)
  if (o.signal === 'omega') {
    for (let i = 0; i < n; i++) raw[i] = Math.hypot(samples[i].gx, samples[i].gy, samples[i].gz)
  } else {
    let g: { x: number; y: number; z: number } | null = null
    for (let i = 0; i < n; i++) {
      const a = { x: samples[i].ax, y: samples[i].ay, z: samples[i].az }
      if (!g) g = { ...a }
      else {
        const dt = Math.max(1e-3, (samples[i].t - samples[i - 1].t) / 1000)
        const k = 1 - Math.exp(-dt / 1.0)
        g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
      }
      const gm = Math.hypot(g.x, g.y, g.z) || 1
      raw[i] = Math.abs((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1)
    }
  }
  const env = new Array<number>(n)
  env[0] = raw[0]
  for (let i = 1; i < n; i++) {
    const dt = Math.max(1e-3, (samples[i].t - samples[i - 1].t) / 1000)
    const k = 1 - Math.exp((-dt * 1000) / o.smoothTauMs)
    env[i] = env[i - 1] + (raw[i] - env[i - 1]) * k
  }

  // ---- p90 作强度基准（单位随信号不同）----
  const sorted = [...env].sort((a, b) => a - b)
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))] || 0
  const absFloor = o.signal === 'accel' ? Math.min(o.absFloor, 0.02) : o.absFloor
  const minPeak = Math.max(absFloor, o.minPeakRatio * p90)

  // ---- 局部极大值 ----
  const maxima: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1]) maxima.push(i)
  }
  if (!maxima.length) return []

  // ---- 突出度：向两侧扫到"更高的峰"为止，取两侧最低点的较大者 ----
  // 这是标准的 prominence 定义，与静止时长、静止水平都无关。
  const peaks: ActivityPeak[] = []
  for (const mi of maxima) {
    const v = env[mi]
    if (v < minPeak) continue
    let leftMin = v
    for (let i = mi - 1; i >= 0; i--) {
      if (env[i] > v) break
      if (env[i] < leftMin) leftMin = env[i]
    }
    let rightMin = v
    for (let i = mi + 1; i < n; i++) {
      if (env[i] > v) break
      if (env[i] < rightMin) rightMin = env[i]
    }
    const base = Math.max(leftMin, rightMin) // 两侧较低谷中较高的那条 = 真正的"谷底基准"
    const prom = v > 0 ? (v - base) / v : 0
    if (prom >= o.prominenceRatio) peaks.push({ tMs: samples[mi].t, value: v, prominence: prom })
  }

  // ---- 相邻太近的峰只保留更高的（一次动作里的双峰）----
  // 两遍式：先按 gapFloorMs 检候选，估出本组周期，再按 gapRatio×周期 重筛。
  peaks.sort((a, b) => a.tMs - b.tMs)
  const applyGap = (gapMs: number): ActivityPeak[] => {
    const kept: ActivityPeak[] = []
    for (const p of peaks) {
      const prev = kept[kept.length - 1]
      if (prev && p.tMs - prev.tMs < gapMs) {
        if (p.value > prev.value) kept[kept.length - 1] = p
      } else kept.push(p)
    }
    return kept
  }

  if (!o.adaptiveGap) return applyGap(o.minPeakGapMs)

  // 第一遍：小间隔，拿候选峰
  const candidates = applyGap(o.gapFloorMs)
  if (candidates.length < 3) return applyGap(o.minPeakGapMs) // 候选太少，退回固定间隔
  // 候选峰的中位间隔 = 本组节奏的估计
  const gaps: number[] = []
  for (let i = 1; i < candidates.length; i++) gaps.push(candidates[i].tMs - candidates[i - 1].tMs)
  gaps.sort((a, b) => a - b)
  const medianGap = gaps[Math.floor(gaps.length / 2)]
  const gap = Math.min(o.gapCapMs, Math.max(o.gapFloorMs, o.gapRatio * medianGap))
  return applyGap(gap)
}

export function countActivityPeaks(
  samples: { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }[],
  opt: Partial<PeakOptions> = {},
): number {
  return detectActivityPeaks(samples, opt).length
}
