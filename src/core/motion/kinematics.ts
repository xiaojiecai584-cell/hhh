import * as THREE from 'three'
import type { BasePosture, JointAngles, SensorPosition } from './types'

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

function eulerQ(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(x), rad(y), rad(z), 'XYZ'))
}

// 各关节旋转（与 pose.ts 的 applyPose 完全一致，右臂为参考）
function shoulderQ(a: JointAngles): THREE.Quaternion {
  return eulerQ(-a.shoulderFlexion, 0, a.shoulderAbduction)
}
function elbowQ(a: JointAngles): THREE.Quaternion {
  return eulerQ(-a.elbowFlexion, 0, 0)
}
function hipQ(a: JointAngles): THREE.Quaternion {
  return eulerQ(-a.hipFlexion, 0, 0)
}
function kneeQ(a: JointAngles): THREE.Quaternion {
  return eulerQ(a.kneeFlexion, 0, 0)
}
function torsoQ(a: JointAngles): THREE.Quaternion {
  return eulerQ(-a.torsoFlexion, 0, 0)
}

// 基准姿态：身体整体在世界中的旋转（站/坐 = 竖直；俯卧/仰卧 = 水平）
function postureQ(p: BasePosture): THREE.Quaternion {
  if (p === 'prone') return eulerQ(90, 0, 0)
  if (p === 'supine') return eulerQ(-90, 0, 0)
  return new THREE.Quaternion()
}

// 传感器所在肢体段，在身体坐标系下的姿态
function segmentLocalQ(s: SensorPosition, a: JointAngles): THREE.Quaternion {
  let q = new THREE.Quaternion()
  if (s === 'thigh' || s === 'shin') {
    q = hipQ(a)
    if (s === 'shin') q.multiply(kneeQ(a))
  } else {
    q = torsoQ(a).multiply(shoulderQ(a))
    if (s === 'wrist') q.multiply(elbowQ(a))
  }
  return q
}

/**
 * 传感器段的世界姿态（roll/pitch/yaw，度）。
 * 正向运动学：身体基准姿态 × 关节链，得到传感器肢体的世界朝向。
 *
 * IMU 坐标约定（待固件确认后可在 IMU_FRAME 处调整）：
 *   - pitch = 屈/伸方向（肩屈、肘屈、髋屈…），向前/向上为正
 *   - roll  = 外展方向（肩外展…），向外为正
 *   - yaw   = 绕肢体纵轴旋转
 */
export function sensorAttitude(
  posture: BasePosture,
  sensor: SensorPosition,
  a: JointAngles,
): { rollDeg: number; pitchDeg: number; yawDeg: number } {
  const q = postureQ(posture).multiply(segmentLocalQ(sensor, a))
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return {
    rollDeg: round1(deg(e.z)),
    pitchDeg: round1(deg(-e.x)),
    yawDeg: round1(deg(e.y)),
  }
}

/**
 * 佩戴位置自动推荐（通用规则）：
 * 找出关键帧中变化幅度最大的关节，推荐它直接带动的肢体段。
 *   肘动最多 → 手腕/前臂；肩动最多 → 上臂；髋动最多 → 大腿；膝动最多 → 小腿。
 */
export function recommendSensor(kfs: JointAngles[]): SensorPosition {
  if (kfs.length === 0) return 'wrist'
  const first = kfs[0]
  let s = 0
  let e = 0
  let h = 0
  let k = 0
  for (const a of kfs) {
    s = Math.max(
      s,
      Math.abs(a.shoulderFlexion - first.shoulderFlexion),
      Math.abs(a.shoulderAbduction - first.shoulderAbduction),
    )
    e = Math.max(e, Math.abs(a.elbowFlexion - first.elbowFlexion))
    h = Math.max(h, Math.abs(a.hipFlexion - first.hipFlexion))
    k = Math.max(k, Math.abs(a.kneeFlexion - first.kneeFlexion))
  }
  const m = Math.max(s, e, h, k)
  if (m <= 0) return 'wrist'
  if (e === m) return 'wrist'
  if (s === m) return 'upper-arm'
  if (h === m) return 'thigh'
  return 'shin'
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
