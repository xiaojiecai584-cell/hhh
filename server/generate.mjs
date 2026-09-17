// 智能动作生成核心（共享给 Netlify Function 与本地 vite 插件）

export const SYSTEM_PROMPT = `你是健身动作参数化编译器。根据用户对动作的描述，输出该动作的标准训练参数。

只输出 JSON（不要 markdown 代码块、不要任何解释文字），结构必须严格为：

{
  "name": "动作名称",
  "basePosture": "standing",
  "sensorPosition": "wrist",
  "speedProfile": "variable",
  "mainAxis": 1,
  "peakAngleDeg": 180,
  "wristToleranceDeg": 15,
  "cadence": 30,
  "durationMs": 2000,
  "searchTerm": "dumbbell lateral raise",
  "keyframes": [
    { "t": 0, "angles": { "torsoFlexion": 0, "shoulderFlexion": 0, "shoulderAbduction": 0, "elbowFlexion": 0, "hipFlexion": 0, "kneeFlexion": 0 }, "easing": "smoothstep" },
    { "t": 0.5, "angles": { "shoulderFlexion": 0, "shoulderAbduction": 0, "elbowFlexion": 0, "hipFlexion": 0, "kneeFlexion": 0 }, "easing": "smoothstep" },
    { "t": 1, "angles": { "shoulderFlexion": 0, "shoulderAbduction": 0, "elbowFlexion": 0, "hipFlexion": 0, "kneeFlexion": 0 }, "easing": "smoothstep" }
  ]
}

字段含义：
- basePosture 基准姿态，四选一：standing 站立、seated 坐姿、prone 俯卧、supine 仰卧。
- sensorPosition 表带佩戴位置，四选一：wrist 手腕、upper-arm 上臂、thigh 大腿、shin 小腿/脚踝；选「主运动关节直接带动的最近肢体段」。
- mainAxis 主运动轴：1 肩屈、2 肩外展、3 肘屈、4 髋屈、5 膝屈。
- speedProfile 速度模式：uniform 匀速（角速度恒定）、variable 非匀速（起停缓、中间快，正弦速度曲线；多数抗阻训练用 variable）。
- 关节角（度）：torsoFlexion 躯干屈（前倾+，0~90）、shoulderFlexion 肩屈（前举+，0~180）、shoulderAbduction 肩外展（侧举+，0~180）、elbowFlexion 肘屈（0~180）、hipFlexion 髋屈（0~180）、kneeFlexion 膝屈（0~180）。
- keyframes 三个关键帧：t=0 起始姿态、t=0.5 顶点（最大幅度）、t=1 结束（回到起始）。
- 基准姿态与关节角必须自洽（这点至关重要）：
  · standing 站立：手臂自然下垂 = shoulderFlexion 0 / shoulderAbduction 0。
  · seated 坐姿：大腿水平 = hipFlexion 约 90、kneeFlexion 约 90。
  · prone 俯卧 / supine 仰卧：身体水平，若动作要求手臂垂直于躯干（支撑身体或指向地面/天花板，如俯卧撑、平板支撑、卧推），则起始与结束关键帧就应给 shoulderFlexion 约 90（或 shoulderAbduction 约 90）作为固定基准角，且该基准角在三个关键帧中保持不变；只有主运动关节（如肘屈）才在 t=0.5 达到最大幅度、t=0/t=1 回到基准。
- peakAngleDeg：主运动轴在顶点的峰值角度（度）；wristToleranceDeg 腕容限（度）；cadence 建议节律（次/分）；durationMs 单次动作时长（毫秒）。
- searchTerm：用于联网检索该动作真实参考图的英文检索词（2~5 个英文单词，如 "dumbbell lateral raise"、"barbell squat"、"seated shoulder press"）。

要求：给出符合人体解剖学与标准训练姿态的合理参数；数值精确、自洽；不要编造字段。

关键要求——所有关节都必须给出该动作下的自然姿态，禁止让非主运动关节停留在 0：

1. 下肢/躯干主导动作（主运动为髋/膝/躯干）：上肢不能僵直下垂，应自然前伸保持平衡（shoulderFlexion 60~90、elbowFlexion 10~20、shoulderAbduction 0）；躯干按需要前倾。
2. 上肢主导动作（主运动为肩/肘）：下肢自然微屈稳定（hipFlexion/kneeFlexion 5~15）；躯干自然直立（torsoFlexion 0）或按动作需要前倾。
3. 俯卧/仰卧动作：非主运动关节给出支撑/稳定姿态，躯干与腿保持刚性直线。

每个关键帧（起、顶、止）都完整给出全部 6 个关节（torsoFlexion、shoulderFlexion、shoulderAbduction、elbowFlexion、hipFlexion、kneeFlexion），不要省略、不要用 0 占位。`

export async function generateActionDraft(description, { apiKey, model = 'deepseek-chat' }) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: description },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DeepSeek API 错误 ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('模型未返回内容')

  const cleaned = String(content)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()
  return JSON.parse(cleaned)
}
