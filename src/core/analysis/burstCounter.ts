// 基于「活动段（burst）」的计数算法。
//
// 为什么换思路：停半计数（每个停顿记 0.5）在 25 条真实录音上 0/25 正确，
// 平均误差 9.6 次——因为一次动作的两个停顿未必都明显，而首尾的空闲也可能没有停顿。
// 活动段则直接对应"做了一次"：手臂动起来 → 一段高能量 → 停下来。
//
// 核心是**双阈值迟滞（Schmitt trigger）**：
//   高于 high 才开始一段（确认真的在做动作）
//   低于 low 才结束一段（避免顶部短暂回落把一次切成两段）
// 再叠加三道处理：
//   ① 合并间隔很短的两段（顶部停顿残留）
//   ② 丢弃过短或峰值过低的段（抖动噪声）
//   ③ 首尾非运动阶段天然不产生段（因为始终低于 high），无需额外裁剪

export interface BurstOptions {
  /**
   * 用哪个信号切活动段。
   *
   * `omega`：角速度模长。**实测在 25 条真实录音上几乎失效**——哑铃做推举时
   *   几乎不旋转，|ω| 全程维持在 12~40°/s 从未落到静止，导致整段只切出 1 段。
   * `accel`：竖直方向动态加速度 |a·ĝ − 1g|。推举本质是竖直平移，
   *   加速度才携带"做了一次"的信息（离线实测分离度约 3 倍、位移约 14.8 倍）。
   */
  signal: 'omega' | 'accel'
  /** 包络平滑时间常数（ms） */
  smoothTauMs: number
  /** high 阈值 = max(floor, highRatio × p90) */
  highRatio: number
  /** low 阈值 = max(floorLow, lowRatio × p90) */
  lowRatio: number
  /** 绝对下限（°/s）：低于它一律视为静止，避免极静环境下噪声成段 */
  floorDps: number
  /** low 的绝对下限（°/s） */
  floorLowDps: number
  /** 两段间隔小于它就合并（ms）——处理顶部停顿残留 */
  mergeGapMs: number
  /** 段短于它就丢弃（ms）——处理单点抖动 */
  minSegMs: number
  /** 段峰值必须达到 p90 的这个比例，否则丢弃 */
  minSegPeakRatio: number
}

export const DEFAULT_BURST_OPTIONS: BurstOptions = {
  signal: 'accel',
  smoothTauMs: 250,
  highRatio: 0.5,
  lowRatio: 0.2,
  floorDps: 8,
  floorLowDps: 4,
  mergeGapMs: 400,
  minSegMs: 150,
  minSegPeakRatio: 0.3,
}

export interface Burst {
  startMs: number
  endMs: number
  peakDps: number
  durationMs: number
}

/**
 * 从角速度序列里切出活动段。
 * @param samples 至少含 t 与 gx/gy/gz
 * @param opt 参数
 */
export function detectBursts(
  samples: { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }[],
  opt: Partial<BurstOptions> = {},
): Burst[] {
  const o = { ...DEFAULT_BURST_OPTIONS, ...opt }
  if (samples.length < 2) return []

  // ---- 取原始通道 ----
  let om: number[]
  if (o.signal === 'omega') {
    om = samples.map((s) => Math.hypot(s.gx, s.gy, s.gz))
  } else {
    // 竖直动态加速度：先低通估重力方向，再取 |a·ĝ − 1g|
    om = new Array<number>(samples.length)
    let g: { x: number; y: number; z: number } | null = null
    for (let i = 0; i < samples.length; i++) {
      const a = { x: samples[i].ax, y: samples[i].ay, z: samples[i].az }
      if (!g) g = { ...a }
      else {
        const dt = Math.max(1e-3, (samples[i].t - samples[i - 1].t) / 1000)
        const k = 1 - Math.exp(-dt / 1.0)
        g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
      }
      const gm = Math.hypot(g.x, g.y, g.z) || 1
      const along = (a.x * g.x + a.y * g.y + a.z * g.z) / gm
      om[i] = Math.abs(along - 1) // 单位 g
    }
  }
  const env = new Array<number>(om.length)
  env[0] = om[0]
  for (let i = 1; i < om.length; i++) {
    const dt = Math.max(1e-3, (samples[i].t - samples[i - 1].t) / 1000)
    const k = 1 - Math.exp((-dt * 1000) / o.smoothTauMs)
    env[i] = env[i - 1] + (om[i] - env[i - 1]) * k
  }

  // ---- 用 p90 作为该组的"动作强度"，双阈值相对它取 ----
  const sorted = [...env].sort((a, b) => a - b)
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || 0
  // ⚠️ 绝对下限**必须随信号单位变化**：
  //   角速度是 °/s（典型 10~200），加速度是 g（典型 0.05~0.5）。
  //   早先两者共用 8/4 的下限，导致加速度模式下 high=8g 永远达不到，一段都切不出来。
  const isAccel = o.signal === 'accel'
  const floorHigh = isAccel ? Math.min(o.floorDps, 0.02) : o.floorDps
  const floorLow = isAccel ? Math.min(o.floorLowDps, 0.01) : o.floorLowDps
  const high = Math.max(floorHigh, o.highRatio * p90)
  const low = Math.max(floorLow, o.lowRatio * p90, floorHigh * 0.5)
  const minPeak = Math.max(floorHigh, o.minSegPeakRatio * p90)

  // ---- 迟滞切段 ----
  const raw: Burst[] = []
  let inSeg = false
  let segStart = 0
  let segPeak = 0
  for (let i = 0; i < env.length; i++) {
    if (!inSeg) {
      if (env[i] >= high) {
        inSeg = true
        segStart = samples[i].t
        segPeak = env[i]
      }
    } else {
      if (env[i] > segPeak) segPeak = env[i]
      if (env[i] <= low) {
        raw.push({ startMs: segStart, endMs: samples[i].t, peakDps: segPeak, durationMs: samples[i].t - segStart })
        inSeg = false
      }
    }
  }
  // 末尾还没回落的段：收尾
  if (inSeg) {
    const lastT = samples[samples.length - 1].t
    raw.push({ startMs: segStart, endMs: lastT, peakDps: segPeak, durationMs: lastT - segStart })
  }

  // ---- ① 合并间隔很短的两段 ----
  const merged: Burst[] = []
  for (const b of raw) {
    const prev = merged[merged.length - 1]
    if (prev && b.startMs - prev.endMs < o.mergeGapMs) {
      prev.endMs = b.endMs
      prev.peakDps = Math.max(prev.peakDps, b.peakDps)
      prev.durationMs = prev.endMs - prev.startMs
    } else {
      merged.push({ ...b })
    }
  }

  // ---- ② 丢弃过短 / 峰值过低的段 ----
  return merged.filter((b) => b.durationMs >= o.minSegMs && b.peakDps >= minPeak)
}

/** 便于直接用作"次数" */
export function countBursts(
  samples: { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }[],
  opt: Partial<BurstOptions> = {},
): number {
  return detectBursts(samples, opt).length
}
