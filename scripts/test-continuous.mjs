// 连续整组的计数回归：合成 12 次连续重复，验证计数器输出 12（不是 11）。
// 之前只有「单次样本」的评测，连续组（动作之间不完全放回起始位、末尾立刻停止）从未验证过。
// 运行：node scripts/test-continuous.mjs
import { createServer } from 'vite'

const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')

let fail = 0
const check = (n, c, extra = '') => {
  console.log(`  ${c ? '✓' : '✗'} ${n}${extra ? `  ${extra}` : ''}`)
  if (!c) fail++
}

/**
 * 合成一段连续的重复信号。
 * @param reps 次数
 * @param repMs 每次的上升+下降时长
 * @param restMs 两次之间的回落时长（0 = 不停顿，连续做）
 * @param peakOmega 角速度峰值
 * @param floorOmega 谷底角速度（模拟"没完全放回起始位"）
 */
function synth({ reps, repMs = 1600, restMs = 600, peakOmega = 80, floorOmega = 5, noise = 2, trailingRestMs = 1200 }) {
  const out = []
  let t = 0
  const push = (omega, ax, ay, az) => {
    out.push({
      t,
      ax,
      ay,
      az,
      // 把角速度分摊到三轴，模长 = omega
      gx: omega * 0.6 + (Math.random() - 0.5) * noise,
      gy: omega * 0.8 + (Math.random() - 0.5) * noise,
      gz: 0,
    })
    t += 20
  }
  for (let r = 0; r < reps; r++) {
    const n = Math.round(repMs / 20)
    for (let i = 0; i < n; i++) {
      const p = i / (n - 1)
      const omega = floorOmega + (peakOmega - floorOmega) * Math.sin(p * Math.PI)
      // 加速度：静止时 (0,0,1)，抬起时倾斜
      const tilt = (Math.PI / 3) * Math.sin(p * Math.PI)
      push(omega, 0, Math.sin(tilt), Math.cos(tilt))
    }
    const m = Math.round(restMs / 20)
    for (let i = 0; i < m; i++) push(floorOmega + Math.random() * noise, 0, 0, 1)
  }
  const k = Math.round(trailingRestMs / 20)
  for (let i = 0; i < k; i++) push(floorOmega + Math.random() * noise, 0, 0, 1)
  // 修掉模长（上面按 0.6/0.8 分摊，模长约为 0.36+0.64=1.0 倍）
  return out.map((s) => ({ ...s, gx: s.gx / Math.hypot(0.6, 0.8), gy: s.gy / Math.hypot(0.6, 0.8) }))
}

function count(samples, opts = {}) {
  const c = new RepCounter(opts)
  for (const s of samples) c.push(s)
  return { n: c.repCount, c }
}

console.log('=== 连续整组：12 次（理想输出 12）===\n')
const cases = [
  { name: '标准：每次 1.6s，间隔 0.6s，峰值 80°/s', opts: { reps: 12 } },
  { name: '不停顿（连续做，间隔 0.2s）', opts: { reps: 12, restMs: 200 } },
  { name: '不完整放回（谷底 25°/s）', opts: { reps: 12, restMs: 300, floorOmega: 25 } },
  { name: '做得快（每次 1.0s）', opts: { reps: 12, repMs: 1000, restMs: 400 } },
  { name: '做得慢（每次 3.0s）', opts: { reps: 12, repMs: 3000, restMs: 800 } },
  { name: '幅度小（峰值 45°/s）', opts: { reps: 12, peakOmega: 45 } },
  { name: '幅度大（峰值 200°/s）', opts: { reps: 12, peakOmega: 200 } },
  { name: '有噪声（±10°/s）', opts: { reps: 12, noise: 10 } },
]

for (const c of cases) {
  const s = synth(c.opts)
  const { n } = count(s)
  check(c.name.padEnd(34), n === 12, `实际 ${n}（${s.length} 点 / ${((s.length * 20) / 1000).toFixed(1)}s）`)
}

console.log('\n=== 不同次数（验证不偏移）===')
for (const reps of [3, 5, 8, 12, 20]) {
  const s = synth({ reps })
  const { n } = count(s)
  check(`做 ${reps} 次 → 数出`, n === reps, `实际 ${n}`)
}

console.log('\n=== 末尾立刻停止（最后一次在回落途中截断）===')
{
  const full = synth({ reps: 12, trailingRestMs: 1200 })
  const cut = full.slice(0, full.length - Math.round(1200 / 20) - Math.round(300 / 20))
  const c = new RepCounter()
  for (const s of cut) c.push(s)
  const tail = c.flush(cut[cut.length - 1].t)
  const n = c.repCount
  check('12 次录到第 12 次回落途中就停 → 仍应数出 12', n === 12, `实际 ${n}${tail ? '（flush 补上最后一次）' : ''}`)
}

console.log('\n=== 静止 / 轻晃（必须为 0）===')
for (const [name, peak] of [['完全不动', 2], ['轻轻晃动', 25]]) {
  const s = []
  let t = 0
  for (let i = 0; i < 1000; i++) {
    const w = peak * (0.5 + 0.5 * Math.sin(i / 7))
    s.push({ t, ax: 0.02 * Math.sin(i / 5), ay: 0.02 * Math.cos(i / 9), az: 1, gx: w * 0.6, gy: w * 0.8, gz: 0 })
    t += 20
  }
  const { n } = count(s.map((x) => ({ ...x, gx: x.gx / 1.0, gy: x.gy / 1.0 })))
  check(`${name}（峰值 ${peak}°/s，20 秒）`, n === 0, `实际 ${n}`)
}

console.log(`\n${fail === 0 ? '连续组计数全部通过' : `${fail} 项未通过`}`)
await server.close()
process.exit(fail === 0 ? 0 : 1)
