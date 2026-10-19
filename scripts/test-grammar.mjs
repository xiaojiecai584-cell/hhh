// 语法化边界的验证：合成「哑铃竖直平移 + 两端停顿」的信号。
//
// 现场确认：坐姿推举在**顶端与底端各有 0.4~0.6 秒停顿**，哑铃竖直行程约 0.35m，
// 且哑铃手柄始终接近水平 → 几乎不旋转。所以合成信号必须满足：
//   · 竖直位移决定加速度（a_vert = x'' / g），姿态不变
//   · 停顿期间加速度与角速度都接近 0
//   · 动作期间角速度只有小幅（腕部微动），不是主要信号
//
// 运行：node scripts/test-grammar.mjs
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { shapeTemplateFor } = await server.ssrLoadModule('/src/core/analysis/motionTemplates.ts')

const DT = 20 // ms，50Hz
const G = 9.80665

/**
 * 合成一次坐姿推举组。
 * @param reps 次数
 * @param opts.bottomPauseMs 底部停顿时长（含动作之间的休息）
 * @param opts.topPauseMs 顶部停顿时长
 * @param opts.travelM 单次竖直行程（米）
 * @param opts.liftMs 上举时长
 * @param opts.lowerMs 下放时长
 * @param opts.travelScale 行程缩放（模拟幅度不足）
 */
function synthPress(reps, opts = {}) {
  const {
    bottomPauseMs = 500,
    topPauseMs = 500,
    travelM = 0.35,
    liftMs = 800,
    lowerMs = 800,
    travelScale = 1,
    gyroPeak = 55,
    noise = 1.5,
  } = opts
  const out = []
  let t = 0
  // 竖直高度剖面：停顿段高度不变（加速度 0），动作段用 1-cos 平滑
  const push = (ms, heightAt) => {
    const n = Math.round(ms / DT)
    for (let i = 0; i < n; i++) {
      const p = i / Math.max(1, n - 1)
      const x = heightAt(p) * travelM * travelScale
      // 数值二阶差分求竖直加速度（与真实积分链路一致）
      const m = out.length
      let aVert = 0
      if (m >= 2) {
        const x0 = out[m - 2]._x
        const x1 = out[m - 1]._x
        aVert = (x - 2 * x1 + x0) / ((DT / 1000) ** 2) / G
      }
      // 角速度：动作段有小幅，停顿段≈0（哑铃几乎不旋转）
      const moving = Math.abs(heightAt(Math.min(1, p + 0.02)) - heightAt(Math.max(0, p - 0.02))) > 1e-6
      const w = moving ? gyroPeak * 0.5 * (1 - Math.cos(2 * Math.PI * p)) : 0
      out.push({
        t,
        ax: (Math.random() - 0.5) * 0.004,
        ay: (Math.random() - 0.5) * 0.004,
        az: 1 + aVert + (Math.random() - 0.5) * (noise / 1000),
        gx: (Math.random() - 0.5) * noise * 2,
        gy: w + (Math.random() - 0.5) * noise,
        gz: (Math.random() - 0.5) * noise,
        _x: x,
      })
      t += DT
    }
  }
  push(bottomPauseMs, () => 0)
  for (let r = 0; r < reps; r++) {
    push(liftMs, (p) => (1 - Math.cos(Math.PI * p)) / 2)
    push(topPauseMs, () => 1)
    push(lowerMs, (p) => (1 + Math.cos(Math.PI * p)) / 2)
    push(bottomPauseMs, () => 0)
  }
  push(600, () => 0)
  return out.map(({ _x, ...s }) => s)
}

/** 只有晃动、没有竖直行程 */
function synthShake(ms = 20000, peak = 25) {
  const out = []
  for (let i = 0; i < ms / DT; i++) {
    const w = peak * (0.5 + 0.5 * Math.sin(i / 7))
    out.push({
      t: i * DT,
      ax: 0.02 * Math.sin(i / 5),
      ay: 0.02 * Math.cos(i / 9),
      az: 1 + 0.01 * Math.sin(i / 3),
      gx: w * 0.6,
      gy: w * 0.8,
      gz: 0,
    })
  }
  return out
}

