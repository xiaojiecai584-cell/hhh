import { sensorAttitude } from './kinematics'
import type { JointAngles, MotionTemplate, SpeedProfile } from './types'
import type { ImuTarget } from '../protocol/types'

const ZERO: JointAngles = {
  torsoFlexion: 0,
  shoulderFlexion: 0,
  shoulderAbduction: 0,
  elbowFlexion: 0,
  hipFlexion: 0,
  kneeFlexion: 0,
}

function anglesAt(t: MotionTemplate, t0: number): JointAngles {
  const k = t.keyframes.find((k) => Math.abs(k.t - t0) < 1e-6)
  return k?.angles ?? { ...ZERO }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * 把动作模板映射为目标 IMU 姿态（0x82 下发）。
 * 角度（roll/pitch/yaw）取顶点姿态；
 * 角速度（gx/gy/gz）按速度模式推算峰值角速度（°/s）：
 *   - 匀速(uniform)：角速度恒定，峰值 = 平均角速度 = 角度变化 / 半程时间
 *   - 非匀速(variable)：正弦速度曲线，峰值 = (π/2) × 平均角速度
 * 主运动轴 = roll/pitch/yaw 中变化幅度最大者，角速度映射 roll→gx、pitch→gy、yaw→gz。
 */
export function templateToImuTarget(t: MotionTemplate, speedProfile?: SpeedProfile): ImuTarget {
  const start = anglesAt(t, 0)
  const peak = anglesAt(t, 0.5)
  const s = sensorAttitude(t.basePosture, t.sensorPosition, start)
  const p = sensorAttitude(t.basePosture, t.sensorPosition, peak)

  const dRoll = p.rollDeg - s.rollDeg
  const dPitch = p.pitchDeg - s.pitchDeg
  const dYaw = p.yawDeg - s.yawDeg
  const aRoll = Math.abs(dRoll)
  const aPitch = Math.abs(dPitch)
  const aYaw = Math.abs(dYaw)
  const mag = Math.max(aRoll, aPitch, aYaw)

  const tHalf = Math.max(0.25, t.durationMs / 2000)
  const avgOmega = mag / tHalf
  const peakOmega = (speedProfile ?? t.speedProfile) === 'uniform' ? avgOmega : (Math.PI / 2) * avgOmega

  return {
    actionId: t.actionId,
    rollDeg: round1(p.rollDeg),
    pitchDeg: round1(p.pitchDeg),
    yawDeg: round1(p.yawDeg),
    axG: 0,
    ayG: 0,
    azG: 0,
    gxDps: aRoll === mag ? round1(peakOmega * Math.sign(dRoll)) : 0,
    gyDps: aPitch === mag ? round1(peakOmega * Math.sign(dPitch)) : 0,
    gzDps: aYaw === mag ? round1(peakOmega * Math.sign(dYaw)) : 0,
  }
}
