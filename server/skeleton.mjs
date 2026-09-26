// 骨架渲染：把「静止姿态 + 主运动扫动」的顶点姿势画成 2D 骨架 PNG（供视觉模型评审）
// 零依赖：纯 JS 向量/旋转（与 three 的 Vector3/Quaternion/Euler 数学等价）+ Web 原生 CompressionStream。
// 在 Node 与 Cloudflare Workers/Pages 均可运行。

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

const v3 = (x, y, z) => ({ x, y, z })
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z)
const addScaled = (a, b, s) => v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s)

// 绕 X 轴旋转（Y-Z 平面）
function rotX(v, th) {
  const c = Math.cos(th)
  const s = Math.sin(th)
  return v3(v.x, v.y * c - v.z * s, v.y * s + v.z * c)
}
// 绕 Z 轴旋转（X-Y 平面）
function rotZ(v, th) {
  const c = Math.cos(th)
  const s = Math.sin(th)
  return v3(v.x * c - v.y * s, v.x * s + v.y * c, v.z)
}
// 绕 Y 轴旋转（Z-X 平面）
function rotY(v, th) {
  const c = Math.cos(th)
  const s = Math.sin(th)
  return v3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
}
/** 肩外展带来的大臂自然外旋（上限 ±90°），与前端 types.shoulderTwistDeg 一致 */
const shoulderTwistDeg = (ab) => Math.max(-90, Math.min(90, ab))

function peakAngles(basePose, moves) {
  const a = { ...basePose }
  for (const m of moves || []) if (m && m.joint) a[m.joint] = m.to
  return a
}

// 正向运动学：髋为原点，+Y 上、+Z 前、+X 右（与前端 groundContact.ts 同约定）
export function buildSkeleton(a) {
  const torso = rad(a.torsoFlexion)
  const neck = rotX(v3(0, P.torso, 0), torso)
  const head = rotX(v3(0, P.torso + P.head, 0), torso)
  const limbs = []
  for (const side of [1, -1]) {
    const shoulder = rotX(v3(side * P.shoulderHalf, P.torso, 0), torso)
    const tw = rad(side * shoulderTwistDeg(a.shoulderAbduction))
    const flex = rad(-a.shoulderFlexion)
    const abd = rad(side * a.shoulderAbduction)
    // 上臂 = Rx(躯干) ∘ Rz(外展) ∘ Rx(屈) ∘ Ry(外旋) 作用于 (0,-1,0)
    let upperDir = rotY(v3(0, -1, 0), tw)
    upperDir = rotX(upperDir, flex)
    upperDir = rotZ(upperDir, abd)
    upperDir = rotX(upperDir, torso)
    const elbow = addScaled(shoulder, upperDir, P.upperArm)
    // 前臂 = 上臂链前再叠一层肘屈（最内层）
    let foreDir = rotX(v3(0, -1, 0), rad(-a.elbowFlexion))
    foreDir = rotY(foreDir, tw)
    foreDir = rotX(foreDir, flex)
    foreDir = rotZ(foreDir, abd)
    foreDir = rotX(foreDir, torso)
    const hand = addScaled(elbow, foreDir, P.forearm)

    const hip = v3(side * P.hipHalf, 0, 0)
    const thighDir = rotX(v3(0, -1, 0), rad(-a.hipFlexion))
    const knee = addScaled(hip, thighDir, P.thigh)
    const shinDir = rotX(rotX(v3(0, -1, 0), rad(a.kneeFlexion)), rad(-a.hipFlexion))
    const ankle = addScaled(knee, shinDir, P.shin)
    const toe = add(ankle, v3(0, 0, P.foot))

    limbs.push({ side, shoulder, elbow, hand, hip, knee, ankle, toe })
  }
  return { neck, head, hipCenter: v3(0, 0, 0), limbs }
}

// 姿态整体旋转角（绕 X）：俯卧由手+脚尖两点约束解出，仰卧躺平
function postureTheta(basePosture, sk) {
  if (basePosture === 'prone') {
    const hand = sk.limbs[0].hand
    const toe = sk.limbs[0].toe
    return Math.atan2(hand.y - toe.y, hand.z - toe.z)
  }
  if (basePosture === 'supine') return -Math.PI / 2
  return 0
}

const SENSOR_JOINT = { wrist: 'hand', 'upper-arm': 'elbow', thigh: 'knee', shin: 'ankle' }

export async function renderSkeletonPng(basePose, moves, basePosture = 'standing', sensorPosition = 'wrist') {
  const sk = buildSkeleton(peakAngles(basePose, moves))
  const th = postureTheta(basePosture, sk)
  const R = (v) => rotX(v, th)
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
