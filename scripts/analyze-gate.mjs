// 判别量对比：陀螺仪积分幅度 vs 重力参考姿态幅度，看哪个能把「真做了一次」和「只是晃动」分开。
// 运行：node scripts/analyze-gate.mjs
import { readFileSync } from 'node:fs'

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))

/** 由加速度计求重力参考倾角（绝对、不漂移）：分量法 */
function tiltSeries(ss) {
  const out = []
  for (const s of ss) {
    const n = Math.hypot(s.ax, s.ay, s.az) || 1
    const ax = s.ax / n
    const ay = s.ay / n
    const az = s.az / n
    out.push({
      // 设备系里的重力方向（单位向量）+ 两个倾角
      gx: ax,
      gy: ay,
      gz: az,
      pitch: Math.atan2(-ax, Math.hypot(ay, az)) * (180 / Math.PI),
      roll: Math.atan2(ay, az) * (180 / Math.PI),
    })
  }
  return out
}

/** 4s 滑窗内峰谷差的最大值 */
function maxWindowRange(vals, win) {
  let best = 0
  for (let i = 0; i + win <= vals.length; i++) {
    let lo = Infinity
    let hi = -Infinity
    for (let k = i; k < i + win; k++) {
      if (vals[k] < lo) lo = vals[k]
      if (vals[k] > hi) hi = vals[k]
    }
    if (hi - lo > best) best = hi - lo
  }
  return best
}

/** 重力方向向量的最大夹角变化（更通用，不依赖单个倾角） */
function maxVectorAngle(vs, win) {
  let best = 0
  for (let i = 0; i + win <= vs.length; i++) {
    let m = 0
    for (let k = i; k < i + win; k++) {
      for (let j = k + 1; j < i + win; j++) {
        const d = vs[k].gx * vs[j].gx + vs[k].gy * vs[j].gy + vs[k].gz * vs[j].gz
        const a = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
        if (a > m) m = a
      }
    }
    if (m > best) best = m
  }
  return best
}

const cont = rows.map((r, i) => ({ i, r, ss: r.samples ?? [] })).filter((x) => x.ss.length >= 150)
const EXPECT = { 2: 19, 27: 1, 201: 0, 202: 0, 203: 1, 24: 1, 25: 1, 26: 1, 13: 1 }

console.log('idx 名称        dur    |ω|max  gyro积分4s幅度  tilt4s幅度  重力向量4s最大夹角  期望')
console.log('-'.repeat(96))
for (const { i, r, ss } of cont) {
  const WIN = Math.max(20, Math.min(200, Math.floor(ss.length / 2)))
  const om = Math.max(...ss.map((s) => Math.hypot(s.gx, s.gy, s.gz)))
  const tl = tiltSeries(ss)

  // 陀螺仪积分（去均值，不用 EMA，只是看幅度量级）
  const axis = ['gx', 'gy', 'gz'].reduce((best, a) => {
    const m = ss.reduce((s, p) => s + p[a], 0) / ss.length
    const v = ss.reduce((s, p) => s + (p[a] - m) ** 2, 0)
    return v > best.v ? { a, v } : best
  }, { a: 'gx', v: -1 }).a
  const mean = ss.reduce((s, p) => s + p[axis], 0) / ss.length
  let acc = 0
  const ang = ss.map((s) => {
    acc += (s[axis] - mean) * 0.02
    return acc
  })
  const gyroRange = maxWindowRange(ang, WIN)
  const tiltRange = maxWindowRange(tl.map((p) => p.pitch), WIN)
  const vecAngle = maxVectorAngle(tl, WIN)

  console.log(
    `${String(i).padStart(3)} ${(r.actionName ?? '?').padEnd(8)} ` +
      `${((ss.at(-1).t - ss[0].t) / 1000).toFixed(1).padStart(5)}s ${om.toFixed(0).padStart(6)}  ` +
      `${gyroRange.toFixed(1).padStart(13)}°  ${tiltRange.toFixed(1).padStart(9)}°  ${vecAngle.toFixed(1).padStart(15)}°  ${String(EXPECT[i] ?? '-').padStart(4)}`,
  )
}
