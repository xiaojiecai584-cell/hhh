// 停顿法重标定：在 55 条标注数据上网格搜索停顿门槛，
// 并对比两种计数口径：
//   all   —— 所有停顿都算（等于"数停顿"）
//   major —— 只有"大停顿"（持续时间够长）才算 1 次；这是本次要验证的思路
//
// 运行：node scripts/fit-pauses.mjs <json>
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { auditFrames } = await server.ssrLoadModule('/src/core/analysis/sampleAudit.ts')

// 只保留通过录音审计的样本（信号里确实有静止期）
const all = (d.samples ?? []).map((s) => ({
  s,
  frames: s.frames.map((f) => ({ t: f.t, ax: f.ax, ay: f.ay, az: f.az, gx: f.gx, gy: f.gy, gz: f.gz })),
}))
const data = all.filter((x) => auditFrames(x.frames).ok)
console.log(`样本 ${all.length} 条 → 通过审计 ${data.length} 条\n`)

/** 切出静止段：|ω| 连续低于 omegaTh 达 minRunMs 以上 */
function findPauses(frames, omegaTh, minRunMs) {
  const out = []
  let runStart = -1
  for (let i = 0; i < frames.length; i++) {
    const w = Math.hypot(frames[i].gx, frames[i].gy, frames[i].gz)
    if (w < omegaTh) {
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      const dur = frames[i - 1].t - frames[runStart].t
      if (dur >= minRunMs) out.push({ startMs: frames[runStart].t, endMs: frames[i - 1].t, durMs: dur })
      runStart = -1
    }
  }
  if (runStart >= 0) {
    const dur = frames[frames.length - 1].t - frames[runStart].t
    if (dur >= minRunMs) out.push({ startMs: frames[runStart].t, endMs: frames[frames.length - 1].t, durMs: dur })
  }
  return out
}

function evaluate(label, opt) {
  const { omegaTh, minRunMs, majorMs, mode } = opt
  let ok = 0
  let absErr = 0
  const rows = []
  for (const x of data) {
    const pauses = findPauses(x.frames, omegaTh, minRunMs)
    const n = mode === 'major' ? pauses.filter((p) => p.durMs >= majorMs).length : pauses.length
    const diff = n - x.s.trueReps
    if (diff === 0) ok++
    absErr += Math.abs(diff)
    rows.push({ truth: x.s.trueReps, n, diff, cond: x.s.condition })
  }
  return { ok, absErr, rows, label, opt }
}

const results = []
// 口径 all：所有停顿都算
for (const omegaTh of [8, 10, 12, 15, 20])
  for (const minRunMs of [100, 200, 300, 500])
    results.push(evaluate('all', { omegaTh, minRunMs, majorMs: 0, mode: 'all' }))
// 口径 major：只数"大停顿"
for (const omegaTh of [8, 10, 12, 15, 20])
  for (const minRunMs of [100, 200, 300, 500])
    for (const majorMs of [400, 600, 800, 1000, 1500])
      results.push(evaluate('major', { omegaTh, minRunMs, majorMs, mode: 'major' }))

const rank = (arr) => [...arr].sort((a, b) => a.absErr - b.absErr || b.ok - a.ok)

console.log('=== 口径 all（所有停顿各算 1 次）最佳 5 组 ===')
for (const r of rank(results.filter((x) => x.label === 'all')).slice(0, 5)) {
  const o = r.opt
  console.log(`  w<${o.omegaTh} run>=${o.minRunMs}ms  correct ${r.ok}/${data.length}  MAE ${(r.absErr / data.length).toFixed(2)}`)
}

console.log('\n=== 口径 major（只有大停顿各算 1 次）最佳 8 组 ===')
const majors = rank(results.filter((x) => x.label === 'major'))
for (const r of majors.slice(0, 8)) {
  const o = r.opt
  console.log(
    `  w<${o.omegaTh} run>=${o.minRunMs}ms major>=${o.majorMs}ms  correct ${r.ok}/${data.length}  MAE ${(r.absErr / data.length).toFixed(2)}`,
  )
}

await server.close()
