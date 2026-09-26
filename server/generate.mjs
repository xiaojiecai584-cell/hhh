import { renderSkeletonPng } from './skeleton.mjs'

// 智能动作生成核心（共享给 Netlify Function 与本地 vite 插件）

export const SYSTEM_PROMPT = `你是健身动作参数化编译器。根据用户对动作的描述，输出该动作的标准训练参数。

只输出 JSON（不要 markdown 代码块、不要任何解释文字），结构必须严格为：

{
  "name": "动作名称",
  "basePosture": "standing",
  "sensorPosition": "wrist",
  "speedProfile": "variable",
  "mainAxis": 1,
  "wristToleranceDeg": 15,
  "cadence": 30,
  "durationMs": 2000,
  "searchTerm": "dumbbell lateral raise",
  "basePose": { "torsoFlexion": 0, "shoulderFlexion": 0, "shoulderAbduction": 0, "elbowFlexion": 0, "hipFlexion": 0, "kneeFlexion": 0 },
  "moves": [ { "joint": "shoulderAbduction", "from": 0, "to": 90 } ]
}

字段含义：
- basePosture 基准姿态，四选一：standing 站立、seated 坐姿、prone 俯卧、supine 仰卧。
- sensorPosition 表带佩戴位置，四选一：wrist 手腕、upper-arm 上臂、thigh 大腿、shin 小腿/脚踝；选「主运动关节直接带动的最近肢体段」。
- mainAxis 主运动轴：1 肩屈、2 肩外展、3 肘屈、4 髋屈、5 膝屈。
- speedProfile 速度模式：uniform 匀速（角速度恒定）、variable 非匀速（起停缓、中间快，正弦速度曲线；多数抗阻训练用 variable）。
- 关节角（度，均为该关节生理活动度上限，生成值严禁超出）：torsoFlexion 躯干屈（前倾+，0~80）、shoulderFlexion 肩屈（前举+，0~180）、shoulderAbduction 肩外展（侧举+，0~180）、elbowFlexion 肘屈（0~150）、hipFlexion 髋屈（0~140）、kneeFlexion 膝屈（0~150）。
- searchTerm：用于联网检索该动作真实参考图的英文检索词（2~5 个英文单词）。

核心——用「静止姿态 + 主运动扫动」描述动作，不要直接给动画帧：
- basePose：动作起始时全身 6 个关节的完整静止姿态（含基准姿态要求 + 辅助肢体自然姿态）。
- moves：主运动关节的扫动范围（from 起始角度 → to 顶点最大角度）。动作顶点 = basePose 中把每个 moves 关节改成其 to 值；结束回到 basePose。
- 只把真正发力的关节写进 moves；辅助/稳定关节固定在 basePose 中、不要写进 moves。

基准姿态自洽（至关重要）：
- standing 站立：手臂自然下垂 = shoulderFlexion 0 / shoulderAbduction 0。
- seated 坐姿：大腿水平 = hipFlexion 约 90、kneeFlexion 约 90（写进 basePose）。
- prone 俯卧 / supine 仰卧：身体水平；若手臂垂直支撑（如俯卧撑、平板支撑），basePose 的 shoulderFlexion 应约 90 固定，主运动是 elbowFlexion 写进 moves（如 from 10 → to 90）。

自然姿态（非主运动关节禁止僵直在 0，写进 basePose）：
1. 下肢/躯干主导动作（主运动髋/膝/躯干）：上肢自然前伸平衡（shoulderFlexion 60~90、elbowFlexion 10~20、shoulderAbduction 0）。
2. 上肢主导动作（主运动肩/肘）：下肢自然微屈稳定（hipFlexion/kneeFlexion 5~15）；躯干自然直立（torsoFlexion 0）。
3. 俯卧/仰卧：躯干与腿保持刚性直线。

关节几何（通用规则，任何动作都必须遵守，否则渲染出的姿势一定是错的）：
- 「肩屈」与「肩外展」是两条正交的抬臂通路，选错通路手会跑到完全错误的方向：
  · 手臂在**身体正前方**抬起/落下（前平举、前推、俯卧撑支撑）→ 只用 shoulderFlexion，shoulderAbduction 必须为 0。
  · 手臂在**身体两侧（额状面）**抬起/落下（侧平举、推举、投降状）→ 只用 shoulderAbduction，shoulderFlexion 必须为 0。
  · 两者同时给大值 = 斜前上方，只有斜向动作才这样用；不要用 shoulderFlexion 去"近似"侧向动作。
- 肘的弯曲平面由大臂朝向决定（屈肘在大臂的垂直平面内弯曲），因此大臂抬到不同高度，屈肘呈现出完全不同的姿势：
  · 大臂外展 90°（侧平举位置）时屈肘 → 前臂竖直向上，即「双手在肩两侧的投降状/推举准备位」（shoulderAbduction 90 + elbowFlexion 90）。
  · 大臂外展 180°（过头）时屈肘 → 前臂折向脑后，不要这样组合。
  · 大臂外展 0°（体侧下垂）时屈肘 → 前臂向前弯（弯举类）。
- 推/举类动作（推举、肩推、上举）的起点是「肘屈、手在肩上方/两侧」，顶点是「肘伸直、手在头正上方」：用 moves 扫 shoulderAbduction（90 → 180）并同时扫 elbowFlexion（90 → 5）。不要用 shoulderFlexion 90 → 180 来做推举，那会先变成前平举。

示范（仅示范格式与推理方式，动作范围不限这些）：

输入「俯卧撑」→
{ "name": "俯卧撑", "basePosture": "prone", "sensorPosition": "wrist", "speedProfile": "variable", "mainAxis": 3, "wristToleranceDeg": 15, "cadence": 30, "durationMs": 2000, "searchTerm": "push up exercise", "basePose": { "torsoFlexion": 0, "shoulderFlexion": 90, "shoulderAbduction": 0, "elbowFlexion": 10, "hipFlexion": 0, "kneeFlexion": 0 }, "moves": [ { "joint": "elbowFlexion", "from": 10, "to": 90 } ] }

输入「杠铃深蹲」→
{ "name": "杠铃深蹲", "basePosture": "standing", "sensorPosition": "thigh", "speedProfile": "variable", "mainAxis": 4, "wristToleranceDeg": 15, "cadence": 24, "durationMs": 2500, "searchTerm": "barbell back squat", "basePose": { "torsoFlexion": 15, "shoulderFlexion": 75, "shoulderAbduction": 0, "elbowFlexion": 15, "hipFlexion": 0, "kneeFlexion": 0 }, "moves": [ { "joint": "hipFlexion", "from": 0, "to": 95 }, { "joint": "kneeFlexion", "from": 0, "to": 105 } ] }

输入「哑铃侧平举」→
{ "name": "哑铃侧平举", "basePosture": "standing", "sensorPosition": "wrist", "speedProfile": "variable", "mainAxis": 2, "wristToleranceDeg": 15, "cadence": 30, "durationMs": 2000, "searchTerm": "dumbbell lateral raise", "basePose": { "torsoFlexion": 0, "shoulderFlexion": 0, "shoulderAbduction": 0, "elbowFlexion": 15, "hipFlexion": 5, "kneeFlexion": 5 }, "moves": [ { "joint": "shoulderAbduction", "from": 0, "to": 90 } ] }

输入「坐姿推举」→
{ "name": "坐姿推举", "basePosture": "seated", "sensorPosition": "wrist", "speedProfile": "variable", "mainAxis": 2, "wristToleranceDeg": 15, "cadence": 30, "durationMs": 2000, "searchTerm": "seated dumbbell shoulder press", "basePose": { "torsoFlexion": 0, "shoulderFlexion": 0, "shoulderAbduction": 90, "elbowFlexion": 90, "hipFlexion": 90, "kneeFlexion": 90 }, "moves": [ { "joint": "shoulderAbduction", "from": 90, "to": 180 }, { "joint": "elbowFlexion", "from": 90, "to": 5 } ] }

要求：给出符合人体解剖学与标准训练姿态的合理参数；数值精确、自洽；不要编造字段；basePose 必须完整给出全部 6 个关节，不要省略、不要用 0 占位。`

