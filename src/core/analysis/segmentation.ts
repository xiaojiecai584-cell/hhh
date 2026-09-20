import type { SensorSample } from './ruleClassifier'

export interface SegmentRange {
  start: number // 采样点起始索引（含）
  end: number // 采样点结束索引（含）
}

export interface SegmentInfo {
  durationMs: number
  peak: number
  axis: string
  count: number
}

/**
 * 通用动作切分（适用于绕单一轴旋转的周期性动作，如推举/侧平举）：
 * 1. 用角速度模长 |ω| 掐掉头尾静止段；
 * 2. 自动检测主导旋转轴（gx/gy/gz 方差最大）；
 * 3. 积分主导轴 → 角度 → 去漂移 → 平滑；
 * 4. 按角度"谷值"切分成单次动作。
 */
export function segmentMotion(samples: SensorSample[]): SegmentRange[] {
  const n = samples.length
  if (n < 30) return []

  const omega = samples.map((s) => Math.hypot(s.gx, s.gy, s.gz))
  const TH = 15 // °/s，高于静止噪声底

  // 掐头去尾静止段
  let lo = 0
  while (lo < n && omega[lo] < TH) lo++
  let hi = n - 1
  while (hi > lo && omega[hi] < TH) hi--
  if (hi - lo < 20) return [] // 活动段不足 400ms，视为无有效动作

  // 主导轴：活动区间内方差最大
  const axes = ['gx', 'gy', 'gz'] as const
  let axis: (typeof axes)[number] = 'gy'
  let bestVar = -1
  for (const a of axes) {
    let mean = 0
    for (let i = lo; i <= hi; i++) mean += samples[i][a]
    mean /= hi - lo + 1
    let v = 0
    for (let i = lo; i <= hi; i++) v += (samples[i][a] - mean) ** 2
    if (v > bestVar) {
      bestVar = v
      axis = a
    }
  }

  // 主导轴均值
  let axisMean = 0
  for (let i = lo; i <= hi; i++) axisMean += samples[i][axis]
  axisMean /= hi - lo + 1

  // 积分（去均值）→ 角度
  const ang: number[] = [0]
  let acc = 0
  for (let i = lo; i <= hi; i++) {
    acc += (samples[i][axis] - axisMean) * 0.02 // 20ms
    ang.push(acc)
  }
  // 去线性漂移（首尾归零）
  const m = ang.length
  const drift = (ang[m - 1] - ang[0]) / (m - 1)
  const detrended = ang.map((v, k) => v - ang[0] - drift * k)

  // 3 点平滑
  const sm: number[] = []
  for (let k = 0; k < m; k++) {
    const a = detrended[Math.max(0, k - 1)]
    const b = detrended[k]
    const c = detrended[Math.min(m - 1, k + 1)]
    sm.push((a + b + c) / 3)
  }

  // 找谷值（局部最小）作为分段边界，并强制最小间隔（过滤噪声小谷）
  const MIN_SEG_SAMPLES = 60 // ≈1200ms，两次动作边界的最小间距
  const valleys: number[] = []
  for (let k = 1; k < m - 1; k++) {
    if (sm[k] <= sm[k - 1] && sm[k] <= sm[k + 1]) {
      const last = valleys[valleys.length - 1]
      if (last !== undefined && k - last < MIN_SEG_SAMPLES) {
        if (sm[k] < sm[last]) valleys[valleys.length - 1] = k // 太近则保留更低的谷
        continue
      }
      valleys.push(k)
    }
  }

  const bounds = [0, ...valleys, m - 1]
  const segs: SegmentRange[] = []
  for (let b = 0; b < bounds.length - 1; b++) {
    const s = bounds[b]
    const e = bounds[b + 1]
    if (e - s < 10) continue // 短于 200ms 丢弃
    segs.push({ start: lo + s, end: lo + e })
  }
  return segs
}

/** 计算一段样本的元信息（时长、主轴峰值、主导轴、点数），用于候选段展示 */
export function describeSegment(samples: SensorSample[], seg: SegmentRange): SegmentInfo {
  const slice = samples.slice(seg.start, seg.end + 1)
  const axes = ['gx', 'gy', 'gz'] as const
  let axis: (typeof axes)[number] = 'gy'
  let bestVar = -1
  for (const a of axes) {
    const mean = slice.reduce((s, p) => s + p[a], 0) / slice.length
    const v = slice.reduce((s, p) => s + (p[a] - mean) ** 2, 0) / slice.length
    if (v > bestVar) {
      bestVar = v
      axis = a
    }
  }
  let peak = 0
  for (const p of slice) peak = Math.max(peak, Math.abs(p[axis]))
  return {
    durationMs: slice[slice.length - 1].t - slice[0].t,
    peak,
    axis,
    count: slice.length,
  }
}
