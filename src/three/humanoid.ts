import * as THREE from 'three'
import type { ResolvedSegments } from '../core/body/bodyProfile'

const C_BODY = 0x51677d
const C_BODY_DARK = 0x41566b
const C_BENCH = 0x2a3642

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.1 })
}

/** 一根骨骼：pivot 在关节处，胶囊向下延伸，end 为下一关节挂点 */
function bone(len: number, radius: number, color: number) {
  const pivot = new THREE.Group()
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 2), 4, 12)
  const mesh = new THREE.Mesh(geo, mat(color))
  mesh.position.y = -len / 2
  pivot.add(mesh)
  const end = new THREE.Group()
  end.position.y = -len
  pivot.add(end)
  return { pivot, end }
}

export interface HumanoidJoints {
  torso: THREE.Group
  head: THREE.Group
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  wristL: THREE.Group
  wristR: THREE.Group
  hipL: THREE.Group
  hipR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  ankleL: THREE.Group
  ankleR: THREE.Group
}

export interface Humanoid {
  group: THREE.Group
  joints: HumanoidJoints
  legLen: number
}

export function createHumanoid(s: ResolvedSegments): Humanoid {
  const group = new THREE.Group()
  const legLen = s.thighLen + s.shinLen

  // 骨盆（髋中心）
  const pelvisW = s.hipWidth * 0.9
  const pelvis = new THREE.Mesh(
    new THREE.CapsuleGeometry(pelvisW * 0.5, Math.max(0.02, pelvisW * 0.6), 4, 12),
    mat(C_BODY_DARK),
  )
  group.add(pelvis)

  // 躯干
  const torso = new THREE.Group()
  torso.position.y = pelvisW * 0.3
  group.add(torso)

  const torsoR = s.shoulderWidth * 0.34
  const torsoLen = Math.max(0.3, s.torsoLen - s.hipWidth * 0.2)
  const torsoMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(torsoR, Math.max(0.02, torsoLen - torsoR * 2), 4, 12),
    mat(C_BODY),
  )
  torsoMesh.position.y = torsoLen / 2
  torso.add(torsoMesh)

  // 头
  const head = new THREE.Group()
  head.position.y = torsoLen + s.headRadius * 0.85
  torso.add(head)
  head.add(new THREE.Mesh(new THREE.SphereGeometry(s.headRadius, 24, 16), mat(C_BODY)))

  // 肩
  const shoulderY = torsoLen - torsoR * 0.2
  const shoulderL = new THREE.Group()
  shoulderL.position.set(-s.shoulderWidth / 2, shoulderY, 0)
  torso.add(shoulderL)
  const shoulderR = new THREE.Group()
  shoulderR.position.set(s.shoulderWidth / 2, shoulderY, 0)
  torso.add(shoulderR)

  // 手臂（自然下垂）
  const armR = Math.max(0.03, s.upperArmLen * 0.18)
  const upperL = bone(s.upperArmLen, armR, C_BODY)
  shoulderL.add(upperL.pivot)
  const elbowL = upperL.end
  const foreL = bone(s.forearmLen, armR * 0.82, C_BODY_DARK)
  elbowL.add(foreL.pivot)
  const wristL = foreL.end

  const upperR = bone(s.upperArmLen, armR, C_BODY)
  shoulderR.add(upperR.pivot)
  const elbowR = upperR.end
  const foreR = bone(s.forearmLen, armR * 0.82, C_BODY_DARK)
  elbowR.add(foreR.pivot)
  const wristR = foreR.end

  // 腿
  const legR = Math.max(0.04, s.thighLen * 0.17)
  const hipL = new THREE.Group()
  hipL.position.set(-s.hipWidth / 2, 0, 0)
  group.add(hipL)
  const thighL = bone(s.thighLen, legR, C_BODY)
  hipL.add(thighL.pivot)
  const kneeL = thighL.end
  const shinL = bone(s.shinLen, legR * 0.78, C_BODY_DARK)
  kneeL.add(shinL.pivot)
  const ankleL = shinL.end
  const footL = new THREE.Mesh(
    new THREE.CapsuleGeometry(legR * 0.6, s.shinLen * 0.26, 4, 12),
    mat(C_BODY_DARK),
  )
  footL.rotation.x = Math.PI / 2
  footL.position.set(0, -legR * 0.5, s.shinLen * 0.1)
  ankleL.add(footL)

  const hipR = new THREE.Group()
  hipR.position.set(s.hipWidth / 2, 0, 0)
  group.add(hipR)
  const thighR = bone(s.thighLen, legR, C_BODY)
  hipR.add(thighR.pivot)
  const kneeR = thighR.end
  const shinR = bone(s.shinLen, legR * 0.78, C_BODY_DARK)
  kneeR.add(shinR.pivot)
  const ankleR = shinR.end
  ankleR.add(footL.clone())

  // 手
  const handGeo = new THREE.SphereGeometry(armR * 0.9, 16, 12)
  const handL = new THREE.Mesh(handGeo, mat(C_BODY_DARK))
  handL.position.y = -armR * 0.6
  wristL.add(handL)
  wristR.add(handL.clone())

  // 让脚底落在 y≈0
  group.position.y = legLen + 0.05

  return {
    group,
    legLen,
    joints: {
      torso,
      head,
      shoulderL,
      shoulderR,
      elbowL,
      elbowR,
      wristL,
      wristR,
      hipL,
      hipR,
      kneeL,
      kneeR,
      ankleL,
      ankleR,
    },
  }
}

