import { sensorAttitude } from './kinematics'
import type { JointAngles, MotionTemplate } from './types'
import type { ImuTarget } from '../protocol/types'

const ZERO: JointAngles = {
  shoulderFlexion: 0,
  shoulderAbduction: 0,
  elbowFlexion: 0,
  hipFlexion: 0,
  kneeFlexion: 0,
}

/** 取动作的顶点关键帧（t=0.5），用于生成下发目标姿态 */
function peakAngles(t: MotionTemplate): JointAngles {
  const k =
    t.keyframes.find((k) => Math.abs(k.t - 0.5) < 1e-6) ??
    t.keyframes[Math.floor(t.keyframes.length / 2)]
  return k?.angles ?? { ...ZERO }
}

/**
 * 把动作模板映射为目标 IMU 姿态（0x82 下发）。
 * 用正向运动学（基准姿态 + 关节链）算出传感器肢体的世界姿态 → roll/pitch/yaw。
 */
export function templateToImuTarget(t: MotionTemplate): ImuTarget {
  const a = peakAngles(t)
  const att = sensorAttitude(t.basePosture, t.sensorPosition, a)
  return {
    actionId: t.actionId,
    rollDeg: att.rollDeg,
    pitchDeg: att.pitchDeg,
    yawDeg: att.yawDeg,
    axG: 0,
    ayG: 0,
    azG: 0,
    gxDps: 0,
    gyDps: 0,
    gzDps: 0,
  }
}