function extractJson(text) {
  const t = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1))
      } catch {
        /* fallthrough */
      }
    }
    throw new Error('模型返回内容不是合法 JSON')
  }
}

const JOINT_RANGE = {
  torsoFlexion: [0, 80],
  shoulderFlexion: [0, 180],
  shoulderAbduction: [0, 180],
  elbowFlexion: [0, 150],
  hipFlexion: [0, 140],
  kneeFlexion: [0, 150],
}

function clampAngle(v, key) {
  const [lo, hi] = JOINT_RANGE[key] || [0, 180]
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(hi, Math.max(lo, n))
}

function clampPose(p) {
  const out = {}
  for (const k of Object.keys(JOINT_RANGE)) out[k] = clampAngle(p?.[k], k)
  return out
}

function clampMoves(moves) {
  if (!Array.isArray(moves)) return []
  const out = []
  for (const m of moves) {
    const j = m?.joint
    if (typeof j !== 'string' || !(j in JOINT_RANGE)) continue
    out.push({ joint: j, from: clampAngle(m.from, j), to: clampAngle(m.to, j) })
  }
  return out
}

/** Uint8Array → base64。注意：Uint8Array 没有 toString('base64')，必须自己编码（Node/Workers 通用） */
function toBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

const CRITIQUE_PROMPT = (name) => `你是人体运动学评审。左图是动作「${name}」骨架的侧视图（看屈/伸），右图是正视图（看外展）。请判断该顶点姿态是否符合该动作的标准解剖学姿态。

只输出 JSON（不要 markdown）：
{ "correct": true 或 false, "reason": "一句话说明", "basePose": {…6关节…}, "moves": [{ "joint": "关节名", "from": 起始角, "to": 顶点角 }] }

若 correct=true，basePose 与 moves 原样照抄；若 false，给出修正后的完整值。
关节范围：torsoFlexion 0~80、shoulderFlexion 0~180、shoulderAbduction 0~180、elbowFlexion 0~150、hipFlexion 0~140、kneeFlexion 0~150。`