/** 训练凳（用于坐姿动作），座面高度 ≈ 小腿长 */
export function createBench(s: ResolvedSegments): THREE.Group {
  const g = new THREE.Group()
  const seatH = s.shinLen + 0.02
  const seatW = s.hipWidth * 1.7
  const seatD = s.hipWidth * 1.15
  const m = mat(C_BENCH)

  const seat = new THREE.Mesh(new THREE.BoxGeometry(seatW, 0.06, seatD), m)
  seat.position.y = seatH
  g.add(seat)

  const back = new THREE.Mesh(new THREE.BoxGeometry(seatW, seatH * 0.95, 0.06), m)
  back.position.set(0, seatH + seatH * 0.475, -seatD / 2)
  g.add(back)

  const legGeo = new THREE.BoxGeometry(0.05, seatH, 0.05)
  const offX = seatW / 2 - 0.07
  const offZ = seatD / 2 - 0.07
  for (const [x, z] of [
    [-offX, -offZ],
    [offX, -offZ],
    [-offX, offZ],
    [offX, offZ],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, m)
    leg.position.set(x, seatH / 2, z)
    g.add(leg)
  }
  return g
}

/**
 * 传感器坐标轴指示器：红=X（屈伸/pitch 轴）、绿=Y（纵轴/yaw 轴）、蓝=Z（外展/roll 轴）。
 * 挂在传感器佩戴的肢体段上，随动作实时转动，用于在 3D 演示层可视化 roll/pitch/yaw 的坐标约定。
 */
export function createImuAxes(size = 0.25): THREE.Group {
  const g = new THREE.Group()
  const axes: { dir: [number, number, number]; color: number }[] = [
    { dir: [1, 0, 0], color: 0xff4d4d },
    { dir: [0, 1, 0], color: 0x4dff6a },
    { dir: [0, 0, 1], color: 0x4d9fff },
  ]
  for (const { dir, color } of axes) {
    const v = new THREE.Vector3(...dir)
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        v.clone().multiplyScalar(size),
      ]),
      new THREE.LineBasicMaterial({ color }),
    )
    g.add(line)
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color }),
    )
    tip.position.copy(v).multiplyScalar(size)
    g.add(tip)
  }
  return g
}
