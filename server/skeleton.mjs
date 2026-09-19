// 骨架渲染：把「静止姿态 + 主运动扫动」的顶点姿势画成 2D 骨架 PNG（供视觉模型评审）
// 复用 three 的数学（Vector3/Quaternion/Euler），与前端 3D 人偶的正向运动学完全一致。
import { Vector3, Quaternion, Euler } from 'three'

const P = {
  head: 0.14,
  torso: 0.52,
  upperArm: 0.3,
  forearm: 0.27,
  thigh: 0.46,
  shin: 0.44,
  foot: 0.16,
  shoulderHalf: 0.16,
  hipHalf: 0.1,
}

const rad = (d) => (d * Math.PI) / 180
const qx = (deg) => new Quaternion().setFromEuler(new Euler(rad(deg), 0, 0, 'XYZ'))
const qShoulder = (a, side) =>
  new Quaternion().setFromEuler(new Euler(rad(-a.shoulderFlexion), 0, rad(side * a.shoulderAbduction), 'XYZ'))
const qElbow = (a) => qx(-a.elbowFlexion)
const qHip = (a) => qx(-a.hipFlexion)
const qKnee = (a) => qx(a.kneeFlexion)
const qTorso = (a) => qx(a.torsoFlexion)

function peakAngles(basePose, moves) {
  const a = { ...basePose }
  for (const m of moves || []) if (m && m.joint) a[m.joint] = m.to
  return a
}

function buildSkeleton(a) {
  const torsoQ = qTorso(a)
  const neck = new Vector3(0, P.torso, 0).applyQuaternion(torsoQ)
  const head = new Vector3(0, P.torso + P.head, 0).applyQuaternion(torsoQ)
  const limbs = []
  for (const side of [1, -1]) {
    const shoulder = new Vector3(side * P.shoulderHalf, P.torso, 0).applyQuaternion(torsoQ)
    const upperDir = new Vector3(0, -1, 0).applyQuaternion(torsoQ).applyQuaternion(qShoulder(a, side))
    const elbow = shoulder.clone().addScaledVector(upperDir, P.upperArm)
    const foreDir = upperDir.clone().applyQuaternion(qElbow(a))
    const hand = elbow.clone().addScaledVector(foreDir, P.forearm)

    const hip = new Vector3(side * P.hipHalf, 0, 0)
    const thighDir = new Vector3(0, -1, 0).applyQuaternion(qHip(a))
    const knee = hip.clone().addScaledVector(thighDir, P.thigh)
    const shinDir = thighDir.clone().applyQuaternion(qKnee(a))
    const ankle = knee.clone().addScaledVector(shinDir, P.shin)
    const toe = ankle.clone().add(new Vector3(0, 0, P.foot))

    limbs.push({ side, shoulder, elbow, hand, hip, knee, ankle, toe })
  }
  return { neck, head, hipCenter: new Vector3(0, 0, 0), limbs }
}

function postureRotation(basePosture, sk) {
  if (basePosture === 'prone') {
    // 与 solveGroundContact 一致：由手+脚尖两点约束解出倾斜角 θ，使二者贴地
    const hand = sk.limbs[0].hand
    const toe = sk.limbs[0].toe
    const theta = Math.atan2(hand.y - toe.y, hand.z - toe.z)
    return new Quaternion().setFromEuler(new Euler(theta, 0, 0, 'XYZ'))
  }
  if (basePosture === 'supine') return new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0, 'XYZ'))
  return new Quaternion()
}

const SENSOR_JOINT = { wrist: 'hand', 'upper-arm': 'elbow', thigh: 'knee', shin: 'ankle' }

