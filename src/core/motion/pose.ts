import * as THREE from 'three'
import type { HumanoidJoints } from '../../three/humanoid'
import { shoulderTwistDeg, type JointAngles } from './types'

const rad = (d: number) => (d * Math.PI) / 180
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)

/**
 * 肩关节旋转 = Rz(外展) ∘ Rx(屈) ∘ Ry(大臂外旋)。
 * 外旋项（见 types.shoulderTwistDeg）让「外展 + 屈肘」呈现自然的投降状/推举准备位。
 */
function poseShoulder(node: THREE.Object3D, a: JointAngles, side: 1 | -1) {
  const ab = side * a.shoulderAbduction
  const twist = side * shoulderTwistDeg(a.shoulderAbduction)
  const qz = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, rad(ab))
  const qx = new THREE.Quaternion().setFromAxisAngle(AXIS_X, rad(-a.shoulderFlexion))
  const qy = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, rad(twist))
  node.quaternion.copy(qz.multiply(qx).multiply(qy))
}

/** 把关节角应用到人体模型（模型面向 +Z） */
export function applyPose(joints: HumanoidJoints, a: JointAngles) {
  joints.torso.rotation.x = rad(a.torsoFlexion)
  poseShoulder(joints.shoulderL, a, -1)
  poseShoulder(joints.shoulderR, a, 1)
  joints.elbowL.rotation.x = -rad(a.elbowFlexion)
  joints.elbowR.rotation.x = -rad(a.elbowFlexion)
  joints.hipL.rotation.x = -rad(a.hipFlexion)
  joints.hipR.rotation.x = -rad(a.hipFlexion)
  joints.kneeL.rotation.x = rad(a.kneeFlexion)
  joints.kneeR.rotation.x = rad(a.kneeFlexion)
}
