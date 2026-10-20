// 验证「计数发生在底部停顿，而不是顶端」——即判位的相位是否正确。
//
// 背景：判顶/底靠「停顿序号奇偶」，序号在武装时清零。
// 若在底部停着时就武装了（|ω| ≥ armOmegaDps=12，手微微一调就够），
// 那个底部停顿会被当成第 1 次停顿 → 奇数 → 判成顶 → 整条链错一位，
// 真正的顶被当成底 → **在顶端计数**。现场反馈正是"在最高点计数比较普遍"。
//
// 本脚本在底部停顿期间注入 ±20°/s 的缓慢手抖（超过武装门限 12、低于停顿门限 30），
// 强制在底部停顿中武装，然后检查每次计数的结束时刻是否落在底部停顿窗口内。
//
// 运行：node scripts/verify-count-position.mjs
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')

const DT = 20
const G = 9.80665
const TRAVEL = 0.35

function synth(reps, { bottom = 500, top = 500, lift = 800, lower = 800, jitter = 0 } = {}) {
  const out = []
  let t = 0
  const push = (ms, fn, isPause) => {
    const n = Math.round(ms / DT)
    for (let i = 0; i < n; i++) {
      const p = i / Math.max(1, n - 1)
      const x = fn(p) * TRAVEL
      const m = out.length
      let av = 0
      if (m >= 2) {
        const x0 = out[m - 2]._x
        const x1 = out[m - 1]._x
        av = (x - 2 * x1 + x0) / ((DT / 1000) ** 2) / G
      }
      const moving = Math.abs(fn(Math.min(1, p + 0.02)) - fn(Math.max(0, p - 0.02))) > 1e-6
      const w = moving ? 50 * 0.5 * (1 - Math.cos(2 * Math.PI * p)) : 0
      const jit = isPause ? jitter * (0.5 + 0.5 * Math.sin(t / 300)) : 0
      out.push({ t, ax: 0, ay: 0, az: 1 + av, gx: jit * 0.6, gy: w + jit * 0.8, gz: 0, _x: x })
      t += DT
    }
  }
  push(bottom, () => 0, true)
  for (let r = 0; r < reps; r++) {
    push(lift, (p) => (1 - Math.cos(Math.PI * p)) / 2, false)
    push(top, () => 1, true)
    push(lower, (p) => (1 + Math.cos(Math.PI * p)) / 2, false)
    push(bottom, () => 0, true)
  }
  push(600, () => 0, true)
  const windows = [[0, bottom]]
  for (let r = 0; r < reps; r++) {
    const s = bottom + r * (lift + top + lower + bottom)
    windows.push([s + lift + top + lower, s + lift + top + lower + bottom])
  }
  return { samples: out.map(({ _x, ...s }) => s), windows }
}

let fail = 0
const check = (name, ok, detail) => {
  if (!ok) fail++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name.padEnd(40)}${detail ?? ''}`)
}

console.log('=== 计数位置：必须落在【底部停顿】窗口内 ===\n')
for (const jitter of [0, 12, 20, 26]) {
  const { samples, windows } = synth(12, { jitter })
  const c = new RepCounter({ signal: 'gyro', requirePause: true })
  const evs = []
  for (const s of samples) {
    const e = c.push(s)
    if (e) evs.push(e)
  }
  const tail = c.flush(samples[samples.length - 1].t)
  if (tail) evs.push(tail)
  const atBottom = evs.filter((e) => windows.some(([a, b]) => e.endMs >= a - 60 && e.endMs <= b + 60)).length
  check(
    `底部停顿手抖 ${jitter}°/s × 12 次`,
    c.repCount === 12 && atBottom === 12,
    `计数 ${c.repCount}，落在底部窗口 ${atBottom}`,
  )
}

console.log(`\n${fail === 0 ? '全部通过' : `${fail} 项未通过`}`)
await server.close()
process.exit(fail === 0 ? 0 : 1)
