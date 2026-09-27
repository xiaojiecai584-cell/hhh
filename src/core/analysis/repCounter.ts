import type { SensorSample } from './contract'

/**
 * 在线重复计数（rep counter）。
 *
 * ## 为什么不能用 `segmentMotion`
 *
 * `segmentMotion` 是**离线切段**算法（录完把整段切开交给人工标注），允许整段重算、
 * 边界可以随后续数据变化。实测把它当实时计数器用会出三个结构性问题：
 *
 *  1. **数字跳变**：`count = segmentMotion(整个缓冲区).length` 每 25 个点重算一次，
 *     而主轴选择与「线性去漂移」都依赖整段首尾——尾巴一延长，斜率变、积分曲线整体变形、
 *     旧的波谷位置全移。所以计数会 8→9→8→10 回跳，**天生非单调**。
 *  2. **系统性漏数**：`MIN_SEG_SAMPLES=60`（1.2s）把过近的波谷合并，动作快一点就把两次并成一次，
 *     于是永远到不了目标次数，达标自动停止也永远不触发。
 *  3. **轻晃也加数**：只有 `|ω|≥15°/s` 一道掐头去尾，之后**没有任何幅度判断**。
 *     实测线上 #201（全程 |ω|≤28°/s，就是站着晃）被切出 4 段。
 *
 * ## 计数信号：重力参考的姿态改变量
 *
 * 互补滤波跟踪设备系重力方向单位向量 ĝ（陀螺仪短期准、加速度计长期准），
 * 维护静止参考 ĝ_ref，计数标量 `d = angle(ĝ, ĝ_ref)`。实测：
 * 干净单次侧平举 d≈69~79°，而单轴陀螺仪积分只有 30~36°（低估一半以上，主轴还会跳）。
 *
 * ## 状态机：峰谷自适应（不是「回到静止」）
 *
 * 一次重复 = 从谷底升到峰值、再回落到峰谷差的 `fallFrac` 以下。阈值全部相对本组实际幅度，所以：
 *  - 连续做、不完整放回起始位也能数（回落到峰值 40% 即算一次）
 *  - 幅度大小不同的动作不用改参数
 *  - 轻轻晃动时峰谷差永远到不了 `minRangeDeg`，**一次都不会计**
 *
 * 参考方向只在「明显静止」时缓慢跟随，肢体一旦离开静止就冻结——
 * 否则慢速动作时参考会跟着一起走，姿态改变量永远长不起来（实测把 74° 压成 38°）。
 *
 * RepEvent 字段与协议 0x02 事件帧对齐，便于以后固件实现 0x02 后无缝切换数据源。
 */

export interface RepFlags {
  /** 腕部翻转/代偿：本次绕重力轴的扭转占整体转动比例过大 */
  wristFlip: boolean
  /** 幅度不足：本次姿态改变明显小于目标 */
  shortRange: boolean
  /** 借力/惯性：本次明显快于目标时长 */
  momentum: boolean
}

export interface RepEvent {
  index: number // 第几次，从 1 起
  startMs: number
  endMs: number
  durationMs: number
  rangeDeg: number // 本次峰谷差（度）
  peakOmegaDps: number // 本次角速度峰值
  twistRatio: number // 绕重力轴扭转占总转动的比例
  flags: RepFlags
}

export interface RepCounterOptions {
  /** 离开静止的冻结门槛（度）：d 超过它就不再更新静止参考 */
  restFreezeDeg: number
  /** 静止参考更新的角速度门槛（°/s） */
  restOmegaDps: number
  /** 静止参考更新的时间常数（ms） */
  restTauMs: number
  /** 幅度门限（度）：峰谷差小于它不计次（无目标、又还没建立基线时使用） */
  minRangeDeg: number
  /** 角速度峰值门限（°/s）：真实重复一定有实际转动 */
  minOmegaPeakDps: number
  /** 回落到峰谷差的该比例以下，算本次结束 */
  fallFrac: number
  /** 不应期（ms） */
  minRepMs: number
  /** 单次最长时间（ms） */
  maxRepMs: number
  /** 期望幅度（度），0 = 未知 */
  targetPeakDeg: number
  /** 期望单次时长（ms），0 = 未知 */
  targetDurationMs: number
  /** 扭转占比超过它判为腕翻转 */
  twistRatioLimit: number
  /** 自适应基线：取已计次幅度中位数的该倍数作为门限 */
  adaptiveFloorRatio: number
  /** 单次耗时超过已计次耗时中位数的该倍数，判为「挪位置」而不是动作 */
  durationRatioLimit: number
}

