// 录音有效性审计：判断每条样本的信号是否具备"一组重复"的形态。
// 依据：一次坐姿推举在两次动作之间必然回到接近静止；若整段 |a_vert| 或 |ω| 的
// 低分位都很高，说明录音里不存在静止期，任何计数算法都无法在其中切出次数。
// 运行：node scripts/audit-samples.mjs <json...>
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
const all = []
for (const p of files) {
  const d = JSON.parse(readFileSync(p, 'utf8'))
  for (const s of d.samples ?? []) all.push(s)
}

function series(frames) {
  let g = null
  const av = []
  for (let i = 0; i < frames.length; i++) {
    const a = { x: frames[i].ax, y: frames[i].ay, z: frames[i].az }
    if (!g) g = { ...a }
    else {
      const dt = Math.max(1e-3, (frames[i].t - frames[i - 1].t) / 1000)
      const k = 1 - Math.exp(-dt / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    av.push(Math.abs((a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1))
  }
  const om = frames.map((f) => Math.hypot(f.gx, f.gy, f.gz))
  return { av, om }
}
const q = (a, p) => {
  const b = [...a].sort((x, y) => x - y)
  return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]
}

// 有效性判据（初值，待更多数据校准）：
//   p10(|a_vert|) < 0.20 g   说明整段存在"接近静止"的时段
//   p10(|ω|)      < 40 °/s   同上（角速度方向）
const ACC_LOW = 0.2
const OM_LOW = 40

console.log('#  工况        真值  时长   a_p10   a_p50   w_p10   w_p50  判定')
let bad = 0
const badIdx = []
all.forEach((s, i) => {
  const { av, om } = series(s.frames)
  const a10 = q(av, 0.1)
  const a50 = q(av, 0.5)
  const w10 = q(om, 0.1)
  const w50 = q(om, 0.5)
  const ok = a10 < ACC_LOW && w10 < OM_LOW
  if (!ok) {
    bad++
    badIdx.push(i + 1)
  }
  console.log(
    `${String(i + 1).padStart(2)}  ${(s.condition ?? '').padEnd(10)} ${String(s.trueReps).padStart(4)}  ${(s.durationMs / 1000).toFixed(1).padStart(4)}s  ` +
      `${a10.toFixed(3)}   ${a50.toFixed(3)}   ${w10.toFixed(0).padStart(5)}   ${w50.toFixed(0).padStart(5)}  ${ok ? '正常' : '**无静止期**'}`,
  )
})
console.log(`\n可疑录音 ${bad}/${all.length} 条：${badIdx.join(', ')}`)
console.log('（这些录音里信号从未回到接近静止，任何计数算法都无法切出次数，建议重采）')
