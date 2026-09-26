// 把指定记录的 |ω| / 积分角 / 采样点 画成 ASCII 曲线，输出到文件便于查看。
// 运行：node scripts/plot-record.mjs 2 201 202 27 > .tmp-data/plots.txt
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { segmentMotion } = await server.ssrLoadModule('/src/core/analysis/segmentation.ts')

const out = []
const say = (s = '') => out.push(s)

const ROWS = 14
function plot(vals, label, extraMarks = []) {
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const COLS = 150
  const step = Math.max(1, Math.ceil(vals.length / COLS))
  const cols = Math.ceil(vals.length / step)
  const grid = Array.from({ length: ROWS }, () => new Array(cols).fill(' '))
  const put = (col, v, ch) => {
    if (col < 0 || col >= cols) return
    const row = Math.min(ROWS - 1, Math.max(0, Math.round(((v - min) / (max - min || 1)) * (ROWS - 1))))
    grid[ROWS - 1 - row][col] = ch
  }
  vals.forEach((v, k) => {
    if (k % step) return
    put(Math.floor(k / step), v, '*')
  })
  for (const m of extraMarks) put(Math.floor(m / step), min, '^')
  say(`\n${label}   range [${min.toFixed(1)} .. ${max.toFixed(1)}]  step=${step}点(${(step * 20).toFixed(0)}ms)`)
  grid.forEach((r) => say('  |' + r.join('')))
  say('  +' + '-'.repeat(cols))
}

for (const idx of process.argv.slice(2).map(Number)) {
  const r = rows[idx]
  const ss = r.samples
  say(`\n${'='.repeat(150)}`)
  say(`#${idx}  ${r.actionName}  actionId=${r.actionId}  n=${ss.length}  dur=${((ss.at(-1).t - ss[0].t) / 1000).toFixed(1)}s`)
  say(`annotations: ${JSON.stringify(r.annotations ?? [])}`)

  const anchors = ss.map((s) => Math.hypot(s.gx, s.gy, s.gz))
  const segs = segmentMotion(ss)
  say(`segmentMotion → ${segs.length} 段: ${segs.map((s) => `[${s.start}..${s.end}]`).join(' ')}`)
  plot(anchors, '|ω| (°/s)    ^ = segMotion 分段边界', segs.map((s) => s.start))

  // 三轴原始角速度
  for (const a of ['gx', 'gy', 'gz']) {
    const v = ss.map((s) => s[a])
    say(`\n${a}   range [${Math.min(...v).toFixed(1)} .. ${Math.max(...v).toFixed(1)}]`)
    const min = Math.min(...v)
    const max = Math.max(...v)
    const COLS = 150
    const step = Math.max(1, Math.ceil(v.length / COLS))
    const cols = Math.ceil(v.length / step)
    const grid = Array.from({ length: 10 }, () => new Array(cols).fill(' '))
    v.forEach((val, k) => {
      if (k % step) return
      const row = Math.min(9, Math.max(0, Math.round(((val - min) / (max - min || 1)) * 9)))
      grid[9 - row][Math.floor(k / step)] = '*'
    })
    grid.forEach((rr) => say('  |' + rr.join('')))
    say('  +' + '-'.repeat(cols))
  }
}

writeFileSync('D:/lindoway/.tmp-data/plots.txt', out.join('\n'))
console.log('wrote .tmp-data/plots.txt', out.length, 'lines')
await server.close()
