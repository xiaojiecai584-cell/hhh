import * as THREE from 'three'
import type { ResolvedSegments } from '../body/bodyProfile'
import { shoulderTwistDeg, type BasePosture, type JointAngles } from './types'

export const ZERO_ANGLES: JointAngles = {
  torsoFlexion: 0,
  shoulderFlexion: 0,
  shoulderAbduction: 0,
  elbowFlexion: 0,
  hipFlexion: 0,
  kneeFlexion: 0,
}

const rad = (d: number) => (d * Math.PI) / 180

function qx(deg: number) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(deg), 0, 0, 'XYZ'))
}
function qShoulder(a: JointAngles) {
  // 肩 = Rz(外展) ∘ Rx(屈) ∘ Ry(大臂外旋)，与 pose.ts / kinematics.ts 完全一致
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0, 0, rad(a.shoulderAbduction), 'XYZ'))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(-a.shoulderFlexion), 0, 0, 'XYZ')))
    .multiply(
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, rad(shoulderTwistDeg(a.shoulderAbduction)), 0, 'XYZ'),
      ),
    )
}
function qElbow(a: JointAngles) {
  return qx(-a.elbowFlexion)
}
function qHip(a: JointAngles) {
  return qx(-a.hipFlexion)
}
function qKnee(a: JointAngles) {
  return qx(a.kneeFlexion)
}
function qTorso(a: JointAngles) {
  return qx(a.torsoFlexion)
}

interface Landmarks {
  shoulder: THREE.Vector3
  elbow: THREE.Vector3
  hand: THREE.Vector3
  ankle: THREE.Vector3
  toe: THREE.Vector3
}

/** 正向运动学：计算关键点位置（身体局部坐标系，髋为原点，+Y 上、+Z 前），与 applyPose 一致 */
export function computeLandmarks(seg: ResolvedSegments, a: JointAngles): Landmarks {
  const torsoQ = qTorso(a)
  const shoulderQ = qShoulder(a)
  const elbowQ = qElbow(a)
  const hipQ = qHip(a)
  const kneeQ = qKnee(a)

  // 手臂链：躯干 → 肩 → 上臂 → 肘 → 前臂 → 手
  // 注意：applyQuaternion 需从最内层关节往外叠，即 v.applyQuaternion(child).applyQuaternion(parent)
  const shoulder = new THREE.Vector3(0, seg.torsoLen, 0).applyQuaternion(torsoQ)
  const upperDir = new THREE.Vector3(0, -1, 0).applyQuaternion(shoulderQ).applyQuaternion(torsoQ)
  const elbow = shoulder.clone().addScaledVector(upperDir, seg.upperArmLen)
  const foreDir = new THREE.Vector3(0, -1, 0)
    .applyQuaternion(elbowQ)
    .applyQuaternion(shoulderQ)
    .applyQuaternion(torsoQ)
  const hand = elbow.clone().addScaledVector(foreDir, seg.forearmLen)

  // 腿链：髋 → 大腿 → 膝 → 小腿 → 踝 → 脚尖
  const thighDir = new THREE.Vector3(0, -1, 0).applyQuaternion(hipQ)
  const knee = thighDir.clone().multiplyScalar(seg.thighLen)
  const shinDir = new THREE.Vector3(0, -1, 0).applyQuaternion(kneeQ).applyQuaternion(hipQ)
  const ankle = knee.clone().addScaledVector(shinDir, seg.shinLen)
  const toe = ankle.clone().add(new THREE.Vector3(0, 0, seg.shinLen * 0.3))

  return { shoulder, elbow, hand, ankle, toe }
}

/**
 * 地面接触解算器（轻量 IK）：给定姿态与关节角，返回身体整体的旋转与平移，
 * 使该姿态的支撑点贴地/贴凳。所有姿态走同一套逻辑，避免 ad-hoc 特判。
 */
export function solveGroundContact(
  posture: BasePosture,
  seg: ResolvedSegments,
  a: JointAngles,
): { rotation: THREE.Euler; position: THREE.Vector3 } {
  const L = computeLandmarks(seg, a)

  if (posture === 'prone') {
    // 支撑点：手 + 脚尖，都贴地。由两点约束解出绕 X 的旋转角。
    const theta = Math.atan2(L.hand.y - L.toe.y, L.hand.z - L.toe.z)
    const rot = new THREE.Euler(theta, 0, 0, 'XYZ')
    const R = new THREE.Quaternion().setFromEuler(rot)
    const handW = L.hand.clone().applyQuaternion(R)
    return { rotation: rot, position: new THREE.Vector3(0, -handW.y + 0.02, -handW.z) }
  }

  if (posture === 'supine') {
    // 仰卧：面朝上，背部贴地
    return {
      rotation: new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'),
      position: new THREE.Vector3(0, seg.shoulderWidth * 0.25, 0),
    }
  }

  if (posture === 'seated') {
    // 坐姿：髋在凳面高度
    return {
      rotation: new THREE.Euler(0, 0, 0, 'XYZ'),
      position: new THREE.Vector3(0, seg.shinLen + 0.02, 0),
    }
  }

  // 站立：脚踝固定在地面（y 与 z 都固定，身体相对移动）
  return {
    rotation: new THREE.Euler(0, 0, 0, 'XYZ'),
    position: new THREE.Vector3(0, -L.ankle.y + 0.05, -L.ankle.z),
  }
}
