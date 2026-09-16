import type {
  BasePosture,
  JointAngles,
  MainAxis,
  SensorPosition,
  SpeedProfile,
} from '../motion/types'

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

function clamp(n: unknown, def: number, min: number, max: number): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}

function angle(a: unknown): JointAngles {
  const o = (a ?? {}) as Record<string, unknown>
  return {
    torsoFlexion: clamp(o.torsoFlexion, 0, 0, 90),
    shoulderFlexion: clamp(o.shoulderFlexion, 0, 0, 180),
    shoulderAbduction: clamp(o.shoulderAbduction, 0, 0, 180),
    elbowFlexion: clamp(o.elbowFlexion, 0, 0, 180),
    hipFlexion: clamp(o.hipFlexion, 0, 0, 180),
    kneeFlexion: clamp(o.kneeFlexion, 0, 0, 180),
  }
}

/** 规范化模型输出，兜底保证结构完整合法 */
export function normalizeDraft(raw: unknown): GeneratedDraft {
  const o = (raw ?? {}) as Record<string, unknown>
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

  return {
    name: String(o.name || '智能生成动作').slice(0, 30),
    basePosture: POSTURES.includes(o.basePosture as BasePosture) ? (o.basePosture as BasePosture) : 'standing',
    sensorPosition: SENSORS.includes(o.sensorPosition as SensorPosition) ? (o.sensorPosition as SensorPosition) : 'wrist',
    mainAxis: clamp(o.mainAxis, 1, 1, 5) as MainAxis,
    speedProfile: o.speedProfile === 'uniform' ? 'uniform' : 'variable',
    peakAngleDeg: clamp(o.peakAngleDeg, 90, 0, 180),
    wristToleranceDeg: clamp(o.wristToleranceDeg, 15, 0, 45),
    cadence: clamp(o.cadence, 30, 1, 120),
    durationMs: clamp(o.durationMs, 2000, 500, 10000),
    keyframes: kfs,
  }
}
