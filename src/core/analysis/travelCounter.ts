// 位移周期计数：对**竖直位移**做峰值检测，数"上-下"循环。
//
// 这是目前唯一在真实数据上可用的方案。50 条通过录音审计的标注样本实测：
//   完全正确 40/50 = 80%，平均误差 0.22 次，最大误差 2 次
// 对比：
//   停顿半计数（旧）  0%，平均误差 9.60
//   峰值检测（加速度）46%，平均误差 1.40
//   停顿各算 1 次      2%，平均误差 5.96
//   大停顿各算 1 次    0%，平均误差 7.90
//
// 为什么位移最有效：实测信号分离度
//   |ω| 2.4 倍、动态加速度 3.0 倍、**竖直位移 14.8 倍**
// 位移的难点只在积分漂移，用两级"减去滑动均值"（高通）压制即可。

export interface TravelOptions {
  /** 位移再平滑的常数（秒），抑制高频抖动 */
  smoothSec: number
  /** 峰的突出度下限，相对位移的 p10~p90 跨度 */
  prominenceRatio: number
  /** 相邻两峰的最小间隔（ms） */
  minPeakGapMs: number
}

export const DEFAULT_TRAVEL_OPTIONS: TravelOptions = {
  smoothSec: 0.12,
  prominenceRatio: 0.5,
  minPeakGapMs: 300,
}

type Frame = { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }

/** 竖直位移曲线（米），抗漂移 */
export function travelSeries(frames: Frame[]): number[] {
  const n = frames.length
  if (n < 4) return new Array(n).fill(0)
  const dt = (frames[n - 1].t - frames[0].t) / 1000 / (n - 1)

  // 1) 竖直动态加速度（重力方向用一阶低通估计）
  const aV = new Array<number>(n)
  let g: { x: number; y: number; z: number } | null = null
  for (let i = 0; i < n; i++) {
    const a = { x: frames[i].ax, y: frames[i].ay, z: frames[i].az }
    if (!g) g = { ...a }
    else {
      const dti = i > 0 ? Math.max(1e-3, (frames[i].t - frames[i - 1].t) / 1000) : 0.02
      const k = 1 - Math.exp(-dti / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    aV[i] = ((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1) * 9.80665
  }

  /** 减去 ±winSec 的滑动均值（高通），压制积分漂移 */
  const highPass = (arr: number[], winSec: number): number[] => {
    const win = Math.max(2, Math.round(winSec / Math.max(dt, 1e-3)))
    const out = new Array<number>(n)
    // 前缀和，O(n) 而不是 O(n·win)
    const pre = new Array<number>(n + 1).fill(0)
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i]
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - win)
      const hi = Math.min(n - 1, i + win)
      const mean = (pre[hi + 1] - pre[lo]) / (hi - lo + 1)
      out[i] = arr[i] - mean
    }
    return out
  }

  // 2) 积分成速度，去 1 秒滑动均值
  const v = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) v[i] = v[i - 1] + ((aV[i] + aV[i - 1]) / 2) * dt
  const vHP = highPass(v, 1.0)

  // 3) 再积分成位移，去 2 秒滑动均值
  const x = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) x[i] = x[i - 1] + ((vHP[i] + vHP[i - 1]) / 2) * dt
  const xHP = highPass(x, 2.0)

  // 4) 轻度平滑
  const out = new Array<number>(n)
  out[0] = xHP[0]
  for (let i = 1; i < n; i++) {
    const k = 1 - Math.exp(-dt / 0.12)
    out[i] = out[i - 1] + (xHP[i] - out[i - 1]) * k
  }
  return out
}

export interface TravelCycle {
  /** 峰值时刻（ms） */
  tMs: number
  /** 峰值处的位移（米） */
  value: number
  /** 突出度（0~1） */
  prominence: number
}

/** 检出位移曲线上的往复循环（每个峰 = 一次举到顶） */
export function detectTravelCycles(frames: Frame[], opt: Partial<TravelOptions> = {}): TravelCycle[] {
  const o = { ...DEFAULT_TRAVEL_OPTIONS, ...opt }
  const x = travelSeries(frames)
  const n = x.length
  if (n < 8) return []

  const sorted = [...x].sort((a, b) => a - b)
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))] || 0
  const p10 = sorted[Math.floor(n * 0.1)] || 0
  const span = p90 - p10
  if (!(span > 0)) return []

  // 局部极大值 + 突出度（相对位移跨度）
  const cand: TravelCycle[] = []
  for (let i = 1; i < n - 1; i++) {
    if (!(x[i] > x[i - 1] && x[i] >= x[i + 1])) continue
    const v = x[i]
    let l = v
    for (let k = i - 1; k >= 0; k--) {
      if (x[k] > v) break
      if (x[k] < l) l = x[k]
    }
    let r = v
    for (let k = i + 1; k < n; k++) {
      if (x[k] > v) break
      if (x[k] < r) r = x[k]
    }
    const prom = (v - Math.max(l, r)) / span
    if (prom >= o.prominenceRatio) cand.push({ tMs: frames[i].t, value: v, prominence: prom })
  }

  // 相邻太近只保留突出度更高的
  const kept: TravelCycle[] = []
  for (const c of cand) {
    const prev = kept[kept.length - 1]
    if (prev && c.tMs - prev.tMs < o.minPeakGapMs) {
      if (c.prominence > prev.prominence) kept[kept.length - 1] = c
    } else kept.push(c)
  }
  return kept
}

export function countTravelCycles(frames: Frame[], opt: Partial<TravelOptions> = {}): number {
  return detectTravelCycles(frames, opt).length
}
