import { useEffect, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createBench, createHumanoid, createImuAxes, type HumanoidJoints } from '../three/humanoid'
import { resolveSegments, type BodyProfile, type ResolvedSegments } from '../core/body/bodyProfile'
import { applyPose } from '../core/motion/pose'
import type { BasePosture, JointAngles, SensorPosition } from '../core/motion/types'

function disposeObject(obj: THREE.Object3D) {
  if (
    obj instanceof THREE.Mesh ||
    obj instanceof THREE.Line ||
    obj instanceof THREE.LineSegments ||
    obj instanceof THREE.Points
  ) {
    obj.geometry.dispose()
    const mat = (obj as THREE.Mesh).material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  }
}

function sensorJoint(joints: HumanoidJoints, sensor: SensorPosition): THREE.Object3D {
  switch (sensor) {
    case 'wrist':
      return joints.wristR
    case 'upper-arm':
      return joints.elbowR
    case 'thigh':
      return joints.kneeR
    default:
      return joints.ankleR
  }
}

/** 俯卧撑/平板的地面接触解算：手贴地、脚尖贴地，身体随肘屈升降 */
function computePronePose(seg: ResolvedSegments, elbowDeg: number) {
  const armLen = seg.upperArmLen + seg.forearmLen
  const effArm = seg.upperArmLen + seg.forearmLen * Math.cos((elbowDeg * Math.PI) / 180)
  const bodyLen = seg.torsoLen + seg.thighLen + seg.shinLen
  const footLen = seg.shinLen * 0.3
  // 倾斜角：肩在手臂高度、脚踝在脚长高度（脚尖着地）
  const pitch = Math.asin(Math.min(1, (armLen - footLen) / bodyLen))
  const e = new THREE.Euler(Math.PI / 2 - pitch, 0, 0, 'XYZ')
  const up = new THREE.Vector3(0, 1, 0).applyEuler(e)
  const fwd = new THREE.Vector3(0, 0, 1).applyEuler(e)
  const shoulder = up.clone().multiplyScalar(seg.torsoLen)
  const hand = fwd.clone().multiplyScalar(effArm)
  return {
    rotationX: e.x,
    positionY: -(shoulder.y + hand.y) + 0.05,
    ankleX: 0,
  }
}

export default function HumanViewport({
  profile,
  poseRef,
  posture = 'standing',
  sensorPosition,
}: {
  profile: BodyProfile
  poseRef?: RefObject<JointAngles | null>
  posture?: BasePosture
  sensorPosition?: SensorPosition
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const seg = resolveSegments(profile)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xbcd7ee, 0x1c2620, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(4, 6, 3)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x35e27c, 1.1)
    rim.position.set(-3, 2, -2)
    scene.add(rim)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshStandardMaterial({ color: 0x16202a, roughness: 1, metalness: 0 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    scene.add(floor)

    const grid = new THREE.GridHelper(3, 24, 0x2c3f52, 0x18242f)
    grid.position.y = 0.01
    scene.add(grid)

    const humanoid = createHumanoid(seg)
    if (posture === 'seated') {
      humanoid.group.position.y = seg.shinLen + 0.02
      scene.add(createBench(seg))
    } else if (posture === 'prone') {
      const p = computePronePose(seg, 0)
      humanoid.group.rotation.x = p.rotationX
      humanoid.group.position.y = p.positionY
      humanoid.joints.ankleL.rotation.x = p.ankleX
      humanoid.joints.ankleR.rotation.x = p.ankleX
    } else if (posture === 'supine') {
      humanoid.group.rotation.x = -Math.PI / 2
      humanoid.group.position.y = seg.shoulderWidth * 0.3
    }
    if (sensorPosition) {
      sensorJoint(humanoid.joints, sensorPosition).add(createImuAxes(seg.forearmLen * 0.9))
    }
    scene.add(humanoid.group)

    // 自动取景：覆盖完整身体 + 手臂展开/上举范围
    const box = new THREE.Box3().setFromObject(humanoid.group)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const armLen = seg.upperArmLen + seg.forearmLen + 0.06
    const span = seg.shoulderWidth + armLen * 2
    const tall = size.y + armLen

    const w0 = container.clientWidth || 1
    const h0 = container.clientHeight || 1
    camera.aspect = w0 / h0
    camera.updateProjectionMatrix()

    const vfov = (camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
    const distV = (tall / 2) / Math.sin(vfov / 2)
    const distH = (span / 2) / Math.sin(hfov / 2)
    const dist = Math.max(distV, distH) * 1.12

    const dir = new THREE.Vector3(0.7, 0.55, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, dist)
    camera.lookAt(center)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.copy(center)
    controls.minDistance = dist * 0.3
    controls.maxDistance = dist * 5
    controls.maxPolarAngle = Math.PI * 0.85
    controls.update()

    let raf = 0
    const animate = () => {
      const pose = poseRef?.current
      if (pose) {
        applyPose(humanoid.joints, pose)
        const rad = Math.PI / 180
        if (posture === 'prone') {
          // 地面支撑（俯卧撑/平板）：手贴地、脚尖贴地，身体随肘屈升降
          const p = computePronePose(seg, pose.elbowFlexion)
          humanoid.group.position.y = p.positionY
        } else if (posture === 'standing') {
          // 站立：脚固定在地面，身体随髋屈/膝屈升降并后移（深蹲等下肢动作）
          const hip = pose.hipFlexion * rad
          const knee = pose.kneeFlexion * rad
          humanoid.group.position.y =
            seg.thighLen * Math.cos(hip) + seg.shinLen * Math.cos(hip - knee) + 0.05
          humanoid.group.position.z =
            -(seg.thighLen * Math.sin(hip) + seg.shinLen * Math.sin(hip - knee))
        }
        // seated / supine 保持初始静态位置
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)

    const resize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse(disposeObject)
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [profile, posture])

  return (
    <div className={`viewport-wrap${fullscreen ? ' viewport-wrap--fullscreen' : ''}`}>
      <div ref={containerRef} className="viewport" />
      <button
        type="button"
        className="viewport__fullscreen"
        onClick={() => setFullscreen((v) => !v)}
      >
        {fullscreen ? '退出全屏' : '⛶ 全屏'}
      </button>
    </div>
  )
}
