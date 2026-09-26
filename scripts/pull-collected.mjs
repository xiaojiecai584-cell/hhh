// 把线上 D1 的采集数据拉到本地，供离线分析/算法回放使用。
// 运行：node scripts/pull-collected.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] || 'https://lindoway1.pages.dev'
const outDir = 'D:/lindoway/.tmp-data'
mkdirSync(outDir, { recursive: true })

const res = await fetch(`${BASE}/api/collect`)
if (!res.ok) throw new Error(`GET /api/collect → ${res.status}`)
const list = await res.json()
const rows = Array.isArray(list) ? list : (list.items ?? list.data ?? [])
console.log('records =', rows.length)
console.log('keys of [0] =', Object.keys(rows[0] ?? {}).join(', '))

writeFileSync(`${outDir}/collect.json`, JSON.stringify(rows, null, 0))

const kindOf = (r) => r.kind || (r.samples?.length ? 'sensor_sample' : 'motion_params')
const byKind = {}
for (const r of rows) {
  const k = kindOf(r)
  byKind[k] = (byKind[k] || 0) + 1
}
console.log('kinds =', JSON.stringify(byKind))

console.log('\n-- 连续录音（samples >= 150，可做计数回放）--')
const cont = rows
  .map((r, i) => ({ i, n: r.samples?.length ?? 0, r }))
  .filter((x) => x.n >= 150)
  .sort((a, b) => b.n - a.n)
for (const x of cont.slice(0, 25)) {
  const ann = x.r.annotations?.length ?? 0
  console.log(`  #${x.i} samples=${x.n} annotations=${ann} dur=${((x.r.samples.at(-1).t - x.r.samples[0].t) / 1000).toFixed(1)}s key=${x.r._id ?? x.r.id ?? '?'}`)
}
console.log(`  ...共 ${cont.length} 条`)

console.log('\n-- 单段样本（<150）标注分布 --')
const codeCount = {}
for (const r of rows) for (const a of r.annotations ?? []) codeCount[a.code ?? a.label ?? '?'] = (codeCount[a.code ?? a.label ?? '?'] || 0) + 1
console.log(' ', JSON.stringify(codeCount))
console.log('\nwrote', `${outDir}/collect.json`)
