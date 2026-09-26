// 姿态引擎数值自检：
//  (1) 前端 FK（three 四元数链，groundContact.ts）与 Worker 侧纯 JS FK（server/skeleton.mjs）逐点比对；
//  (2) 打印各预设动作关键帧/插值采样点的上臂·前臂朝向，用于人工确认姿势语义。
// 运行：node scripts/verify-pose.mjs
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { computeLandmarks } = await server.ssrLoadModule('/src/core/motion/groundContact.ts')
const { sampleAngles } = await server.ssrLoadModule('/src/core/motion/engine.ts')
const { MOTION_TEMPLATES } = await server.ssrLoadModule('/src/core/motion/templates.ts')
const { JOINT_RANGE, shoulderTwistDeg } = await server.ssrLoadModule('/src/core/motion/types.ts')
const { DEFAULT_PROFILE, resolveSegments } = await server.ssrLoadModule('/src/core/body/bodyProfile.ts')
const { createHumanoid } = await server.ssrLoadModule('/src/three/humanoid.ts')
const { applyPose } = await server.ssrLoadModule('/src/core/motion/pose.ts')
const THREE = await import('three')
const { buildSkeleton } = await import('../server/skeleton.mjs')

const seg = resolveSegments(DEFAULT_PROFILE)
const J = ['torsoFlexion', 'shoulderFlexion', 'shoulderAbduction', 'elbowFlexion', 'hipFlexion', 'kneeFlexion']