function run(samples, extra = {}) {
  const tpl = shapeTemplateFor(1)
  const c = new RepCounter({ signal: 'gyro', template: tpl?.mean, templateAxis: tpl?.axis, ...extra })
  for (const s of samples) c.push(s)
  c.flush(samples[samples.length - 1].t)
  return c
}

let fail = 0
const check = (name, ok, detail) => {
  if (!ok) fail++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name.padEnd(46)}${detail ?? ''}`)
}

console.log('=== 语法化边界：底停顿 → 上举 → 顶停顿 → 下放 → 底停顿 ===\n')
console.log('（哑铃竖直行程 0.35m，两端各停 0.5s，几乎不旋转）\n')

console.log('[1] 不同次数必须精确')
for (const n of [1, 3, 5, 12, 20]) {
  const c = run(synthPress(n))
  check(`做 ${n} 次`, c.repCount === n, `实际 ${c.repCount}`)
}

console.log('\n[2] 停顿时长在 0.4~0.6s 范围内都要能数对')
for (const ms of [400, 500, 600]) {
  const c = run(synthPress(12, { bottomPauseMs: ms, topPauseMs: ms }))
  check(`两端各停 ${ms}ms × 12 次`, c.repCount === 12, `实际 ${c.repCount}`)
}

console.log('\n[2b] 停顿期间有手抖 / 呼吸扰动（现场真实情况）')
{
  // ±16°/s 的陀螺仪噪声：旧实现要求「连续 400ms 无噪声样本」，一个毛刺就把整次停顿作废，
  // 这正是现场「少计很多次」的成因；改成滑动窗口比例（允许 20% 噪声样本）后应能数对。
  const c = run(synthPress(12, { noise: 8 }))
  check('陀螺仪噪声 ±16°/s × 12 次', c.repCount === 12, `实际 ${c.repCount}`)
  // 极端噪声（±30°/s）会逼近 pauseOmegaDps=40 的判别边界，如实记录、不作为通过条件
  const c2 = run(synthPress(12, { noise: 15 }))
  console.log(`  ·  陀螺仪噪声 ±30°/s × 12 次（已知上限，仅记录）      实际 ${c2.repCount}`)
}

console.log('\n[3] 节律变化不能丢次数')
const rhythm = [
  ['上举/下放各 0.5s（快）', { liftMs: 500, lowerMs: 500 }],
  ['上举/下放各 1.2s（慢）', { liftMs: 1200, lowerMs: 1200 }],
  ['上快下慢', { liftMs: 500, lowerMs: 1200 }],
]
for (const [name, o] of rhythm) {
  const c = run(synthPress(12, o))
  check(name, c.repCount === 12, `实际 ${c.repCount}`)
}

console.log('\n[4] 行程变化不能丢次数')
for (const [name, scale] of [
  ['行程减半（0.175m）', 0.5],
  ['行程加大（0.7m）', 2],
]) {
  const c = run(synthPress(12, { travelScale: scale }))
  check(name, c.repCount === 12, `实际 ${c.repCount}`)
}

console.log('\n[5] 静止与晃动必须为 0')
check('轻轻晃动 20 秒（峰值 25°/s）', run(synthShake()).repCount === 0, `实际 ${run(synthShake()).repCount}`)
check('完全静止 20 秒', run(synthShake(20000, 2)).repCount === 0, `实际 ${run(synthShake(20000, 2)).repCount}`)

console.log('\n[6] 半程动作（没有顶停顿、只有底部停顿）')
{
  // 判位已改为「停顿序号交替」（顶/底严格交替，不需要积分）。
  // 若动作只有一种停顿，交替假设不成立，会按每隔一次计——这是交替判位的
  // 结构性前提，如实记录、不作为通过条件。现场坐姿推举两端都有停顿，满足前提。
  const s = synthPress(6, { topPauseMs: 0, bottomPauseMs: 500 })
  const c = run(s)
  console.log(`  ·  只有底部停顿 × 6 次（已知限制，仅记录）            实际 ${c.repCount}`)
}

console.log(`\n${fail === 0 ? '全部通过' : `${fail} 项未通过`}`)
await server.close()
process.exit(fail === 0 ? 0 : 1)