async function critiqueWithGemini(pngBuf, name, basePose, moves, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: CRITIQUE_PROMPT(name) },
            { text: `当前值 basePose=${JSON.stringify(basePose)} moves=${JSON.stringify(moves)}` },
            { inline_data: { mime_type: 'image/png', data: toBase64(pngBuf) } },
          ],
        },
      ],
      generationConfig: { response_mime_type: 'application/json' },
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Gemini 评审失败 ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
  if (!text) throw new Error('Gemini 未返回评审内容')
  return extractJson(text)
}

async function critiqueWithKimi(pngBuf, name, basePose, moves, apiKey, model, baseUrl) {
  const imageUrl = `data:image/png;base64,${toBase64(pngBuf)}`
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${CRITIQUE_PROMPT(name)}\n当前值 basePose=${JSON.stringify(basePose)} moves=${JSON.stringify(moves)}`,
            },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      // 注意：Kimi 部分模型只接受 temperature=1，故不显式传该参数
      response_format: { type: 'json_object' },
      reasoning_effort: 'low', // 降低推理长度以控制耗时
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Kimi 评审失败 ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  if (!text) throw new Error('Kimi 未返回评审内容')
  return extractJson(text)
}

/**
 * 视觉自检评审（可独立调用，供异步后台使用）。
 * 返回 { provider, draft(可能已修正), verdict, error }。
 */
export async function reviewWithVision(draft, { kimiApiKey, kimiModel, kimiBaseUrl, geminiApiKey, geminiModel }) {
  const provider = kimiApiKey ? 'kimi' : geminiApiKey ? 'gemini' : null
  if (!provider) return { provider: null, draft, verdict: null, error: null }
  let basePose = clampPose(draft.basePose)
  let moves = clampMoves(draft.moves)
  try {
    const png = await renderSkeletonPng(basePose, moves, draft.basePosture, draft.sensorPosition)
    const verdict =
      provider === 'kimi'
        ? await critiqueWithKimi(png, draft.name, basePose, moves, kimiApiKey, kimiModel || 'kimi-k2.7-code-highspeed', kimiBaseUrl || 'https://api.moonshot.cn/v1')
        : await critiqueWithGemini(png, draft.name, basePose, moves, geminiApiKey, geminiModel || 'gemini-3.8-flash')
    if (verdict && verdict.correct !== true) {
      if (verdict.basePose) basePose = clampPose(verdict.basePose)
      if (verdict.moves) moves = clampMoves(verdict.moves)
    }
    return { provider, draft: { ...draft, basePose, moves }, verdict, error: null }
  } catch (e) {
    console.error('[refine] 视觉评审跳过：', e?.message || e)
    return { provider, draft, verdict: null, error: e?.message || String(e) }
  }
}

/** 仅生成（DeepSeek），不含视觉评审。异步方案下先返回它，评审在后台跑。 */
export async function generateDraft(description, { apiKey, model = 'deepseek-chat', temperature }) {
  const isReasoner = model === 'deepseek-reasoner'
  const payload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: description },
    ],
  }
  if (isReasoner) {
    // deepseek-reasoner 不支持 temperature 与 response_format(json_object)，且需更大 max_tokens 容纳推理
    payload.max_tokens = 8000
  } else {
    payload.temperature = temperature ?? 0.2
    payload.max_tokens = 2000
    payload.response_format = { type: 'json_object' }
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DeepSeek API 错误 ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const msg = data.choices?.[0]?.message
  const content = msg?.content || msg?.reasoning_content
  if (!content) throw new Error('模型未返回内容')

  return extractJson(content)
}

/** 同步版：生成 + 视觉评审（供本地/旧部署路径使用）。Cloudflare 生产走异步。 */
export async function generateActionDraft(description, opts) {
  const draft = await generateDraft(description, opts)
  const { draft: refined } = await reviewWithVision(draft, opts)
  return refined
}

// ---------- 多候选择优（思路③）：纯规则打分，不依赖任何动作知识 ----------

const ALL_JOINTS = ['torsoFlexion', 'shoulderFlexion', 'shoulderAbduction', 'elbowFlexion', 'hipFlexion', 'kneeFlexion']
/** 主运动轴 → 对应关节，用于校验 mainAxis 与 moves 是否自洽 */
const AXIS_JOINT = { 1: 'shoulderFlexion', 2: 'shoulderAbduction', 3: 'elbowFlexion', 4: 'hipFlexion', 5: 'kneeFlexion' }

/** 规则打分：只查「结构完整性 / 生理范围 / 主运动关节与 mainAxis 自洽 / 幅度合理」 */
export function scoreDraft(draft) {
  let score = 0
  const issues = []
  const bp = draft?.basePose ?? {}
  // ① 6 关节齐全
  const missing = ALL_JOINTS.filter((j) => !Number.isFinite(bp[j]))
  if (missing.length) issues.push(`basePose缺${missing.join('/')}`)
  else score += 2
  // ② 生理范围
  const bad = new Set()
  for (const j of ALL_JOINTS) {
    const r = JOINT_RANGE[j]
    if (Number.isFinite(bp[j]) && (bp[j] < r[0] || bp[j] > r[1])) bad.add(j)
  }
  const moves = Array.isArray(draft?.moves) ? draft.moves.filter((m) => m && JOINT_RANGE[m.joint]) : []
  for (const m of moves) {
    const r = JOINT_RANGE[m.joint]
    if (m.from < r[0] || m.from > r[1] || m.to < r[0] || m.to > r[1]) bad.add(m.joint)
  }
  if (bad.size) issues.push(`超范围${[...bad].join('/')}`)
  else score += 2
  // ③ 必须给出主运动关节
  if (!moves.length) issues.push('无主运动关节')
  else score += 2
  // ④ mainAxis 与 moves 里的主关节自洽
  const expect = AXIS_JOINT[draft?.mainAxis]
  const main = moves.find((m) => m.joint === expect)
  if (main) score += 3
  else issues.push(`mainAxis=${draft?.mainAxis}与主关节[${moves.map((m) => m.joint).join('/')}]不自洽`)
  // ⑤ 主运动幅度合理
  if (main && main.to - main.from >= 20) score += 1
  else if (main) issues.push(`主运动幅度仅${main.to - main.from}°`)
  return { score, issues }
}

/** 排序候选：规则分 + 交叉一致性（多数票，与多数候选一致者加分） */
export function rankDrafts(candidates) {
  const scored = candidates.map((c) => ({ draft: c, ...scoreDraft(c) }))
  const counts = {}
  for (const s of scored) {
    const key = (s.draft?.moves ?? []).map((m) => m?.joint).filter(Boolean).sort().join('+')
    counts[key] = (counts[key] ?? 0) + 1
  }
  for (const s of scored) {
    const key = (s.draft?.moves ?? []).map((m) => m?.joint).filter(Boolean).sort().join('+')
    s.agree = counts[key]
    s.score += (counts[key] - 1) * 2
  }
  return scored.sort((a, b) => b.score - a.score)
}

/** 生成 N 个候选（高温扰动以获取多样性）→ 规则择优 */
export async function generateBestDraft(description, { apiKey, model, candidates = 3 } = {}) {
  const settled = await Promise.allSettled(
    Array.from({ length: candidates }, () => generateDraft(description, { apiKey, model, temperature: 0.8 })),
  )
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  if (!ok.length) throw new Error(settled[0]?.reason?.message || '候选生成全部失败')
  const ranked = rankDrafts(ok)
  console.log(
    '[candidates]',
    ranked.map((r) => `${r.score}分/一致${r.agree}${r.issues.length ? '（' + r.issues.join('；') + '）' : ''}`).join(' | '),
  )
  return ranked[0].draft
}
