// 用真实录音跑真正的 RepCounter，网格搜索参数，找出能让 12 次数出 12 的组合。
// 运行：node scripts/fit-real.mjs "<json 路径>"
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const path = process.argv[2]
const d = JSON.parse(readFileSync(path, 'utf8'))
const samples = d.frames.map((f) => ({ t: f.t, ax: f.ax, ay: f.ay, az: f.az, gx: f.gx, gy: f.gy, gz: f.gz }))

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { repOptionsFor } = await server.ssrLoadModule('/src/core/analysis/repOptions.ts')

function run(extra) {
  const c = new RepCounter({ ...repOptionsFor(1), ...extra })
  const evs = []
  for (const s of samples) {
    const e = c.push(s)
    if (e) evs.push(e)
  }
  const tail = c.flush(samples[samples.length - 1].t)
  if (tail) evs.push(tail)
  return { n: c.repCount, evs }
}

const TARGET = d.trueReps
console.log(`真实次数 ${TARGET}（应为 ${TARGET * 2} 个停顿）\n`)

console.log('=== 当前默认配置 ===')
{
  const { n } = run({})
  console.log(`  计数 ${n}   ${n === TARGET ? '✓' : `差 ${n - TARGET}`}`)
}

console.log('\n=== 网格搜索（目标恰好 ' + TARGET + '） ===')
console.log('  floor accelF ratio moveR → 计数')
const rows = []
for (const floor of [6, 8, 10, 12, 14]) {
  for (const accelFloor of [0.03, 0.04, 0.05, 0.06]) {
    for (const ratio of [0.2, 0.3, 0.4]) {
      for (const moveRatio of [0.5, 0.7, 0.9, 1.2]) {
        const { n } = run({
          pauseOmegaFloor: floor,
          pauseAccelFloor: accelFloor,
          pauseQuietRatio: ratio,
          moveRatio,
        })
        rows.push({ floor, accelFloor, ratio, moveRatio, n })
      }
    }
  }
}
const exact = rows.filter((r) => r.n === TARGET)
console.log(`  共 ${rows.length} 种组合，命中 ${TARGET} 的有 ${exact.length} 种`)
if (exact.length) {
  // 命中集合的范围，取中间值最稳
  const rng = (k) => {
    const v = [...new Set(exact.map((r) => r[k]))].sort((a, b) => a - b)
    return `${v[0]}~${v[v.length - 1]}（${v.length} 个取值）`
  }
  console.log(`  pauseOmegaFloor : ${rng('floor')}`)
  console.log(`  pauseAccelFloor : ${rng('accelFloor')}`)
  console.log(`  pauseQuietRatio : ${rng('ratio')}`)
  console.log(`  moveRatio       : ${rng('moveRatio')}`)
  console.log('\n  前 12 个命中组合：')
  for (const r of exact.slice(0, 12)) {
    console.log(`    floor ${String(r.floor).padStart(2)}  accelF ${r.accelFloor}  ratio ${r.ratio}  moveR ${r.moveRatio}`)
  }
} else {
  const near = [...rows].sort((a, b) => Math.abs(a.n - TARGET) - Math.abs(b.n - TARGET)).slice(0, 10)
  console.log('  没有精确命中，最接近的：')
  for (const r of near) {
    console.log(`    floor ${String(r.floor).padStart(2)}  accelF ${r.accelFloor}  ratio ${r.ratio}  moveR ${r.moveRatio}  → ${r.n}（差 ${r.n - TARGET}）`)
  }
}

console.log('\n=== 逐次明细（用命中组合的中位值） ===')
if (exact.length) {
  const mid = (k) => {
    const v = [...new Set(exact.map((r) => r[k]))].sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  const opt = {
    pauseOmegaFloor: mid('floor'),
    pauseAccelFloor: mid('accelFloor'),
    pauseQuietRatio: mid('ratio'),
    moveRatio: mid('moveRatio'),
  }
  console.log(`  参数: ${JSON.stringify(opt)}`)
  const { n, evs } = run(opt)
  console.log(`  计数 ${n}`)
  for (const e of evs) {
    console.log(`    第${e.index}次  ${(e.startMs / 1000).toFixed(2)}s → ${(e.endMs / 1000).toFixed(2)}s  时长 ${(e.durationMs / 1000).toFixed(2)}s  ω峰值 ${e.peakOmegaDps.toFixed(0)}`)
  }
}
await server.close()