export async function renderSkeletonPng(basePose, moves, basePosture = 'standing', sensorPosition = 'wrist') {
  const sk = buildSkeleton(peakAngles(basePose, moves))
  const rot = postureRotation(basePosture, sk)
  const R = (v) => v.clone().applyQuaternion(rot)
  const sensorJoint = SENSOR_JOINT[sensorPosition] || 'hand'

  const bones = [[R(sk.hipCenter), R(sk.neck)], [R(sk.neck), R(sk.head)]]
  const joints = [
    { p: R(sk.head), sensor: false },
    { p: R(sk.neck), sensor: false },
    { p: R(sk.hipCenter), sensor: false },
  ]
  for (const l of sk.limbs) {
    bones.push([R(sk.neck), R(l.shoulder)], [R(l.shoulder), R(l.elbow)], [R(l.elbow), R(l.hand)])
    bones.push([R(l.hip), R(l.knee)], [R(l.knee), R(l.ankle)], [R(l.ankle), R(l.toe)])
    for (const k of ['shoulder', 'elbow', 'hand', 'hip', 'knee', 'ankle']) {
      joints.push({ p: R(l[k]), sensor: k === sensorJoint })
    }
  }

  const W = 800
  const H = 420
  const buf = new Uint8Array(W * H * 4).fill(255)
  drawView(buf, bones, joints, 0, W / 2, (p) => [p.z, p.y]) // 侧视图：矢状面（看屈/伸）
  drawView(buf, bones, joints, W / 2, W / 2, (p) => [p.x, p.y]) // 正视图：冠状面（看外展）
  return encodePng(W, H, buf)
}

function drawView(buf, bones, joints, ox, w, proj) {
  const H = 420
  const all = []
  for (const b of bones) all.push(proj(b[0]), proj(b[1]))
  for (const j of joints) all.push(proj(j.p))
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of all) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const scale = Math.min((w - 40) / spanX, (H - 40) / spanY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const map = ([x, y]) => [ox + w / 2 + (x - cx) * scale, H / 2 - (y - cy) * scale]

  for (const b of bones) {
    const [x0, y0] = map(proj(b[0]))
    const [x1, y1] = map(proj(b[1]))
    drawLine(buf, x0, y0, x1, y1, 4, [30, 30, 30])
  }
  for (const j of joints) {
    const [x, y] = map(proj(j.p))
    fillCircle(buf, x, y, j.sensor ? 8 : 5, j.sensor ? [220, 40, 40] : [20, 20, 20])
  }
}

function drawLine(buf, x0, y0, x1, y1, thick, [r, g, b]) {
  const W = 800
  const H = 420
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - thick))
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + thick))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - thick))
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + thick))
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  const rr = (thick / 2) ** 2
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = x0 + t * dx
      const py = y0 + t * dy
      if ((x - px) * (x - px) + (y - py) * (y - py) <= rr) {
        const i = (y * W + x) * 4
        buf[i] = r
        buf[i + 1] = g
        buf[i + 2] = b
      }
    }
  }
}

function fillCircle(buf, cx, cy, r, [cr, cg, cb]) {
  const W = 800
  const H = 420
  const minX = Math.max(0, Math.floor(cx - r))
  const maxX = Math.min(W - 1, Math.ceil(cx + r))
  const minY = Math.max(0, Math.floor(cy - r))
  const maxY = Math.min(H - 1, Math.ceil(cy + r))
  const rr = r * r
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr) {
        const i = (y * W + x) * 4
        buf[i] = cr
        buf[i + 1] = cg
        buf[i + 2] = cb
      }
    }
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(arrays) {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) {
    out.set(a, off)
    off += a.length
  }
  return out
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, data.length, false)
  const body = concatBytes([typeBytes, data])
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(body), false)
  return concatBytes([len, body, crc])
}

async function deflateCompress(data) {
  const stream = new Response(data).body.pipeThrough(new CompressionStream('deflate'))
  const ab = await new Response(stream).arrayBuffer()
  return new Uint8Array(ab)
}

async function encodePng(W, H, rgba) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, W, false)
  dv.setUint32(4, H, false)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = W * 4
  const raw = new Uint8Array((stride + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0 // filter type 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const idat = await deflateCompress(raw)
  return concatBytes([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))])
}
