import type { SensorSample } from './ruleClassifier'

/**
 * 在线重复计数（rep counter）。
 *
 * ## 为什么不能用「单轴陀螺仪积分」
 *
 * `segmentMotion` 是为**离线切段**写的（录完把整段切开交给人工标注），它可以整段重算、
 * 边界可以随后续数据变化；实时计数不行——计数必须**单调递增**、只依赖已发生的样本。
 * 更要紧的是，实测线上真实数据表明单轴陀螺仪积分本身就不适合当计数信号：
 *
 *  - #2（40s 连续坐姿推举，波形周期清晰、约 19 次）：单轴积分幅度只有 30~36°，
 *    而重力方向实际变化 72.5°——**低估一半以上**；且主轴会在 gy/gx/gz 之间跳。
 *  - 干净的单次（#13/#24/#25/#26/#27/#29/#32）：重力方向变化 69~79°，高度一致。
 *  - 只是站着晃动（#201/#202）：重力方向变化 25~43°，而陀螺仪积分给出的却是「4 段」（幻影计数）。
 *
 * 结论：**「肢体到底动没动」要用重力参考的姿态回答，不是「转了多少」**。
 *
 * ## 计数信号
 *
 * 用互补滤波跟踪设备系里的重力方向单位向量 ĝ：
 *   ĝ ← normalize( ĝ 绕 ω 旋转 dt )        ← 陀螺仪，短期准、长期漂
 *   ĝ ← normalize( (1-κ)·ĝ + κ·ĝ_acc )     ← 加速度计，长期准、短期吵
 * 维护一个「静止参考方向」ĝ_ref（仅在 REST 且慢速时更新），计数标量
 *   d = angle(ĝ, ĝ_ref)
 * 即**相对静止姿态的姿态改变量**（度）。绝对、不漂移，阈值有物理含义。
 *
 * ## 状态机：以「回到静止」为计数点
 *
 * 两态 REST / MOVING：
 *   REST   → d ≥ enterDeg 时进入 MOVING，记下起点
 *   MOVING → d ≤ exitDeg（迟滞）时本次结束；峰值幅度 / 角速度 / 时长都达标才 +1
 * 这就是「以停止为标准、内部半次、界面整数」的落地。
 *
 * 注意**不能**用「位移量迟滞 + 窗口自适应阈值」：那样参考方向会在动作上升段被拖着走，
 * 位移量永远长不到真实幅度（实测把 74° 的真实幅度压成 38°）。
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
  rangeDeg: number // 本次姿态改变峰值（度）
  peakOmegaDps: number // 本次角速度峰值
  twistRatio: number // 绕重力轴扭转占总转动的比例
  flags: RepFlags
}

export interface RepCounterOptions {
  /** 离开静止的门槛（度）：姿态改变超过它即认为开始一次动作 */
  enterDeg: number
  /** 回到静止的门槛（度）：低于它则本次动作结束（与 enterDeg 构成迟滞） */
  exitDeg: number
  /** 幅度门限（度）：峰值小于它不计次（无目标、又还没建立基线时使用） */
  minRangeDeg: number
  /** 角速度峰值门限（°/s） */
  minOmegaPeakDps: number
  /** 不应期（ms） */
  minRepMs: number
  /** 单次最长时间（ms） */
  maxRepMs: number
  /** 静止参考更新的角速度门槛（°/s） */
  restOmegaDps: number
  /** 静止参考更新的时间常数（ms） */
  restTauMs: number
  /** 期望幅度（度），0 = 未知 */
  targetPeakDeg: number
  /** 期望单次时长（ms），0 = 未知 */
  targetDurationMs: number
  /** 扭转占比超过它判为腕翻转 */
  twistRatioLimit: number
  /** 自适应基线的建立方式：取已计次幅度中位数的该倍数作为门限 */
  adaptiveFloorRatio: number
}