const v3 = (a) => ({ x: a.x, y: a.y, z: a.z })
const sub = (a, b) => v3({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const norm = (v) => {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}
const ang = (a, b) => {
  const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))
  return (Math.acos(d) * 180) / Math.PI
}
const fmt = (v) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`

// === 0. 真实 3D demo 路径：createHumanoid + applyPose → 骨骼世界坐标 vs 纯数学 FK ===
let rigMax = 0
let rigMaxL = 0
let rigBad = null
for (let i = 0; i < 2000; i++) {
  const a = {}
  for (const k of J) {
    const [lo, hi] = JOINT_RANGE[k]
    a[k] = lo + Math.random() * (hi - lo)
  }
  const L = computeLandmarks(seg, a)
  const front = { upper: norm(sub(L.elbow, L.shoulder)), fore: norm(sub(L.hand, L.elbow)) }
  const h = createHumanoid(seg)
  applyPose(h.joints, a)
  h.group.updateMatrixWorld(true)
  const w = (o) => o.getWorldPosition(new THREE.Vector3())
  const rig = {
    upper: norm(sub(w(h.joints.elbowR), w(h.joints.shoulderR))),
    fore: norm(sub(w(h.joints.wristR), w(h.joints.elbowR))),
  }
  const rigL = {
    upper: norm(sub(w(h.joints.elbowL), w(h.joints.shoulderL))),
    fore: norm(sub(w(h.joints.wristL), w(h.joints.elbowL))),
  }
  const d = Math.max(ang(front.upper, rig.upper), ang(front.fore, rig.fore))
  if (d > rigMax) rigMax = d
  const dl = Math.max(ang({ x: -rig.upper.x, y: rig.upper.y, z: rig.upper.z }, rigL.upper), ang({ x: -rig.fore.x, y: rig.fore.y, z: rig.fore.z }, rigL.fore))
  if (dl > rigMaxL) rigMaxL = dl
  if (d > 0.01 && !rigBad) rigBad = { a, front, rig }
}

console.log('=== 0. 3D demo 路径一致性（applyPose 骨骼世界坐标 vs 数学 FK，2000 组）===')
console.log(`  右臂最大偏差 ${rigMax.toExponential(2)}°  ${rigMax < 1e-4 ? '✓' : '✗'}`)
console.log(`  左臂镜像最大偏差 ${rigMaxL.toExponential(2)}°  ${rigMaxL < 1e-4 ? '✓' : '✗'}`)
if (rigBad) console.log('  反例:', JSON.stringify(rigBad))

// === 1. 两套 FK 一致性（随机扫角，比方向不比长度：两边段长常量不同）===
let maxUpper = 0
let maxFore = 0
let maxLeg = 0
let bad = null
for (let i = 0; i < 5000; i++) {
  const a = {}
  for (const k of J) {
    const [lo, hi] = JOINT_RANGE[k]
    a[k] = lo + Math.random() * (hi - lo)
  }
  const L = computeLandmarks(seg, a)
  const front = {
    upper: norm(sub(L.elbow, L.shoulder)),
    fore: norm(sub(L.hand, L.elbow)),
  }
  const sk = buildSkeleton(a)
  const right = sk.limbs[0]
  const server = {
    upper: norm(sub(right.elbow, right.shoulder)),
    fore: norm(sub(right.hand, right.elbow)),
  }
  const dU = ang(front.upper, server.upper)
  const dF = ang(front.fore, server.fore)
  if (dU > maxUpper) maxUpper = dU
  if (dF > maxFore) maxFore = dF
  if ((dU > 0.01 || dF > 0.01) && !bad) bad = { a, front, server, dU, dF }

  // 左臂应是右臂的 X 镜像
  const left = sk.limbs[1]
  const m = ang({ x: -server.upper.x, y: server.upper.y, z: server.upper.z }, norm(sub(left.elbow, left.shoulder)))
  if (m > maxLeg) maxLeg = m
}

console.log('=== 1. FK 一致性（5000 组随机关节角）===')
console.log(`  上臂方向最大偏差 ${maxUpper.toExponential(2)}°  ${maxUpper < 1e-4 ? '✓' : '✗'}`)
console.log(`  前臂方向最大偏差 ${maxFore.toExponential(2)}°  ${maxFore < 1e-4 ? '✓' : '✗'}`)
console.log(`  左右镜像最大偏差 ${maxLeg.toExponential(2)}°  ${maxLeg < 1e-4 ? '✓' : '✗'}`)
console.log('  （阈值 1e-4 度；实测 ~2e-6 度为 float64 三角函数与欧拉→四元数转换的舍入差）')
if (bad) console.log('  反例:', JSON.stringify(bad))

// === 2. 预设动作朝向 ===
console.log('\n=== 2. 预设动作关键帧（右臂）===')
for (const t of MOTION_TEMPLATES) {
  console.log(`\n${t.id} · ${t.name}  主运动轴=${t.mainAxis}(${t.mainAxis === 1 ? '肩屈' : t.mainAxis === 2 ? '肩外展' : '?'}) 基准=${t.basePosture} 峰值=${t.peakAngleDeg}°`)
  for (const kf of t.keyframes) {
    const sk = buildSkeleton(kf.angles)
    const l = sk.limbs[0]
    const up = norm(sub(l.elbow, l.shoulder))
    const fo = norm(sub(l.hand, l.elbow))
    const d = sub(l.hand, l.shoulder)
    console.log(
      `  t=${kf.t} 上臂${fmt(up)} 前臂${fmt(fo)} | 手−肩 Δ=(${d.x.toFixed(3)}, ${d.y.toFixed(3)}, ${d.z.toFixed(3)})`,
    )
  }
}

// === 3. 引擎插值采样（真实输出）===
console.log('\n=== 3. 插值采样 · 坐姿推举 ===')
const press = MOTION_TEMPLATES.find((t) => t.id === 'seated-press')
for (let i = 0; i <= 10; i++) {
  const tt = i / 10
  const a = sampleAngles(press, tt)
  const sk = buildSkeleton(a)
  const l = sk.limbs[0]
  const up = norm(sub(l.elbow, l.shoulder))
  const fo = norm(sub(l.hand, l.elbow))
  console.log(
    `  t=${tt.toFixed(1)} 外展${a.shoulderAbduction.toFixed(0)}° 屈${a.shoulderFlexion.toFixed(0)}° 肘${a.elbowFlexion.toFixed(0)}° 外旋${shoulderTwistDeg(a.shoulderAbduction).toFixed(0)}°` +
      ` → 上臂${fmt(up)} 前臂${fmt(fo)} 手(${l.hand.x.toFixed(2)}, ${l.hand.y.toFixed(2)}, ${l.hand.z.toFixed(2)})`,
  )
}
console.log(`\n  参考：肩高 y=${(seg.torsoLen).toFixed(3)} 头高 y=${(seg.torsoLen + seg.headRadius * 2).toFixed(3)} 大腿长=${seg.thighLen.toFixed(3)}`)

await server.close()
