import type { HumanoidJoints } from '../../three/humanoid'
import type { JointAngles } from './types'

const rad = (d: number) => (d * Math.PI) / 180

/** 把关节角应用到人体模型（模型面向 +Z） */
export function applyPose(joints: HumanoidJoints, a: JointAngles) {
  joints.torso.rotation.x = -rad(a.torsoFlexion)
  joints.shoulderL.rotation.set(-rad(a.shoulderFlexion), 0, -rad(a.shoulderAbduction))
  joints.shoulderR.rotation.set(-rad(a.shoulderFlexion), 0, rad(a.shoulderAbduction))
  joints.elbowL.rotation.x = -rad(a.elbowFlexion)
  joints.elbowR.rotation.x = -rad(a.elbowFlexion)
  joints.hipL.rotation.x = -rad(a.hipFlexion)
  joints.hipR.rotation.x = -rad(a.hipFlexion)
  joints.kneeL.rotation.x = rad(a.kneeFlexion)
  joints.kneeR.rotation.x = rad(a.kneeFlexion)
}