export const DEFAULT_REP_OPTIONS: RepCounterOptions = {
  enterDeg: 14,
  exitDeg: 8,
  minRangeDeg: 30,
  minOmegaPeakDps: 40,
  minRepMs: 700,
  maxRepMs: 15000,
  restOmegaDps: 40,
  restTauMs: 800,
  targetPeakDeg: 0,
  targetDurationMs: 0,
  twistRatioLimit: 0.25,
  adaptiveFloorRatio: 0.5,
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
/** 单位向量夹角（度） */
const angleDeg = (a: V3, b: V3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI

/** 加速度计重力方向（设备系单位向量）；模长离开 1g 太多说明线加速度污染严重，返回 null */
function gravityFromAccel(s: SensorSample): V3 | null {
  const m = Math.hypot(s.ax, s.ay, s.az)
  if (m < 0.55 || m > 1.6) return null
  return { x: s.ax / m, y: s.ay / m, z: s.az / m }
}

export class RepCounter {
  private opt: RepCounterOptions

  private g: V3 | null = null // 互补滤波后的重力方向（设备系）
  private gRef: V3 | null = null // 静止参考方向
  private prevT: number | null = null

  private count = 0
  private moving = false
  private repStart = 0
  private repPeak = 0
  private repOmega = 0
  private repTwistPath = 0
  private repTotalPath = 0
  private peaks: number[] = []
  private dNow = 0

  constructor(opt: Partial<RepCounterOptions> = {}) {
    this.opt = { ...DEFAULT_REP_OPTIONS, ...opt }
  }

  get repCount(): number {
    return this.count
  }

  /** 当前相对静止姿态的姿态改变量（度），供 UI 显示实时幅度 */
  get currentDisplacementDeg(): number {
    return this.dNow
  }

  get isMoving(): boolean {
    return this.moving
  }

  reset() {
    this.g = null
    this.gRef = null
    this.prevT = null
    this.count = 0
    this.moving = false
    this.repOmega = 0
    this.repTwistPath = 0
    this.repTotalPath = 0
    this.peaks = []
    this.dNow = 0
  }

  /** 喂入一个样本；若本次完成了一次重复则返回事件，否则返回 null */
  push(s: SensorSample): RepEvent | null {
    if (this.prevT === null) {
      this.prevT = s.t
      const g0 = gravityFromAccel(s)
      if (g0) {
        this.g = g0
        this.gRef = g0
      }
      return null
    }

    let dtMs = s.t - this.prevT
    this.prevT = s.t
    if (dtMs <= 0) return null
    if (dtMs > 500) {
      // 数据中断：当前姿态作为新起点，避免把两段拼成一次
      this.g = null
      this.gRef = null
      this.moving = false
      return null
    }
    if (dtMs > 100) dtMs = 100
    const dt = dtMs / 1000

    const omega: V3 = { x: s.gx, y: s.gy, z: s.gz } // °/s
    const omegaMag = Math.hypot(omega.x, omega.y, omega.z)
    const gAcc = gravityFromAccel(s)

    // --- 互补滤波 ---
    if (this.g === null) {
      if (!gAcc) return null
      this.g = gAcc
      this.gRef = gAcc
    } else {
      const wRad = { x: (omega.x * Math.PI) / 180, y: (omega.y * Math.PI) / 180, z: (omega.z * Math.PI) / 180 }
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

    const d = angleDeg(this.g, this.gRef as V3)
    this.dNow = d

    // --- 两态状态机 ---
    if (!this.moving) {
      // REST：静止参考只在慢速时缓慢跟随真实静止姿态
      if (omegaMag < this.opt.restOmegaDps) {
        const kr = 1 - Math.exp(-dtMs / this.opt.restTauMs)
        const r = this.gRef as V3
        this.gRef = norm({
          x: r.x * (1 - kr) + this.g.x * kr,
          y: r.y * (1 - kr) + this.g.y * kr,
          z: r.z * (1 - kr) + this.g.z * kr,
        })
      }
      if (d >= this.opt.enterDeg) {
        this.moving = true
        this.repStart = s.t
        this.repPeak = d
        this.repOmega = omegaMag
        this.repTwistPath = 0
        this.repTotalPath = 0
      }
      return null
    }

    // MOVING
    if (d > this.repPeak) this.repPeak = d
    if (omegaMag > this.repOmega) this.repOmega = omegaMag
    this.repTotalPath += omegaMag * dt
    this.repTwistPath += Math.abs(dot(omega, this.g)) * dt

    if (s.t - this.repStart > this.opt.maxRepMs) {
      this.moving = false
      return null
    }
    if (d > this.opt.exitDeg) return null

    // 回到静止：本次结束
    this.moving = false
    const durationMs = s.t - this.repStart
    const peak = this.repPeak
    if (durationMs < this.opt.minRepMs) return null
    if (peak < this.minRange()) return null
    if (this.repOmega < this.opt.minOmegaPeakDps) return null

    this.count++
    this.peaks.push(peak)
    const twistRatio = this.repTotalPath > 0 ? this.repTwistPath / this.repTotalPath : 0
    return {
      index: this.count,
      startMs: this.repStart,
      endMs: s.t,
      durationMs,
      rangeDeg: peak,
      peakOmegaDps: this.repOmega,
      twistRatio,
      flags: {
        shortRange: this.opt.targetPeakDeg > 0 && peak < this.opt.targetPeakDeg * 0.7,
        momentum: this.opt.targetDurationMs > 0 && durationMs < this.opt.targetDurationMs * 0.7,
        wristFlip: twistRatio > this.opt.twistRatioLimit,
      },
    }
  }

  /**
   * 幅度门限。优先取**下发的标准动作目标峰值**的 45%（0x82 里本来就有目标角度），
   * 否则用本次会话已计次幅度的中位数自适应——因为不同动作幅度差一倍以上
   * （实测侧平举约 74°、坐姿推举约 36°），写死绝对角度必然顾此失彼。
   */
  private minRange(): number {
    if (this.opt.targetPeakDeg > 0) return Math.max(15, this.opt.targetPeakDeg * 0.45)
    if (this.peaks.length >= 2) {
      const sorted = [...this.peaks].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      return Math.max(15, med * this.opt.adaptiveFloorRatio)
    }
    return this.opt.minRangeDeg
  }
}
