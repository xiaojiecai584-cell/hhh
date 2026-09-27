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
  /**
   * 计数信号。
   *  - `gravity`：相对静止姿态的重力方向改变量。适合整个肢体在重力垂直面内翻转的动作
   *    （如站姿侧平举），实测单次识别率 77.5%。
   *  - `gyro`：角速度模长包络。适合「只有近端关节在动、末端姿态几乎不变」的动作。
   *    实测坐姿推举漏检 90/124，漏检样本的重力方向改变量中位数只有 8.4°（门限 20°），
   *    而角速度峰值中位 58°/s 是够的——推举时前臂保持竖直，手腕姿态几乎不变。
   */
  signal: 'gravity' | 'gyro'
  /** gyro 信号：角速度模长的平滑时间常数（ms）。用于**回落判定**，抑制顶点处的角速度回落
   *  被误当成一次结束。不要用于武装判定——重平滑会把短促爆发削到门限以下。 */
  omegaTauMs: number
  /**
   * 回落必须持续多久（ms）才算一次结束。
   * 顶点的短暂停顿会让角速度瞬间掉到阈值以下，若立刻计数就会把一次重复算成两次
   * （实测 #25 单次侧平举被算成 2 次）。要求回落持续一段时间即可排除。
   */
  fallHoldMs: number
  /**
   * 回落判定还要看姿态是否真的下来了（`d <= fallTiltRatio × 本次 d 的峰值`）。
   *
   * 为什么必须加这一条：**角速度模长无法区分「顶点停顿」和「底部休息」**——
   * 两处手臂都接近静止。只用 |ω| 时，要么把顶点停顿算成一次结束（一次算成两次），
   * 要么为避免它就要求回落很深，于是连续做、不完整放回、做得快时全被并成一次
   * （合成测试：12 次分别只数出 4 / 4 / 1 次）。
   * 而重力方向能区分：顶点时 d 最大，底部时 d≈0。两者结合才成立。
   */
  fallTiltRatio: number
  /** 本次 d 的峰值低于它时，跳过上面的姿态判定（某些佩戴方式下 d 变化太小） */
  fallTiltMinDeg: number

  // ---------- ① 自适应噪声底 ----------
  /**
   * 武装门限不再写死成绝对值，而是跟着**这个人当前环境下的静息角速度**走：
   *   gate = clamp(静息水平 × noiseFloorRatio, omegaGateFloor, omegaGateMax)
   *
   * 为什么必须这样：实测"轻轻晃动"的 |ω| 上限是 28°/s，而漏检的那批小幅度
   * 非标准动作 |ω| 中位也是 28°/s —— **两组样本在绝对角速度上完全重叠**，
   * 一个全局常数不可能同时满足"滤掉晃动"和"数出小幅度动作"。
   * 换成相对门限后：手稳的人（静息 5°/s）门限降到 18，小幅度动作能被数出；
   * 手抖的人（静息 15°/s）门限升到 37，晃动不会被计入。
   */
  noiseFloorRatio: number
  /** 门限下限（°/s）：再稳的人也不低于它 */
  omegaGateFloor: number
  /** 门限上限（°/s）：再抖的人也不高于它 */
  omegaGateMax: number
  /**
   * **候选武装**门限（°/s）：只要有这点动静就开始跟踪一次候选重复，
   * 真正是否算数留到结束时判定（角速度门限 或 模板形状）。
   *
   * 为什么必须分离：早先用「接受门限」当武装门限，ωmax 只有 16–28°/s 的
   * 小幅度非标准动作**根本进不了判定流程**，模板匹配也就无从发挥
   * （实测 9 条漏检里有 6 条卡在这里，拒因显示"从没武装过"）。
   */
  armOmegaDps: number
  /** 估计静息水平的窗口（ms） */
  noiseWindowMs: number
  /** 静息水平取窗口内的该分位数（低分位，避开动作本身） */
  noisePercentile: number

  // ---------- ② 模板形状匹配 ----------
  /**
   * 动作主轴的形状模板（来自后端 `build-templates` 的产物，见 motionTemplates.ts）。
   * 非标准动作常常幅度不达标但**形状仍与标准动作相似**；归一化后求相关，
   * 相关度高就认这一次——这是单纯调幅度门限做不到的。
   */
  template?: number[]
  /** 模板对应哪条轴（后端 actions 注册表：坐姿推举 gy、站姿侧平举 gx） */
  templateAxis?: 'gx' | 'gy' | 'gz'
  /** 归一化相关系数超过它，即使幅度门限没过也算一次 */
  templateMinCorr: number
  /** 参与相关计算的最少采样点数 */
  templateMinSamples: number
}

