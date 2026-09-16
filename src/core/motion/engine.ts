import type { JointAngles, MotionTemplate } from './types'

const ZERO: JointAngles = {
  shoulderFlexion: 0,
  shoulderAbduction: 0,
  elbowFlexion: 0,
  hipFlexion: 0,
  kneeFlexion: 0,
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}

/** 在归一化时间 t（0..1）采样动作，得到当前关节角 */
export function sampleAngles(tmpl: MotionTemplate, t: number): JointAngles {
  const kf = tmpl.keyframes
  if (kf.length === 0) return { ...ZERO }
  const tc = Math.max(0, Math.min(1, t))
  if (tc <= kf[0].t) return { ...kf[0].angles }
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i]
    const b = kf[i + 1]
    if (tc >= a.t && tc <= b.t) {
      const span = b.t - a.t || 1
      let u = (tc - a.t) / span
      if (b.easing === 'smoothstep') u = u * u * (3 - 2 * u)
      return {
        shoulderFlexion: lerp(a.angles.shoulderFlexion, b.angles.shoulderFlexion, u),
        shoulderAbduction: lerp(a.angles.shoulderAbduction, b.angles.shoulderAbduction, u),
        elbowFlexion: lerp(a.angles.elbowFlexion, b.angles.elbowFlexion, u),
        hipFlexion: lerp(a.angles.hipFlexion, b.angles.hipFlexion, u),
        kneeFlexion: lerp(a.angles.kneeFlexion, b.angles.kneeFlexion, u),
      }
    }
  }
  return { ...kf[kf.length - 1].angles }
}
