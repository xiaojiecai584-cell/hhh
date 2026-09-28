// 离线实验①：竖直加速度积分（a_vert → v → x），验证用「位移」判断一次重复是否可行。
//
// 物理前提：**传感器装在哑铃上**。做推举时哑铃手柄始终接近水平、只做竖直平移，
// 所以陀螺仪几乎没有信号（实测 d 中位仅 4.6°），真正携带动作信息的是竖直方向的线性加速度。
//
// 方法：
//   1. 用一阶低通估计传感器系里的重力方向 ĝ（τ=1s）
//   2. a_vert = (a·ĝ/|ĝ|) − 1g        —— 去掉重力，得到纯竖直线性加速度
//   3. v = ∫a_vert dt，x = ∫v dt，用**零速修正**消漂移：
//      找出"静止段"（|a_vert| 与 |ω| 都低且持续 ≥100ms），把速度段切开，
//      每一段两端都强制 v=0（线性去趋势），再积出位移。
//   4. 看「一段内位移的峰峰值」能不能把真实重复与晃动分开。
//
// 运行：node scripts/exp-accel.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const P = 'D:/lindoway/.tmp-data/pkg/fitness_motion_ai_package'
const G = 9.80665
const F = (n, d = 3) => n.toFixed(d)

/** 返回 { aVert:[], segs:[{i0,i1,vPeak,xPP,durMs}] } */
function kinematics(s) {
  const n = s.length
  const aVert = new Array(n).fill(0)
  let g = null
  for (let i = 0; i < n; i++) {
    const a = { x: s[i].ax, y: s[i].ay, z: s[i].az }
    if (!g) g = { ...a }
    else {
      const dti = i > 0 ? Math.max(1e-3, (s[i].t - s[i - 1].t) / 1000) : 0.02
      const k = 1 - Math.exp(-dti / 1.0)
      g = { x: g.x + (a.x - g.x) * k, y: g.y + (a.y - g.y) * k, z: g.z + (a.z - g.z) * k }
    }
    const gm = Math.hypot(g.x, g.y, g.z) || 1
    aVert[i] = (a.x * g.x + a.y * g.y + a.z * g.z) / gm - 1 // 单位 g
  }

  // 静止判定：|a_vert| 与 |ω| 都低
  const quiet = s.map((p, i) => Math.abs(aVert[i]) < 0.03 && Math.hypot(p.gx, p.gy, p.gz) < 20)
  // 找静止段（≥5 点 = 100ms）
  const rests = []
  let run = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && quiet[i]) {
      if (run < 0) run = i
    } else if (run >= 0) {
      if (i - run >= 5) rests.push([run, i - 1])
      run = -1
    }
  }

  // 运动段 = 静止段之间
  const bounds = []
  if (rests.length === 0) bounds.push([0, n - 1])
  else {
    if (rests[0][0] > 0) bounds.push([0, rests[0][0] - 1])
    for (let k = 0; k + 1 < rests.length; k++) bounds.push([rests[k][1] + 1, rests[k + 1][0] - 1])
    if (rests[rests.length - 1][1] < n - 1) bounds.push([rests[rests.length - 1][1] + 1, n - 1])
  }

  // 每段两端强制 v=0：先积分，再线性去趋势
  const v = new Array(n).fill(0)
  const x = new Array(n).fill(0)
  const segs = []
  let xBase = 0
  for (const [i0, i1] of bounds) {
    if (i1 - i0 < 4) continue
    const vs = [0]
    for (let i = i0 + 1; i <= i1; i++) {
      const dti = Math.max(1e-3, (s[i].t - s[i - 1].t) / 1000)
      vs.push(vs[vs.length - 1] + ((aVert[i] + aVert[i - 1]) / 2) * G * dti)
    }
    const drift = vs[vs.length - 1] / (vs.length - 1)
    for (let k = 0; k < vs.length; k++) vs[k] -= drift * k
    const xs = [0]
    for (let k = 1; k < vs.length; k++) {
      const dti = Math.max(1e-3, (s[i0 + k].t - s[i0 + k - 1].t) / 1000)
      xs.push(xs[xs.length - 1] + ((vs[k] + vs[k - 1]) / 2) * dti)
    }
    for (let k = 0; k < vs.length; k++) {
      v[i0 + k] = vs[k]
      x[i0 + k] = xBase + xs[k]
    }
    xBase = x[i1]
    segs.push({
      i0,
      i1,
      vPeak: Math.max(...vs.map(Math.abs)),
      xPP: Math.max(...xs) - Math.min(...xs),
      durMs: s[i1].t - s[i0].t,
    })
  }
  return { aVert, v, x, segs, restCount: rests.length }
}

