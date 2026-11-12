// 检查多份 samples-v2 导出之间是否有重复，并汇总标注分布。
// 运行：node scripts/inspect-samples.mjs <json1> <json2> ...
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)

/** 帧内容的指纹：把所有数拼起来做 FNV-1a，用于判断是否为同一段录音 */
function frameHash(frames) {
  let h = 0x811c9dc5
  for (const f of frames) {
    const s = `${f.t},${f.ax},${f.ay},${f.az},${f.gx},${f.gy},${f.gz}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h.toString(16).padStart(8, '0')
}

const all = []
for (const path of files) {
  const d = JSON.parse(readFileSync(path, 'utf8'))
  const list = d.samples ?? []
  console.log(`\n${path.split(/[\\/]/).pop()}`)
  console.log(`  version ${d.version}  dataset ${d.dataset}  样本 ${list.length} 条`)
  for (const s of list) {
    all.push({
      file: path.split(/[\\/]/).pop(),
      id: s.id,
      actionId: s.actionId,
      condition: s.condition,
      trueReps: s.trueReps,
      errors: s.errorCodes ?? [],
      note: s.note ?? '',
      frameCount: s.frameCount,
      durationMs: s.durationMs,
      samplingRateHz: s.samplingRateHz,
      capturedAt: s.capturedAt,
      hash: frameHash(s.frames ?? []),
      frames: s.frames ?? [],
    })
  }
}

console.log(`\n===== 合计 ${all.length} 条 =====`)

// ---- 1. 内容指纹重复（同一段录音被提交多次）----
const byHash = new Map()
for (const s of all) {
  const arr = byHash.get(s.hash) ?? []
  arr.push(s)
  byHash.set(s.hash, arr)
}
const dupHash = [...byHash.entries()].filter(([, arr]) => arr.length > 1)
console.log(`\n[1] 内容完全相同的样本组：${dupHash.length} 组`)
for (const [h, arr] of dupHash) {
  console.log(`  指纹 ${h} × ${arr.length}`)
  for (const s of arr) console.log(`    ${s.file}  id=${s.id}  ${s.condition} ${s.trueReps}次  标注=[${s.errors.join(',')}]`)
}

// ---- 2. id 重复 ----
const byId = new Map()
for (const s of all) byId.set(s.id, (byId.get(s.id) ?? 0) + 1)
const dupId = [...byId.entries()].filter(([, n]) => n > 1)
console.log(`\n[2] id 重复：${dupId.length} 个${dupId.length ? ' → ' + dupId.map(([i, n]) => `${i}×${n}`).join(', ') : ''}`)

// ---- 3. 帧数+时长+次数都相同（可能是重复导入，但内容不同）----
const byShape = new Map()
for (const s of all) {
  const k = `${s.frameCount}|${s.durationMs}|${s.trueReps}`
  byShape.set(k, (byShape.get(k) ?? 0) + 1)
}
const shapeDup = [...byShape.entries()].filter(([, n]) => n > 1)
console.log(`\n[3] 帧数/时长/次数完全相同（内容不同，属正常，仅提示）：${shapeDup.length} 组`)

// ---- 4. 标注分布 ----
console.log('\n===== 标注分布 =====')
const cond = new Map()
for (const s of all) cond.set(s.condition, (cond.get(s.condition) ?? 0) + 1)
console.log('工况：')
for (const [k, n] of [...cond.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${n} 条`)

const errCount = new Map()
for (const s of all) {
  if (!s.errors.length) errCount.set('（无错误=标准）', (errCount.get('（无错误=标准）') ?? 0) + 1)
  for (const e of s.errors) errCount.set(e, (errCount.get(e) ?? 0) + 1)
}
console.log('错误标注（一条可多标）：')
for (const [k, n] of [...errCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${n} 条`)

const reps = all.map((s) => s.trueReps)
console.log(`\n真实次数：min ${Math.min(...reps)}  max ${Math.max(...reps)}  中位 ${[...reps].sort((a, b) => a - b)[Math.floor(reps.length / 2)]}`)
console.log(`时长合计 ${(all.reduce((a, s) => a + s.durationMs, 0) / 1000).toFixed(0)}s，帧数合计 ${all.reduce((a, s) => a + s.frameCount, 0)}`)