export const DEFAULT_REP_OPTIONS: RepCounterOptions = {
  restFreezeDeg: 10,
  restOmegaDps: 40,
  restTauMs: 800,
  minRangeDeg: 20,
  minOmegaPeakDps: 30,
  fallFrac: 0.45,
  minRepMs: 700,
  maxRepMs: 15000,
  targetPeakDeg: 0,
  targetDurationMs: 0,
  twistRatioLimit: 0.25,
  adaptiveFloorRatio: 0.6,
  durationRatioLimit: 3,
  // 默认用 gyro：实测单次识别率明显更好（scripts/diagnose-counter.mjs）
  // 关键在 omegaTauMs=250（更强的低通，抑制顶点处的角速度回落）与 fallFrac=0.25（回落要求更彻底）
  // 组合效果：坐姿推举 26.6%→67.3%，站姿侧平举 70.8%→86.2%（仅计"应当计数"的样本）
  signal: 'gyro',
  omegaTauMs: 250,
  fallHoldMs: 260,
  fallTiltRatio: 0.45,
  fallTiltMinDeg: 8,
  noiseFloorRatio: 3,
  /**
   * 门限下限（°/s）。**故意不低于绝对门限**：实测把门限降到 22 时，
   * 合成测试里峰值 25°/s 的"轻轻晃动"被数出 9 次——**晃动与小幅动作在 |ω| 上真的不可分**。
   * 所以自适应只允许**往上调**（应对手抖的人），不允许往下调。
   */
  omegaGateFloor: 30,
  omegaGateMax: 80,
  armOmegaDps: 12,
  noiseWindowMs: 5000,
  noisePercentile: 0.2,
  templateMinCorr: 0.6,
  templateMinSamples: 24,
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
  /** 角速度模长的平滑值（gyro 信号用），抑制单点尖峰 */
  private omegaSmooth = 0
  /** 本次重复中「指标已回落到阈值以下」的起始时刻，0 = 未回落 */
  private fallStartT = 0
  private lastReject: string | null = null
  private rejects: Record<string, number> = {}
  /** 最近一段时间的原始角速度模长，用于估计静息水平 */
  private omegaRing: number[] = []
  private omegaRingCap: number
  /** 本次重复期间主轴采样（用于模板形状匹配） */
  private repAxis: number[] = []
  /** 本次重复是靠门限过的还是靠模板形状过的 */
  private lastMatchedBy: 'gate' | 'template' | null = null
  private lastCorr: number | null = null

  private reject(reason: string): null {
    this.lastReject = reason
    this.rejects[reason] = (this.rejects[reason] ?? 0) + 1
    return null
  }

  // 当前这次重复
  private armed = false
  private valley = 0
  private valleyT = 0
  private repPeak = 0
  private repValley = 0
  /** 本次重复内 d（姿态改变量）的峰值，用于区分「顶点停顿」与「底部休息」 */
  private repPeakD = 0
  private repOmega = 0
  private repTwistPath = 0
  private repTotalPath = 0

  private dNow = 0

  constructor(opt: Partial<RepCounterOptions> = {}) {
    this.opt = { ...DEFAULT_REP_OPTIONS, ...opt }
    this.omegaRingCap = Math.max(20, Math.round(this.opt.noiseWindowMs / 20))
  }

  /** 各类拒因的累计次数 */
  get rejectCounts(): Record<string, number> {
    return { ...this.rejects }
  }

  /** 当前静息角速度估计（°/s）；样本不足时返回 null */
  get noiseFloor(): number | null {
    if (this.omegaRing.length < 60) return null
    const sorted = [...this.omegaRing].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * this.opt.noisePercentile))]
  }

  /** 当前实际使用的武装门限（°/s） */
  get omegaGate(): number {
    const floor = this.noiseFloor
    if (floor === null) return this.opt.minOmegaPeakDps
    return Math.min(this.opt.omegaGateMax, Math.max(this.opt.omegaGateFloor, floor * this.opt.noiseFloorRatio))
  }

  /** 最近一次计数的通过方式 */
  get lastMatchedByGate(): boolean {
    return this.lastMatchedBy === 'gate'
  }

  get repCount(): number {
    return this.count
  }

  /** 当前相对静止姿态的姿态改变量（度） */
  get currentDisplacementDeg(): number {
    return this.dNow
  }

  /** 当前用于计数的标量（gravity=姿态改变量，gyro=平滑后的角速度模长） */
  get currentMetric(): number {
    return this.opt.signal === 'gyro' ? this.omegaSmooth : this.dNow
  }

  /** 最近一次「本该计数但被拒」的原因，供现场排查与离线诊断 */
  get lastRejectReason(): string | null {
    return this.lastReject
  }

  /** 最近一次拒绝时算出的模板相关系数（诊断用） */
  get lastCorrelation(): number | null {
    return this.lastCorr
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
    this.omegaSmooth = 0
    this.omegaRing = []
    this.repAxis = []
    this.lastMatchedBy = null
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
    // 角速度模长的低通：单点尖峰不应该被当成一次动作
    const ko = 1 - Math.exp(-dtMs / this.opt.omegaTauMs)
    this.omegaSmooth += (omegaMag - this.omegaSmooth) * ko

    // 计数标量：gravity 用姿态改变量，gyro 用角速度模长包络
    const metric = this.opt.signal === 'gyro' ? this.omegaSmooth : d

    // 静息水平估计（用于自适应武装门限）。
    // 只在**安静**时取样：用「低于候选武装门限」定义安静，与武装判据自洽。
    // 早先用「!armed」定义，但候选武装门限很低、几乎立刻武装，窗口永远填不满，
    // 自适应门限实际失效（实测静息水平一直显示"未知"）。
    if (omegaMag < this.opt.armOmegaDps) {
      this.omegaRing.push(omegaMag)
      if (this.omegaRing.length > this.omegaRingCap) this.omegaRing.shift()
    }

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

    // --- 峰谷自适应状态机（标量 metric：gravity=姿态改变量，gyro=角速度模长） ---
    if (!this.armed) {
      // 未武装：谷值跟随最低点
      if (metric < this.valley || this.valleyT === 0) {
        this.valley = metric
        this.valleyT = s.t
      }
      // 武装条件：
      //  · gyro：原始角速度绝对值越限即可。绝对门限本身就是"真动 vs 晃动"的判据
      //    （实测晃动 |ω|≤28、真实重复 ≥50），再叠"平滑值必须爬升 25"会误杀短促爆发。
      //  · gravity：姿态改变量超过门限。
      const armed =
        this.opt.signal === 'gyro'
          ? omegaMag >= this.opt.armOmegaDps
          : metric - this.valley >= this.minRange()
      if (armed) {
        this.armed = true
        this.repValley = this.valley
        this.repPeak = metric
        this.repPeakD = d
        this.repOmega = omegaMag
        this.repTwistPath = 0
        this.repTotalPath = 0
        this.repAxis = this.opt.templateAxis ? [s[this.opt.templateAxis]] : []
      }
      return null
    }

    // 已武装：累积本次统计（repPeak 记平滑值的峰，用于回落判定；repOmega 记原始峰值，用于门限）
    if (metric > this.repPeak) this.repPeak = metric
    if (omegaMag > this.repOmega) this.repOmega = omegaMag
    if (d > this.repPeakD) this.repPeakD = d
    if (this.opt.templateAxis) this.repAxis.push(s[this.opt.templateAxis])
    this.repTotalPath += omegaMag * dt
    this.repTwistPath += Math.abs(dot(omega, this.g)) * dt

    if (s.t - this.valleyT > this.opt.maxRepMs) {
      // 超时：当作无效，从当前点重新找谷
      this.armed = false
      this.valley = metric
      this.valleyT = s.t
      return null
    }

    const fallBelow = this.repValley + this.opt.fallFrac * (this.repPeak - this.repValley)
    // 姿态也要回到低位：顶点停顿与底部休息在 |ω| 上看起来一样，
    // 但顶点时 d 处于本次峰值附近，底部时 d 很小
    const tiltOk = this.repPeakD < this.opt.fallTiltMinDeg || d <= this.opt.fallTiltRatio * this.repPeakD
    if (metric > fallBelow || !tiltOk) {
      this.fallStartT = 0 // 又抬起来了：重新计时
      return null
    }
    // 回落必须持续一段时间，排除顶点的短暂停顿
    if (this.fallStartT === 0) {
      this.fallStartT = s.t
      return null
    }
    if (s.t - this.fallStartT < this.opt.fallHoldMs) return null

    // 回落到位：本次结束
    this.armed = false
    this.fallStartT = 0
    const startMs = this.valleyT // 先取起点，之后再更新 valleyT
    const durationMs = s.t - startMs
    const excursion = this.repPeak - this.repValley
    this.valley = metric
    this.valleyT = s.t
    return this.accept(excursion, durationMs, startMs, s.t, false)
  }

  /**
   * 结束一组时结算：如果动作正在半途（已升过幅度门限但还没回落），
   * 说明用户确实做了这一次，只是记录截止在回落途中——按一次计。
   * 否则会出现「做到最后一次时按下结束，那一次凭空消失」。
   */
  flush(endMs: number): RepEvent | null {
    if (!this.armed) return null
    this.armed = false
    const startMs = this.valleyT
    const excursion = this.repPeak - this.repValley
    const durationMs = endMs - startMs
    this.valley = this.repPeak
    this.valleyT = endMs
    return this.accept(excursion, durationMs, startMs, endMs, true)
  }

  /**
   * 门限判定 + 计数。
   * `startMs`/`endMs` 必须由调用方显式传入——早先这里读的是 `this.valleyT`，
   * 而调用前它已被更新为本次结束时刻，导致返回的事件 `startMs === endMs`，
   * 按时间切样本时每次只切到 1 个点，报告链路因此永远拿不到可用样本。
   */
  private accept(
    excursion: number,
    durationMs: number,
    startMs: number,
    endMs: number,
    fromFlush: boolean,
  ): RepEvent | null {
    if (durationMs < this.opt.minRepMs) return this.reject('too_short')
    if (durationMs > this.opt.maxRepMs) return this.reject('too_long')

    // 门限判定：用**自适应门限**（跟随本人静息水平），不是全局常数
    const gate = this.omegaGate
    const gateOk =
      this.opt.signal === 'gyro'
        ? this.repOmega >= gate
        : excursion >= this.minRange() && this.repOmega >= gate
    // ② 形状第二判据：幅度不达标，但主轴波形与标准动作模板高度相关 → 也算一次。
    //    非标准动作（幅度不足、轨迹不稳）常常形状仍对，这是单纯调门限救不回来的。
    const corr = gateOk ? null : this.templateCorrelation()
    this.lastCorr = corr
    const shapeOk = corr !== null && corr >= this.opt.templateMinCorr
    if (!gateOk && !shapeOk) return this.reject('below_gate')
    this.lastMatchedBy = gateOk ? 'gate' : 'template'

    // 相对时长门限：已经数出几次后，某一次比平时慢好几倍，那是挪位置/放下，不是动作。
    // 用相对值而不是绝对上限，是为了不误杀"整组都做得很慢"的正常训练。
    if (this.durations.length >= 3) {
      const sorted = [...this.durations].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      if (durationMs > med * this.opt.durationRatioLimit) return this.reject('duration_outlier')
    }

    this.count++
    this.lastReject = null
    this.peaks.push(excursion)
    this.durations.push(durationMs)
    const twistRatio = this.repTotalPath > 0 ? this.repTwistPath / this.repTotalPath : 0
    return {
      index: this.count,
      startMs,
      endMs,
      durationMs,
      rangeDeg: excursion,
      peakOmegaDps: this.repOmega,
      twistRatio,
      flags: {
        // 幅度不足/借力两个标志依赖「目标幅度」，只在 gravity 信号下有意义
        //（gyro 信号的 excursion 是角速度幅度，量纲不同，不能直接比）
        shortRange: this.opt.signal === 'gravity' && this.opt.targetPeakDeg > 0 && excursion < this.opt.targetPeakDeg * 0.7,
        momentum:
          !fromFlush &&
          this.opt.signal === 'gravity' &&
          this.opt.targetPeakDeg > 0 &&
          excursion > this.opt.targetPeakDeg * 1.35,
        wristFlip: twistRatio > this.opt.twistRatioLimit,
      },
    }
  }

  /**
   * 本次重复的主轴波形与动作模板的归一化相关系数。
   * 取绝对值：左右佩戴/轴向相反时相关为负，但形状依然是对的。
   * 返回 null 表示样本不够或没有模板。
   */
  private templateCorrelation(): number | null {
    const tpl = this.opt.template
    if (!tpl || tpl.length < 8) return null
    const src = this.repAxis
    if (src.length < this.opt.templateMinSamples) return null

    // 线性重采样到模板长度
    const n = tpl.length
    const resampled: number[] = []
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1)) * (src.length - 1)
      const i0 = Math.floor(p)
      const i1 = Math.min(src.length - 1, i0 + 1)
      const f = p - i0
      resampled.push(src[i0] * (1 - f) + src[i1] * f)
    }

    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    const ma = mean(resampled)
    const mb = mean(tpl)
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < n; i++) {
      const x = resampled[i] - ma
      const y = tpl[i] - mb
      num += x * y
      da += x * x
      db += y * y
    }
    if (da <= 0 || db <= 0) return null
    return Math.abs(num / Math.sqrt(da * db))
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
