// 同时在多份真实录音上网格搜索，找同时满足所有真值的参数组合。
// 运行：node scripts/fit-multi.mjs <json1> <json2> ...
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const files = process.argv.slice(2)
const sets = files.map((f) => {
  const d = JSON.parse(readFileSync(f, 'utf8'))
  return {
    name: `${d.actionName}/${d.condition}/${d.trueReps}次`,
    trueReps: d.trueReps,
    samples: d.frames.map((x) => ({ t: x.t, ax: x.ax, ay: x.ay, az: x.az, gx: x.gx, gy: x.gy, gz: x.gz })),
  }
})

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { repOptionsFor } = await server.ssrLoadModule('/src/core/analysis/repOptions.ts')

function countFor(set, extra) {
  const c = new RepCounter({ ...repOptionsFor(1), ...extra })
  for (const s of set.samples) c.push(s)
  c.flush(set.samples[set.samples.length - 1].t)
  return c.repCount
}

console.log('样本：')
for (const s of sets) console.log(`  ${s.name}  目标停顿 ${s.trueReps * 2}`)
console.log('')

// 当前配置
console.log('=== 当前默认 ===')
let okAll = true
for (const s of sets) {
  const n = countFor(s, {})
  const ok = n === s.trueReps
  if (!ok) okAll = false
  console.log(`  ${s.name.padEnd(22)} → ${n}  ${ok ? '✓' : `差 ${n - s.trueReps}`}`)
}
console.log(okAll ? '  （全部命中）' : '')

// 网格
console.log('\n=== 网格搜索（要求全部命中）===')
const grid = []
for (const floor of [6, 8, 10, 12, 14, 16])
  for (const accelFloor of [0.03, 0.05, 0.07])
    for (const ratio of [0.2, 0.25, 0.3, 0.35])
      for (const quietFrac of [0.55, 0.6, 0.65, 0.7])
        for (const pauseMinMs of [240, 300])
          grid.push({ floor, accelFloor, ratio, quietFrac, pauseMinMs })

const hits = []
for (const g of grid) {
  const extra = {
    pauseOmegaFloor: g.floor,
    pauseAccelFloor: g.accelFloor,
    pauseQuietRatio: g.ratio,
    pauseQuietFrac: g.quietFrac,
    pauseMinMs: g.pauseMinMs,
  }
  const res = sets.map((s) => countFor(s, extra))
  if (res.every((n, i) => n === sets[i].trueReps)) hits.push({ ...g, res })
}

console.log(`  共 ${grid.length} 种组合，全部命中的有 ${hits.length} 种`)
if (hits.length) {
  for (const k of ['floor', 'accelFloor', 'ratio', 'quietFrac', 'pauseMinMs']) {
    const v = [...new Set(hits.map((h) => h[k]))].sort((a, b) => a - b)
    console.log(`  ${k.padEnd(12)}: ${v.join(', ')}`)
  }
  console.log('\n  前 10 个命中组合：')
  for (const h of hits.slice(0, 10)) {
    console.log(
      `    floor ${String(h.floor).padStart(2)} accelF ${h.accelFloor} ratio ${h.ratio} quiet ${h.quietFrac} win ${h.pauseMinMs}`,
    )
  }
} else {
  // 最接近的
  const scored = grid
    .map((g) => {
      const extra = {
        pauseOmegaFloor: g.floor,
        pauseAccelFloor: g.accelFloor,
        pauseQuietRatio: g.ratio,
        pauseQuietFrac: g.quietFrac,
        pauseMinMs: g.pauseMinMs,
      }
      const res = sets.map((s) => countFor(s, extra))
      const err = res.reduce((a, n, i) => a + Math.abs(n - sets[i].trueReps), 0)
      return { ...g, res, err }
    })
    .sort((a, b) => a.err - b.err)
    .slice(0, 8)
  console.log('  没有全中的，误差最小的：')
  for (const s of scored) {
    console.log(
      `    floor ${String(s.floor).padStart(2)} accelF ${s.accelFloor} ratio ${s.ratio} quiet ${s.quietFrac} win ${s.pauseMinMs} → [${s.res.join(', ')}] 误差 ${s.err}`,
    )
  }
}

await server.close()
