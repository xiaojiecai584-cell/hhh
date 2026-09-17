import {
  JOINT_RANGE,
  type BasePosture,
  type JointAngles,
  type MainAxis,
  type SensorPosition,
  type SpeedProfile,
} from '../motion/types'

export interface JointMove {
  joint: keyof JointAngles
  from: number
  to: number
}

export interface GeneratedDraft {
  name: string
  basePosture: BasePosture
  sensorPosition: SensorPosition
  mainAxis: MainAxis
  speedProfile: SpeedProfile
  peakAngleDeg: number
  wristToleranceDeg: number
  cadence: number
  durationMs: number
  searchTerm?: string
  moves: JointMove[]
  keyframes: { t: number; angles: JointAngles; easing: 'linear' | 'smoothstep' }[]
}

/** 动作生成接口：未来可替换为不同的大模型/引擎，UI 零改动 */
export interface MotionGenerator {
  generate(description: string): Promise<GeneratedDraft>
}

/** 通过后端 /api/generate 调用大模型 */
export const httpMotionGenerator: MotionGenerator = {
  async generate(description) {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as any)?.error || `生成失败（${res.status}）`)
    return normalizeDraft(data)
  },
}

const POSTURES: BasePosture[] = ['standing', 'seated', 'prone', 'supine']
const SENSORS: SensorPosition[] = ['wrist', 'upper-arm', 'thigh', 'shin']

const ZERO: JointAngles = {
  torsoFlexion: 0,
  shoulderFlexion: 0,
  shoulderAbduction: 0,
  elbowFlexion: 0,
  hipFlexion: 0,
  kneeFlexion: 0,
}

const JOINT_KEYS = Object.keys(JOINT_RANGE) as (keyof JointAngles)[]

/** 主运动轴 → 对应关节 */
const MAIN_AXIS_JOINT: Record<MainAxis, keyof JointAngles> = {
  1: 'shoulderFlexion',
  2: 'shoulderAbduction',
  3: 'elbowFlexion',
  4: 'hipFlexion',
  5: 'kneeFlexion',
}

function clamp(n: unknown, def: number, min: number, max: number): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}

function angle(a: unknown): JointAngles {
  const o = (a ?? {}) as Record<string, unknown>
  const r = (k: keyof JointAngles) => clamp(o[k], 0, JOINT_RANGE[k][0], JOINT_RANGE[k][1])
  return {
    torsoFlexion: r('torsoFlexion'),
    shoulderFlexion: r('shoulderFlexion'),
    shoulderAbduction: r('shoulderAbduction'),
    elbowFlexion: r('elbowFlexion'),
    hipFlexion: r('hipFlexion'),
    kneeFlexion: r('kneeFlexion'),
  }
}

function parseMoves(raw: unknown): JointMove[] {
  if (!Array.isArray(raw)) return []
  const out: JointMove[] = []
  for (const m of raw) {
    const o = (m ?? {}) as Record<string, unknown>
    const joint = o.joint
    if (typeof joint !== 'string' || !JOINT_KEYS.includes(joint as keyof JointAngles)) continue
    const jk = joint as keyof JointAngles
    out.push({
      joint: jk,
      from: clamp(o.from, 0, JOINT_RANGE[jk][0], JOINT_RANGE[jk][1]),
      to: clamp(o.to, 0, JOINT_RANGE[jk][0], JOINT_RANGE[jk][1]),
    })
  }
  return out
}

/** 由「静止姿态 + 主运动扫动范围」确定性合成三关键帧（起始/顶点/结束），运动由引擎保证 */
function synthesizeKeyframes(basePose: JointAngles, moves: JointMove[]): GeneratedDraft['keyframes'] {
  const start: JointAngles = { ...basePose }
  const peak: JointAngles = { ...basePose }
  for (const m of moves) {
    start[m.joint] = m.from
    peak[m.joint] = m.to
  }
  return [
    { t: 0, angles: start, easing: 'smoothstep' as const },
    { t: 0.5, angles: peak, easing: 'smoothstep' as const },
    { t: 1, angles: { ...start }, easing: 'smoothstep' as const },
  ]
}

/** 规范化模型输出，兜底保证结构完整合法 */
export function normalizeDraft(raw: unknown): GeneratedDraft {
  const o = (raw ?? {}) as Record<string, unknown>

  // 主运动扫动（新格式）；兼容旧 keyframes 格式兜底
  const moves = parseMoves(o.moves)
  let keyframes: GeneratedDraft['keyframes']
  if (moves.length > 0) {
    keyframes = synthesizeKeyframes(angle(o.basePose ?? {}), moves)
  } else {
    const rawKfs = Array.isArray(o.keyframes) && o.keyframes.length ? o.keyframes : []
    const kfs = (rawKfs as any[]).map((k) => ({
      t: clamp(k?.t, 0, 0, 1),
      angles: angle(k?.angles),
      easing: k?.easing === 'linear' ? ('linear' as const) : ('smoothstep' as const),
    }))
    if (kfs.length === 0) {
      kfs.push(
        { t: 0, angles: { ...ZERO }, easing: 'smoothstep' },
        { t: 0.5, angles: { ...ZERO }, easing: 'smoothstep' },
        { t: 1, angles: { ...ZERO }, easing: 'smoothstep' },
      )
    }
    kfs.sort((a, b) => a.t - b.t)
    keyframes = kfs
  }

  const mainAxis = clamp(o.mainAxis, 1, 1, 5) as MainAxis
  // 峰值角度由主运动轴的扫动范围直接得出，保证与合成帧一致
  const mainMove = moves.find((m) => m.joint === MAIN_AXIS_JOINT[mainAxis])
  const peakAngleDeg = mainMove ? mainMove.to : clamp(o.peakAngleDeg, 90, 0, 180)

  return {
    name: String(o.name || '智能生成动作').slice(0, 30),
    basePosture: POSTURES.includes(o.basePosture as BasePosture) ? (o.basePosture as BasePosture) : 'standing',
    sensorPosition: SENSORS.includes(o.sensorPosition as SensorPosition) ? (o.sensorPosition as SensorPosition) : 'wrist',
    mainAxis,
    speedProfile: o.speedProfile === 'uniform' ? 'uniform' : 'variable',
    peakAngleDeg,
    wristToleranceDeg: clamp(o.wristToleranceDeg, 15, 0, 45),
    cadence: clamp(o.cadence, 30, 1, 120),
    durationMs: clamp(o.durationMs, 2000, 500, 10000),
    searchTerm: String(o.searchTerm || '').slice(0, 60),
    moves,
    keyframes,
  }
}
