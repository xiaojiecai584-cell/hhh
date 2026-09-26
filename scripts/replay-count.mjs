// 用线上真实数据回放对比：segmentMotion（离线切段，现被当计数器用） vs RepCounter（在线计数）。
// 运行：node scripts/replay-count.mjs
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { segmentMotion } = await server.ssrLoadModule('/src/core/analysis/segmentation.ts')
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')

// 结构上可确定的真值（数据里没有人工数出的次数，只能用这几个"确定"的例子当基准）
const EXPECT = {
  2: { n: 19, why: '40s 连续录音，波形周期清晰' },
  27: { n: 1, why: '单次侧平举，之后 3.5s 静止' },
  201: { n: 0, why: '全程 |ω|≤28°/s，只是站着晃动' },
  202: { n: 0, why: '全程 |ω|≤23°/s，只是站着晃动' },
  203: { n: 1, why: '单次，前 6s 未达活动门槛' },
  24: { n: 1, why: '单次' },
  25: { n: 1, why: '单次' },
  26: { n: 1, why: '单次' },
  13: { n: 1, why: '单次' },
}

const cont = rows.map((r, i) => ({ i, r, ss: r.samples ?? [] })).filter((x) => x.ss.length >= 150)

console.log('idx  名称        n     dur   |ω|max   segmentMotion  RepCounter   真值  结果')
console.log('-'.repeat(94))
let ok = 0
let tot = 0
for (const { i, r, ss } of cont) {
  const om = Math.max(...ss.map((s) => Math.hypot(s.gx, s.gy, s.gz)))
  const seg = segmentMotion(ss).length
  const c = new RepCounter()
  const evs = []
  for (const s of ss) {
    const e = c.push(s)
    if (e) evs.push(e)
  }
  const exp = EXPECT[i]
  let verdict = '—'
  if (exp) {
    tot++
    if (c.repCount === exp.n) {
      ok++
      verdict = '✓'
    } else verdict = `✗ (${exp.why})`
  }
  console.log(
    `${String(i).padStart(3)}  ${(r.actionName ?? '?').padEnd(8)}  ${String(ss.length).padStart(4)}  ` +
      `${((ss.at(-1).t - ss[0].t) / 1000).toFixed(1).padStart(5)}s  ${om.toFixed(0).padStart(6)}  ` +
      `${String(seg).padStart(12)}  ${String(c.repCount).padStart(10)}  ${String(exp?.n ?? '-').padStart(5)}  ${verdict}`,
  )
}
console.log('-'.repeat(94))
console.log(`基准用例通过 ${ok}/${tot}`)

// 详细看几条
const detail = [2, 27, 201, 203]
for (const i of detail) {
  const ss = rows[i].samples
  const c = new RepCounter()
  const evs = []
  for (const s of ss) {
    const e = c.push(s)
    if (e) evs.push(e)
  }
  console.log(`\n#${i} ${rows[i].actionName}  n=${ss.length} → ${evs.length} 次`)
  for (const e of evs.slice(0, 25)) {
    console.log(
      `   第${String(e.index).padStart(2)}次  ${(e.durationMs / 1000).toFixed(2)}s  幅度${e.rangeDeg.toFixed(1)}°  ` +
        `ω峰值${e.peakOmegaDps.toFixed(0)} 扭转占比${(e.twistRatio * 100).toFixed(0)}% ` +
        `${e.flags.wristFlip ? '腕翻 ' : ''}${e.flags.shortRange ? '幅度不足 ' : ''}${e.flags.momentum ? '借力' : ''}`,
    )
  }
}

await server.close()
