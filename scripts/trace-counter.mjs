// 追踪 RepCounter 在 #2（40s 坐姿推举）上的内部状态，定位为什么只数出 1 次。
import { readFileSync } from 'node:fs'
const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
const ss = rows[2].samples

// 复刻 RepCounter 的内部量
const AXES = ['gx', 'gy', 'gz']
const tau = 4000
const cap = 300
const angle = { gx: 0, gy: 0, gz: 0 }
const ema = { gx: 0, gy: 0, gz: 0 }
const hpBuf = { gx: [], gy: [], gz: [] }
const gBuf = { gx: [], gy: [], gz: [] }
let prevT = null
let axis = 'gy'
const hpAll = { gx: [], gy: [], gz: [] }
const tAll = []

for (let i = 0; i < ss.length; i++) {
  const s = ss[i]
  if (prevT === null) {
    prevT = s.t
    for (const a of AXES) {
      hpBuf[a].push(0)
      gBuf[a].push(s[a])
    }
    for (const a of AXES) hpAll[a].push(0)
    tAll.push(s.t)
    continue
  }
  let dt = s.t - prevT
  prevT = s.t
  if (dt <= 0) continue
  if (dt > 100) dt = 100
  const k = 1 - Math.exp(-dt / tau)
  for (const a of AXES) {
    angle[a] += s[a] * (dt / 1000)
    ema[a] += (angle[a] - ema[a]) * k
    hpBuf[a].push(angle[a] - ema[a])
    if (hpBuf[a].length > cap) hpBuf[a].shift()
    gBuf[a].push(s[a])
    if (gBuf[a].length > cap) gBuf[a].shift()
    hpAll[a].push(angle[a] - ema[a])
  }
  tAll.push(s.t)
  if (i % 200 === 0) {
    let best = axis
    let bv = -1
    const vs = {}
    for (const a of AXES) {
      const b = gBuf[a]
      const m = b.reduce((x, y) => x + y, 0) / b.length
      const v = b.reduce((x, y) => x + (y - m) ** 2, 0) / b.length
      vs[a] = v
      if (v > bv) {
        bv = v
        best = a
      }
    }
    axis = vs[axis] * 1.5 >= bv ? axis : best
    const h = hpBuf[axis]
    console.log(
      `i=${String(i).padStart(4)} t=${((s.t - ss[0].t) / 1000).toFixed(1).padStart(5)}s axis=${axis} var=${JSON.stringify(Object.fromEntries(AXES.map((a) => [a, Math.round(vs[a])])))}` +
        ` hp范围=[${Math.min(...h).toFixed(1)} .. ${Math.max(...h).toFixed(1)}] 幅度=${(Math.max(...h) - Math.min(...h)).toFixed(1)}°`,
    )
  }
}

// 全局看 hp 包络
const hp = hpAll.gy
console.log('\n=== gy 高通角包络（每 2s 一个桶，看 min/max）===')
for (let b = 0; b < ss.length; b += 100) {
  const seg = hp.slice(b, b + 100)
  const tt = ((ss[Math.min(b, ss.length - 1)].t - ss[0].t) / 1000).toFixed(0)
  console.log(`  t=${tt.padStart(2)}s  min=${Math.min(...seg).toFixed(1).padStart(7)}  max=${Math.max(...seg).toFixed(1).padStart(7)}  幅度=${(Math.max(...seg) - Math.min(...seg)).toFixed(1).padStart(6)}°`)
}