export const DEFAULT_REP_OPTIONS: RepCounterOptions = {
  restFreezeDeg: 10,
  restOmegaDps: 40,
  restTauMs: 800,
  minRangeDeg: 20,
  minOmegaPeakDps: 40,
  fallFrac: 0.4,
  minRepMs: 700,
  maxRepMs: 15000,
  targetPeakDeg: 0,
  targetDurationMs: 0,
  twistRatioLimit: 0.25,
  adaptiveFloorRatio: 0.6,
  durationRatioLimit: 3,
}

interface V3 {
  x: number
  y: number
  z: number
}

const norm = (v: V3): V3 => {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const angleDeg = (a: V3, b: V3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI

/** 加速度计重力方向（设备系单位向量）；模长离开 1g 太多说明线加速度污染严重，返回 null */
function gravityFromAccel(s: SensorSample): V3 | null {
  const m = Math.hypot(s.ax, s.ay, s.az)
  if (m < 0.55 || m > 1.6) return null
  return { x: s.ax / m, y: s.ay / m, z: s.az / m }
}

export class RepCounter {
  private opt: RepCounterOptions

  private g: V3 | null = null
  private gRef: V3 | null = null
  private prevT: number | null = null

  private count = 0
  private peaks: number[] = []
  private durations: number[] = []

  // 当前这次重复
  private armed = false
  private valley = 0
  private valleyT = 0
  private repPeak = 0
  private repValley = 0
  private repOmega = 0
  private repTwistPath = 0
  private repTotalPath = 0

  private dNow = 0

  constructor(opt: Partial<RepCounterOptions> = {}) {
    this.opt = { ...DEFAULT_REP_OPTIONS, ...opt }
  }

  get repCount(): number {
    return this.count
  }

  /** 当前相对静止姿态的姿态改变量（度） */
  get currentDisplacementDeg(): number {
    return this.dNow
  }

  /** 当前是否处于一次重复当中 */
  get isRepInProgress(): boolean {
    return this.armed
  }

  reset() {
    this.g = null
    this.gRef = null
    this.prevT = null
    this.count = 0
    this.peaks = []
    this.durations = []
    this.armed = false
    this.valley = 0
    this.valleyT = 0
    this.dNow = 0
  }

  /** 喂入一个样本；若本次完成了一次重复则返回事件，否则返回 null */
  push(s: SensorSample): RepEvent | null {
    if (this.prevT === null) {
      this.prevT = s.t
      const g0 = gravityFromAccel(s)
      this.g = g0
      this.gRef = g0
      return null
    }

    let dtMs = s.t - this.prevT
    this.prevT = s.t
    if (dtMs <= 0) return null
    if (dtMs > 500) {
      // 数据中断：当前姿态作为新起点，避免把两段拼成一次
      this.g = null
      this.gRef = null
      this.armed = false
      return null
    }
    if (dtMs > 100) dtMs = 100
    const dt = dtMs / 1000

    const omega: V3 = { x: s.gx, y: s.gy, z: s.gz }
    const omegaMag = Math.hypot(omega.x, omega.y, omega.z)
    const gAcc = gravityFromAccel(s)

    // --- 互补滤波：ĝ 绕 ω 旋转 dt，再向加速度计方向拉回 ---
    if (this.g === null) {
      if (!gAcc) return null
      this.g = gAcc
      this.gRef = gAcc
    } else {
      const wRad = {
        x: (omega.x * Math.PI) / 180,
        y: (omega.y * Math.PI) / 180,
        z: (omega.z * Math.PI) / 180,
      }
      const wMag = Math.hypot(wRad.x, wRad.y, wRad.z)
      let predicted: V3 = this.g
      if (wMag > 1e-6) {
        // Rodrigues：ĝ 绕 ω̂ 旋转 wMag*dt
        const k = { x: wRad.x / wMag, y: wRad.y / wMag, z: wRad.z / wMag }
        const th = wMag * dt
        const c = Math.cos(th)
        const sn = Math.sin(th)
        const kv = cross(k, this.g)
        const kd = dot(k, this.g)
        predicted = {
          x: this.g.x * c + kv.x * sn + k.x * kd * (1 - c),
          y: this.g.y * c + kv.y * sn + k.y * kd * (1 - c),
          z: this.g.z * c + kv.z * sn + k.z * kd * (1 - c),
        }
      }
      // κ=0.04/样本（50Hz 下时间常数约 0.5s）：滤掉运动线加速度，同时拉得住漂移
      const kappa = gAcc ? 0.04 : 0
      this.g = norm({
        x: predicted.x * (1 - kappa) + (gAcc ? gAcc.x * kappa : 0),
        y: predicted.y * (1 - kappa) + (gAcc ? gAcc.y * kappa : 0),
        z: predicted.z * (1 - kappa) + (gAcc ? gAcc.z * kappa : 0),
      })
    }

    if (this.gRef === null) this.gRef = this.g
    const d = angleDeg(this.g, this.gRef)
    this.dNow = d

    // --- 静止参考：只在「明显静止」时缓慢跟随；肢体离开静止就冻结 ---
    if (d <= this.opt.restFreezeDeg && omegaMag < this.opt.restOmegaDps) {
      const kr = 1 - Math.exp(-dtMs / this.opt.restTauMs)
      const r = this.gRef
      this.gRef = norm({
        x: r.x * (1 - kr) + this.g.x * kr,
        y: r.y * (1 - kr) + this.g.y * kr,
        z: r.z * (1 - kr) + this.g.z * kr,
      })
    }

    // --- 峰谷自适应状态机 ---
    if (!this.armed) {
      // 未武装：谷值跟随最低点
      if (d < this.valley || this.valleyT === 0) {
        this.valley = d
        this.valleyT = s.t
      }
      if (d - this.valley >= this.minRange()) {
        this.armed = true
        this.repValley = this.valley
        this.repPeak = d
        this.repOmega = omegaMag
        this.repTwistPath = 0
        this.repTotalPath = 0
      }
      return null
    }

    // 已武装：累积本次统计
    if (d > this.repPeak) this.repPeak = d
    if (omegaMag > this.repOmega) this.repOmega = omegaMag
    this.repTotalPath += omegaMag * dt
    this.repTwistPath += Math.abs(dot(omega, this.g)) * dt

    if (s.t - this.valleyT > this.opt.maxRepMs) {
      // 超时：当作无效，从当前点重新找谷
      this.armed = false
      this.valley = d
      this.valleyT = s.t
      return null
    }

    const fallBelow = this.repValley + this.opt.fallFrac * (this.repPeak - this.repValley)
    if (d > fallBelow) return null

    // 回落到位：本次结束
    this.armed = false
    const durationMs = s.t - this.valleyT // 从最近一次谷底算起
    const excursion = this.repPeak - this.repValley
    this.valley = d
    this.valleyT = s.t
    return this.accept(excursion, durationMs, s.t, false)
  }

  /**
   * 结束一组时结算：如果动作正在半途（已升过幅度门限但还没回落），
   * 说明用户确实做了这一次，只是记录截止在回落途中——按一次计。
   * 否则会出现「做到最后一次时按下结束，那一次凭空消失」。
   */
  flush(endMs: number): RepEvent | null {
    if (!this.armed) return null
    this.armed = false
    const excursion = this.repPeak - this.repValley
    const durationMs = endMs - this.valleyT
    this.valley = this.repPeak
    this.valleyT = endMs
    return this.accept(excursion, durationMs, endMs, true)
  }

  /** 门限判定 + 计数 */
  private accept(excursion: number, durationMs: number, endMs: number, fromFlush: boolean): RepEvent | null {
    if (durationMs < this.opt.minRepMs) return null
    if (durationMs > this.opt.maxRepMs) return null
    if (excursion < this.minRange()) return null
    if (this.repOmega < this.opt.minOmegaPeakDps) return null
    // 相对时长门限：已经数出几次后，某一次比平时慢好几倍，那是挪位置/放下，不是动作。
    // 用相对值而不是绝对上限，是为了不误杀"整组都做得很慢"的正常训练。
    if (this.durations.length >= 3) {
      const sorted = [...this.durations].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      if (durationMs > med * this.opt.durationRatioLimit) return null
    }

    this.count++
    this.peaks.push(excursion)
    this.durations.push(durationMs)
    const twistRatio = this.repTotalPath > 0 ? this.repTwistPath / this.repTotalPath : 0
    return {
      index: this.count,
      startMs: this.valleyT,
      endMs,
      durationMs,
      rangeDeg: excursion,
      peakOmegaDps: this.repOmega,
      twistRatio,
      flags: {
        shortRange: this.opt.targetPeakDeg > 0 && excursion < this.opt.targetPeakDeg * 0.7,
        momentum: !fromFlush && this.opt.targetDurationMs > 0 && durationMs < this.opt.targetDurationMs * 0.7,
        wristFlip: twistRatio > this.opt.twistRatioLimit,
      },
    }
  }

  /**
   * 幅度门限。优先取**下发的标准动作目标峰值**的 45%（0x82 里本来就有目标角度），
   * 否则用本组已计次幅度的中位数自适应——不同动作幅度差一倍以上
   * （实测侧平举约 74°、坐姿推举约 34°），写死绝对角度必然顾此失彼。
   */
  private minRange(): number {
    if (this.opt.targetPeakDeg > 0) return Math.max(12, this.opt.targetPeakDeg * 0.45)
    if (this.peaks.length >= 2) {
      const sorted = [...this.peaks].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      return Math.max(12, med * this.opt.adaptiveFloorRatio)
    }
    return this.opt.minRangeDeg
  }
}
