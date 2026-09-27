// 计数标定：用「整段录制 + 人工真实次数」的数据，评估并网格搜索 RepCounter 的门限。
//
// 前置：先在网站上用「整段（标定计数）」方式采集，务必填「本段真实次数」和「采集工况」。
// 运行：node scripts/calibrate-count.mjs [--collect-url http://...] [--grid]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const optOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const COLLECT_URL = optOf('collect-url', process.env.COLLECT_URL || 'https://lindoway1.pages.dev')
const DO_GRID = args.includes('--grid')
const LOCAL = 'D:/lindoway/.tmp-data/collect.json'

const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')

// ---- 取数：优先用刚拉下来的本地快照，否则从线上拉 ----
let rows
if (args.includes('--local')) {
  rows = JSON.parse(readFileSync(LOCAL, 'utf8'))
} else {
  try {
    const res = await fetch(`${COLLECT_URL}/api/collect`)
    rows = await res.json()
    if (!Array.isArray(rows)) throw new Error('返回不是数组')
    console.log(`已从 ${COLLECT_URL} 拉取 ${rows.length} 条`)
  } catch (e) {
    console.log(`线上拉取失败（${e.message}），改用本地快照 ${LOCAL}`)
    rows = JSON.parse(readFileSync(LOCAL, 'utf8'))
  }
}

/** 带真实次数与整段样本的标定记录（真实次数 0 的也要，专门用来验虚报） */
const allCalib = rows.filter(
  (r) => Array.isArray(r.samples) && r.samples.length >= 32 && typeof r.trueReps === 'number' && r.trueReps >= 0,
)
const withReps = allCalib.filter((r) => r.trueReps > 0)

console.log(`\n可用于计数标定的记录：${allCalib.length} 条（其中真实次数 >0 的 ${withReps.length} 条，=0 的 ${allCalib.length - withReps.length} 条）`)
if (allCalib.length === 0) {
  console.log(`
没有找到「整段录制 + 真实次数」的数据。请先在网站上采集：
  调试站 → 动作录制与标注 → 上传方式选「整段（标定计数）」
  → 点开始录制 → 连续做一整组（例如 12 次）→ 点停止录制
  → 填「本段真实次数」= 12，选「采集工况」→ 提交入库
建议覆盖工况：正常 / 快 / 慢 / 大幅度 / 小幅度 / 完全不动 / 轻轻晃动。
「完全不动」和「轻轻晃动」两条的真实次数填 0（它们本身就是 0 次），用来验虚报。
`)
  await server.close()
  process.exit(1)
}

// 真实次数为 0 的记录也要纳入：它们专门用来验虚报
console.log()

function runCounter(samples, opts) {
  const c = new RepCounter(opts)
  for (const s of samples) c.push(s)
  c.flush(samples[samples.length - 1].t)
  return c.repCount
}

const COND = {
  normal: '正常',
  fast: '快',
  slow: '慢',
  large: '大幅度',
  small: '小幅度',
  static: '完全不动',
  shake: '轻轻晃动',
  none: '未标',
}

function evaluate(opts, verbose) {
  const byCond = new Map()
  let sumAbs = 0
  let over = 0
  let under = 0
  let exact = 0
  const rowsOut = []
  for (const r of allCalib) {
    const got = runCounter(r.samples, opts)
    const want = r.trueReps
    const err = got - want
    sumAbs += Math.abs(err)
    if (err > 0) over++
    else if (err < 0) under++
    else exact++
    const c = r.condition ?? 'none'
    const b = byCond.get(c) ?? { n: 0, absErr: 0, over: 0, under: 0 }
    b.n++
    b.absErr += Math.abs(err)
    if (err > 0) b.over++
    if (err < 0) b.under++
    byCond.set(c, b)
    rowsOut.push({ condition: c, want, got, err, points: r.samples.length })
  }
  if (verbose) {
    console.log('工况'.padEnd(10) + '条数'.padStart(4) + '平均绝对误差'.padStart(13) + '虚报'.padStart(6) + '漏报'.padStart(6))
    for (const [c, b] of byCond) {
      console.log(
        (COND[c] ?? c).padEnd(10) +
          String(b.n).padStart(4) +
          (b.absErr / b.n).toFixed(2).padStart(13) +
          String(b.over).padStart(6) +
          String(b.under).padStart(6),
      )
    }
    console.log(`\n整体：平均绝对误差 ${(sumAbs / allCalib.length).toFixed(2)}  完全命中 ${exact}/${allCalib.length}  虚报 ${over}  漏报 ${under}`)
  }
  return { mae: sumAbs / allCalib.length, over, under, exact, n: allCalib.length, rowsOut }
}

const DEFAULT = {}
console.log('=== 当前默认参数 ===')
evaluate(DEFAULT, true)

// ---- 网格搜索 ----
if (DO_GRID) {
  console.log('\n=== 网格搜索（目标：先消虚报，再压平均绝对误差）===')
  const grid = { minRangeDeg: [15, 20, 25, 30, 35], minOmegaPeakDps: [30, 40, 50, 60], fallFrac: [0.3, 0.4, 0.5] }
  const results = []
  for (const minRangeDeg of grid.minRangeDeg)
    for (const minOmegaPeakDps of grid.minOmegaPeakDps)
      for (const fallFrac of grid.fallFrac) {
        const o = { minRangeDeg, minOmegaPeakDps, fallFrac }
        const r = evaluate(o, false)
        results.push({ ...o, ...r })
      }
  // 排序：虚报次数优先（越小越好），其次平均绝对误差
  results.sort((a, b) => a.over - b.over || a.mae - b.mae)
  console.log('minRange minOmega fallFrac |   MAE  虚报 漏报 命中')
  for (const r of results.slice(0, 12)) {
    console.log(
      `${String(r.minRangeDeg).padStart(8)} ${String(r.minOmegaPeakDps).padStart(8)} ${String(r.fallFrac).padStart(8)} | ` +
        `${r.mae.toFixed(2).padStart(6)} ${String(r.over).padStart(4)} ${String(r.under).padStart(4)} ${String(r.exact).padStart(4)}/${r.n}`,
    )
  }
  const best = results[0]
  console.log(`\n推荐参数：${JSON.stringify({ minRangeDeg: best.minRangeDeg, minOmegaPeakDps: best.minOmegaPeakDps, fallFrac: best.fallFrac })}`)
  console.log('注意：这是在你现有数据上的最优，样本越少越容易过拟合。至少要覆盖上面 7 种工况、每种 ≥3 条。')
  mkdirSync('D:/lindoway/.tmp-data/calib', { recursive: true })
  writeFileSync('D:/lindoway/.tmp-data/calib/count-grid.json', JSON.stringify(results, null, 2))
  console.log('完整结果已写入 .tmp-data/calib/count-grid.json')
} else {
  console.log('\n（加 --grid 可对 minRangeDeg / minOmegaPeakDps / fallFrac 做网格搜索）')
}

await server.close()