// ---- 取数 ----
const mf = readFileSync(`${P}/data/real_experiment/annotations/manifest.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const readCsv = (rel) => {
  const f = join(P, 'data/real_experiment', rel.replace('../', ''))
  if (!existsSync(f)) return null
  const L = readFileSync(f, 'utf8').trim().split(/\r?\n/)
  const h = L[0].split(',').map((x) => x.trim())
  const i = (k) => h.indexOf(k)
  return L.slice(1).map((l) => {
    const c = l.split(',')
    const v = (k) => Number(c[i(k)])
    return { t: v('timestamp'), ax: v('ax'), ay: v('ay'), az: v('az'), gx: v('gx'), gy: v('gy'), gz: v('gz') }
  })
}

const groups = { 1: [], 2: [] }
for (const r of mf) {
  if (!groups[r.actionId]) continue
  const s = readCsv(r.file)
  if (!s || s.length < 32) continue
  groups[r.actionId].push({ id: r.sampleId, s })
}
const NAME = { 1: '坐姿推举', 2: '站姿侧平举' }

const q = (a, p) => {
  if (!a.length) return NaN
  const x = [...a].sort((m, n) => m - n)
  return x[Math.floor(p * (x.length - 1))]
}

console.log('=== 竖直加速度积分的信号强度 ===\n')
console.log('分组                 n     峰值|a_vert|(g)   峰值|v|(m/s)   段内位移峰峰x(m)')
const summary = {}
for (const aid of [1, 2]) {
  const rows = []
  for (const { id, s } of groups[aid]) {
    const k = kinematics(s)
    const best = k.segs.length ? k.segs.reduce((a, b) => (b.xPP > a.xPP ? b : a)) : null
    rows.push({
      id,
      aVert: Math.max(...k.aVert.map(Math.abs)),
      vPeak: best ? best.vPeak : 0,
      xPP: best ? best.xPP : 0,
      segs: k.segs.length,
    })
  }
  summary[aid] = rows
  console.log(
    `${NAME[aid].padEnd(18)} ${String(rows.length).padStart(4)}   ${q(rows.map((r) => r.aVert), 0.5).toFixed(3).padStart(15)}   ` +
      `${q(rows.map((r) => r.vPeak), 0.5).toFixed(3).padStart(13)}   ${q(rows.map((r) => r.xPP), 0.5).toFixed(3).padStart(16)}`,
  )
}

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
for (const [label, idx] of [['晃动 #201', 201], ['晃动 #202', 202]]) {
  const s = rows[idx].samples
  const k = kinematics(s)
  const best = k.segs.length ? k.segs.reduce((a, b) => (b.xPP > a.xPP ? b : a)) : null
  console.log(
    `${label.padEnd(18)} ${String(s.length).padStart(4)}   ${Math.max(...k.aVert.map(Math.abs)).toFixed(3).padStart(15)}   ` +
      `${(best ? best.vPeak : 0).toFixed(3).padStart(13)}   ${(best ? best.xPP : 0).toFixed(3).padStart(16)}`,
  )
}

// ---- 关键：位移能不能区分「真动作」与「晃动」----
console.log('\n=== 分离度对比 ===')
const press = summary[1].map((r) => r.xPP)
const lateral = summary[2].map((r) => r.xPP)
const shake = [201, 202].map((idx) => {
  const k = kinematics(rows[idx].samples)
  return k.segs.length ? Math.max(...k.segs.map((b) => b.xPP)) : 0
})
console.log(`  位移峰峰 x（中位）：坐姿推举 ${q(press, 0.5).toFixed(3)} m   站姿侧平举 ${q(lateral, 0.5).toFixed(3)} m   晃动 ${Math.max(...shake).toFixed(3)} m`)
console.log(`  → 分离度 ${(q(press, 0.5) / Math.max(...shake)).toFixed(1)} 倍`)
console.log(`  对比：陀螺仪峰值的分离度约 2.4 倍，动态加速度约 3.0 倍`)

// ---- 漏检/多计的那些，用位移看是什么样 ----
console.log('\n=== 坐姿推举：位移分布（p5 / p25 / 中位 / p75 / max）===')
const pp = [...press].sort((a, b) => a - b)
console.log(`  ${q(pp, 0.05).toFixed(3)} / ${q(pp, 0.25).toFixed(3)} / ${q(pp, 0.5).toFixed(3)} / ${q(pp, 0.75).toFixed(3)} / ${q(pp, 1).toFixed(3)} m`)
console.log(`  若取门槛 0.20m：通过 ${pp.filter((v) => v >= 0.2).length}/${pp.length} = ${((pp.filter((v) => v >= 0.2).length / pp.length) * 100).toFixed(0)}%`)
console.log(`  晃动最大值 ${Math.max(...shake).toFixed(3)} m → 门槛 0.20m 时晃动 ${shake.filter((v) => v >= 0.2).length}/2 条通过`)

// ---- 直接当计数器用：按位移门槛数「段」----
console.log('\n=== 用位移门槛计数（每条样本应数出 1 次）===')
console.log('门槛(m)   坐姿推举 数出1   站姿侧平举 数出1   晃动数出   坐姿漏数  坐姿多计')
for (const th of [0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25]) {
  const res = {}
  for (const aid of [1, 2]) {
    let one = 0
    let zero = 0
    let many = 0
    for (const { s } of groups[aid]) {
      const k = kinematics(s)
      const cnt = k.segs.filter((g) => g.xPP >= th && g.durMs >= 500 && g.durMs <= 15000).length
      if (cnt === 1) one++
      else if (cnt === 0) zero++
      else many++
    }
    res[aid] = { one, zero, many, n: groups[aid].length }
  }
  let shakeCnt = 0
  for (const idx of [201, 202]) {
    const k = kinematics(rows[idx].samples)
    if (k.segs.some((g) => g.xPP >= th && g.durMs >= 500 && g.durMs <= 15000)) shakeCnt++
  }
  console.log(
    `${th.toFixed(2).padStart(6)}   ${((res[1].one / res[1].n) * 100).toFixed(1).padStart(11)}%   ` +
      `${((res[2].one / res[2].n) * 100).toFixed(1).padStart(15)}%   ${String(shakeCnt).padStart(8)}   ` +
      `${String(res[1].zero).padStart(8)}  ${String(res[1].many).padStart(8)}`,
  )
}
console.log('\n对照：当前生产配置 坐姿推举 86.3% / 站姿侧平举 96.6%（多计 9 / 0，晃动 0）')

// ---- 关键：把位移当作「第三条证据」能救回多少 ----
console.log('\n=== 当前计数器漏掉的那些，位移是多少？ ===')
{
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
  const { shapeTemplateFor } = await server.ssrLoadModule('/src/core/analysis/motionTemplates.ts')
  for (const aid of [1, 2]) {
    const t = shapeTemplateFor(aid)
    const hit = []
    const miss = []
    const over = []
    for (const { s } of groups[aid]) {
      const c = new RepCounter({ signal: 'gyro', template: t?.mean, templateAxis: t?.axis })
      for (const x of s) c.push(x)
      c.flush(s[s.length - 1].t)
      const k = kinematics(s)
      const xPP = k.segs.length ? Math.max(...k.segs.map((g) => g.xPP)) : 0
      if (c.repCount === 0) miss.push(xPP)
      else if (c.repCount > 1) over.push(xPP)
      else hit.push(xPP)
    }
    console.log(
      `  ${NAME[aid]}  数出的位移中位 ${q(hit, 0.5).toFixed(3)}m(n=${hit.length})   ` +
        `漏掉的 ${q(miss, 0.5).toFixed(3)}m(n=${miss.length})   多计的 ${q(over, 0.5).toFixed(3)}m(n=${over.length})`,
    )
    for (const th of [0.05, 0.1, 0.15]) {
      const rescued = miss.filter((v) => v >= th).length
      const falseAdd = over.filter((v) => v >= th).length
      console.log(`      若加「位移 ≥ ${th}m」这条证据：可救回漏检 ${rescued}/${miss.length}，但多计的也会被加固 ${falseAdd}/${over.length}`)
    }
  }
  await server.close()
}
