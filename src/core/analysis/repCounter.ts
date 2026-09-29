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
  signal: 'gravity' | 'gyro' | 'accel'
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
  /**
   * 直线度下限 = 姿态净位移 / 路径长度 `∫|ω|dt`。**默认关闭**。
   *
   * 动机：干净的一次重复是"转过去再转回来"，净位移与路径同量级；随手晃动来回乱转，
   * 净位移被方向反复抵消，比值极低。实测（213 条真实单次样本 + 晃动对照）：
   *   真实重复   中位 0.28~0.31（坐姿推举 0.28 / 站姿侧平举 0.31）
   *   随手晃动   0.064 / 0.114
   *
   * **但实测把它当硬门限得不偿失**：真实动作的下尾（p25=0.15）与晃动上界（0.114）
   * 太近，卡在 0.15 会砍掉约四分之一的真动作——
   *   当前默认              坐姿推举 87.1% / 站姿侧平举 96.6%
   *   门限降到 22 + 直线度0.15   75.0% / 91.0%
   *   门限 26 + 直线度0.18      67.7% / 83.1%
   * 所以这个量更适合当**置信度/辅助特征**（将来喂给小模型），不适合当硬判据。
   * 保留该开关是为了让「降门限 + 直线度守卫」这条路可复现，默认 0 = 不启用。
   */
  minStraightness: number

  // ---------- ③ 加速度信号（传感器装在哑铃上时适用） ----------
  /**
   * 用「竖直位移」当计数标量。适用前提：**传感器装在哑铃/器械上**。
   *
   * 为什么它比角速度更合适：做推举时哑铃手柄接近水平、只做竖直平移，几乎不旋转。
   * 实测（213 条真实样本 + 晃动对照，中位数）：
   *   陀螺仪峰值  推举 68.4°/s vs 晃动 28.3    →  2.4 倍
   *   位移峰峰值  推举 0.303m  vs 晃动 0.020m  → 14.8 倍
   * 而且它天然解决「顶点停顿被算成两次」——顶点时位移在最高处，
   * 「回落」要求位移回到起点附近，停顿不会满足。
   */
  /** 竖直方向一次重复必须移动的最小距离（米） */
  minTravelM: number
  /** 静止判定：|竖直加速度| 小于它且角速度低于 restOmegaDps，视为静止（用于零速修正） */
  quietAccelG: number
  /** 静止时速度向 0 收敛的系数（在线零速修正，抑制积分漂移） */
  zuptLeak: number
  /** 位移静息参考的跟随时间常数（ms） */
  travelRefTauMs: number
  /**
   * 用位移判「回落」的比例：`本次位移 ≤ fallTravelRatio × 本次位移峰值`。
   *
   * 这是给 gyro 信号用的第二道回落判据。原因：推举时传感器（装在哑铃上）
   * 几乎不旋转，`d` 判据失效（实测 d 中位仅 4.6°，低于 fallTiltMinDeg 而被跳过），
   * 于是「顶点停顿」被当成一次结束 → 一次重复被切成两次（实测 9/124 条）。
   * 位移能补上这一点：顶点时位移在最高处，回落要求位移回到起点附近。
   * 实测仅用位移当唯一判据时多计从 9 降到 1，说明它确实抓得住这个区别。
   * 设为 0 表示不启用。
   */
  fallTravelRatio: number
  /**
   * **重新武装所需的位移上升量**（米）。给 gyro 信号用。
   *
   * 为什么必须加：原来的武装只看角速度（≥12°/s），而下放全程角速度都高于它，
   * 于是一次重复的「上举」算一次、「下放」又算一次（实测 7/124 条）。
   * 加这条后，必须看到"哑铃从低处重新升起来"才算新的一次——
   * 下放时位移在减小，不会被误判为新重复。
   *
   * 若位移信号不可用（传感器不随器械平移，maxAbsTravel 极小）则自动不启用，
   * 避免在没有平移的动作上把计数卡死。设为 0 显式关闭。
   *
   * **当前默认 0（关闭）**：实测它会严重破坏连续做的情况——合成连续组里
   * 「不停顿」12→6、「不完整放回」11→1、「做得快」12→6。
   * 原因是「位移是否可用」的判据（maxAbsTravel < 0.05）太脆弱：合成信号没有真实
   * 竖直平移，位移靠积分噪声偶尔越过阈值，守卫就被误激活把计数卡死。
   * 要安全启用它，必须先拿到**真实的连续整组数据**来验证，否则不动。
   */
  armTravelM: number
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
  /** 直线度守卫：默认关闭（0），实测确认后再启用——见 options 里的说明 */
  minStraightness: 0,
  minTravelM: 0.08,
  quietAccelG: 0.03,
  zuptLeak: 0.85,
  travelRefTauMs: 2000,
  /**
   * 启用位移回落判据。默认 0.45（与 fallFrac/fallTiltRatio 同量级）。
   * 实测效果见提交说明——这是修「一次被切成两次」的关键。
   */
  fallTravelRatio: 0.45,
  armTravelM: 0,
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

/**
 * 归一化相关系数（取绝对值，容忍轴向相反）。
 * 先把 `src` 线性重采样到模板长度，再各自去均值求皮尔逊相关。
 * 返回 null 表示样本不足或方差为零。
 */
function correlate(src: number[], tpl: number[], minSamples: number): number | null {
  if (src.length < minSamples || tpl.length < 8) return null
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
  /** 本次重复期间三条轴的采样（用于模板形状匹配） */
  private repAxes: Record<'gx' | 'gy' | 'gz', number[]> = { gx: [], gy: [], gz: [] }
  /** 本次重复是靠门限过的还是靠模板形状过的 */
  private lastMatchedBy: 'gate' | 'template' | null = null
  private lastCorr: number | null = null
  /** 形状匹配实际用的轴与相关值（诊断用） */
  private lastCorrAxis: 'gx' | 'gy' | 'gz' | null = null
  /** 竖直方向的速度与位移（accel 信号用），以及位移的静息参考 */
  private vVert = 0
  private xVert = 0
  private xRef = 0
  private xRefInit = false
  /** 本次重复之间位移的谷值（用于要求"重新升起来"才武装） */
  private travelValley = 0
  /** 迄今见过的最大位移绝对值：判断位移信号是否可用 */
  private maxAbsTravel = 0
  /** 最近一次重复的路径长度与净位移（诊断/研究用） */
  private lastPath: number | null = null
  private lastDisplacement = 0
  /** 本次重复开始时的 d，用于算净位移 */
  private repValleyD = 0

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
  /** 本次重复内竖直位移的峰值（米），用于位移版的回落判定 */
  private repPeakTravel = 0
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

  /**
   * 最近一次重复的两个积分量（诊断/研究用）：
   *  · path        —— `∫|ω|dt`，路径长度（一共转了多少度，不管方向）
   *  · displacement—— 姿态净位移（起点到终点的夹角）
   * 两者之比「直线度」：干净的重复 ≈0.5（转过去再转回来），随手晃动远小于它。
   */
  get lastRepKinematics(): { path: number; displacement: number; straightness: number } | null {
    if (this.lastPath === null) return null
    const straightness = this.lastPath > 0 ? this.lastDisplacement / this.lastPath : 0
    return { path: this.lastPath, displacement: this.lastDisplacement, straightness }
  }

  /** 形状匹配实际用的轴（诊断用） */
  get lastCorrelationAxis(): 'gx' | 'gy' | 'gz' | null {
    return this.lastCorrAxis
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
    this.repAxes = { gx: [], gy: [], gz: [] }
    this.lastMatchedBy = null
    this.lastCorrAxis = null
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

    // ---------- ③ 竖直加速度积分：v = ∫a_vert，x = ∫v（在线零速修正）----------
    // a_vert = a·ĝ − 1g，ĝ 就是上面互补滤波得到的单位重力方向
    const aVert = dot({ x: s.ax, y: s.ay, z: s.az }, this.g) - 1
    const quiet = Math.abs(aVert) < this.opt.quietAccelG && omegaMag < this.opt.restOmegaDps
    if (quiet) this.vVert *= this.opt.zuptLeak // 静止时把速度往 0 拉，抑制积分漂移
    this.vVert += aVert * 9.80665 * dt
    this.xVert += this.vVert * dt
    if (!this.xRefInit) {
      this.xRef = this.xVert
      this.xRefInit = true
    } else if (quiet) {
      const kr = 1 - Math.exp(-dtMs / this.opt.travelRefTauMs)
      this.xRef += (this.xVert - this.xRef) * kr
    }
    /** 相对静息高度的竖直位移（米） */
    const travel = this.xVert - this.xRef
    if (travel < this.travelValley) this.travelValley = travel
    if (Math.abs(travel) > this.maxAbsTravel) this.maxAbsTravel = Math.abs(travel)

    // 计数标量：gravity 用姿态改变量，gyro 用角速度模长包络，accel 用竖直位移
    const metric =
      this.opt.signal === 'gyro' ? this.omegaSmooth : this.opt.signal === 'accel' ? travel : d

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
      // 位移上升条件：必须看到"哑铃从低处重新升起来"才算新的一次，
      // 否则一次重复的「下放」半程会被当成第二次（实测 7/124 条）。
      // 位移信号不可用（传感器不随器械平移）时自动跳过，避免把计数卡死。
      const travelRise =
        this.opt.armTravelM <= 0 || this.maxAbsTravel < 0.05 || travel - this.travelValley >= this.opt.armTravelM
      const armed =
        this.opt.signal === 'gyro'
          ? omegaMag >= this.opt.armOmegaDps && travelRise
          : this.opt.signal === 'accel'
            ? metric - this.valley >= this.opt.minTravelM
            : metric - this.valley >= this.minRange()
      if (armed) {
        this.armed = true
        this.repValley = this.valley
        this.repPeak = metric
        this.repPeakD = d
        this.repValleyD = d
        this.repPeakTravel = travel
        this.repOmega = omegaMag
        this.repTwistPath = 0
        this.repTotalPath = 0
        this.repAxes = { gx: [s.gx], gy: [s.gy], gz: [s.gz] }
      }
      return null
    }

    // 已武装：累积本次统计（repPeak 记平滑值的峰，用于回落判定；repOmega 记原始峰值，用于门限）
    if (metric > this.repPeak) this.repPeak = metric
    if (omegaMag > this.repOmega) this.repOmega = omegaMag
    if (d > this.repPeakD) this.repPeakD = d
    if (travel > this.repPeakTravel) this.repPeakTravel = travel
    this.repAxes.gx.push(s.gx)
    this.repAxes.gy.push(s.gy)
    this.repAxes.gz.push(s.gz)
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
    // 姿态回落判据：gyro/gravity 信号下用于区分「顶点停顿」与「底部休息」。
    const tiltOk =
      this.opt.signal === 'accel' ||
      this.repPeakD < this.opt.fallTiltMinDeg ||
      d <= this.opt.fallTiltRatio * this.repPeakD
    // 位移回落判据：给 gyro 信号补上的第二道。传感器装在哑铃上时推举几乎不旋转，
    // 上面那条 d 判据会因 repPeakD < fallTiltMinDeg 而跳过，于是顶点停顿被当成一次结束
    // （实测 9/124 条一次被切成两次）。位移是位置量，顶点时在最高处、回落要求回到起点附近。
    const travelOk =
      this.opt.fallTravelRatio <= 0 ||
      this.repPeakTravel <= 0 ||
      travel <= this.opt.fallTravelRatio * this.repPeakTravel
    if (metric > fallBelow || !tiltOk || !travelOk) {
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
    // 记录本次的积分量，供诊断（不论通过与否）
    this.lastPath = this.repTotalPath
    this.lastDisplacement = this.repPeakD - this.repValleyD

    if (durationMs < this.opt.minRepMs) return this.reject('too_short')
    if (durationMs > this.opt.maxRepMs) return this.reject('too_long')

    // 直线度守卫：净位移 / 路径长度。晃动来回乱转，比值极低；
    // 干净的一次重复"转过去再转回来"，比值在 0.3 量级。启用后可把幅度门限降下来。
    if (this.opt.minStraightness > 0) {
      const straightness = this.repTotalPath > 0 ? (this.repPeakD - this.repValleyD) / this.repTotalPath : 0
      if (straightness < this.opt.minStraightness) return this.reject('low_straightness')
    }

    // 门限判定：用**自适应门限**（跟随本人静息水平），不是全局常数
    const gate = this.omegaGate
    const gateOk =
      this.opt.signal === 'gyro'
        ? this.repOmega >= gate
        : this.opt.signal === 'accel'
          ? excursion >= this.opt.minTravelM
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
    this.travelValley = 0 // 本次结束：位移谷值重新开始累积
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
   * 本次重复的波形与动作模板的**最大**归一化相关系数（三条轴各算一次取最大）。
   *
   * 为什么不是只用 templateAxis：实测后端声明的主轴与数据严重不符——
   *   坐姿推举 声明 gy，实际方差最大是 gy 的只占 17%（gx 44%、gz 40%）
   *   站姿侧平举 声明 gx，实际是 gx 的占 0%（gy 63%、gz 37%）
   * 结果模板虽然按 gx 建，却与样本的 gy 相关 0.81、与 gx 只有 0.31。
   * 改成三轴取最大后，达到相关 ≥0.6 的样本比例：
   *   坐姿推举 25% → 48%；站姿侧平举 26% → 81%
   * 取绝对值是为了容忍轴向相反（左右佩戴）。
   */
  private templateCorrelation(): number | null {
    const tpl = this.opt.template
    if (!tpl || tpl.length < 8) return null
    let best: number | null = null
    let bestAxis: 'gx' | 'gy' | 'gz' | null = null
    for (const axis of ['gx', 'gy', 'gz'] as const) {
      const c = correlate(this.repAxes[axis], tpl, this.opt.templateMinSamples)
      if (c !== null && (best === null || c > best)) {
        best = c
        bestAxis = axis
      }
    }
    this.lastCorrAxis = bestAxis
    return best
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
