// 核对：网站由 3D 正向运动学算出的 0x82 目标姿态，是否与《通信协议-网页端实现版》一致
// 文档规定：actionId 1（坐姿推举）→ pitch=180 其余 0，主轴 gy；actionId 2（站姿侧平举）→ roll=90 其余 0，主轴 gx
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { MOTION_TEMPLATES } = await server.ssrLoadModule('/src/core/motion/templates.ts')
const { templateToImuTarget } = await server.ssrLoadModule('/src/core/motion/imuMapping.ts')
const { DEFAULT_PROFILE, resolveSegments } = await server.ssrLoadModule('/src/core/body/bodyProfile.ts')
const { sampleAngles } = await server.ssrLoadModule('/src/core/motion/engine.ts')
const { sensorAttitude } = await server.ssrLoadModule('/src/core/motion/kinematics.ts')

const seg = resolveSegments(DEFAULT_PROFILE)
const DOC = { 1: { axis: 'gy', target: 'pitch=180' }, 2: { axis: 'gx', target: 'roll=90' } }

console.log('模板 sensorPosition / basePosture：')
for (const t of MOTION_TEMPLATES) {
  console.log(`  actionId=${t.actionId} ${t.name}  sensorPosition=${t.sensorPosition} basePosture=${t.basePosture} mainAxis=${t.mainAxis}`)
}

console.log('\n网站算出的 0x82 目标：')
for (const t of MOTION_TEMPLATES) {
  const v = templateToImuTarget(t, undefined, seg)
  const axisOfOmega = Math.abs(v.gxDps) >= Math.abs(v.gyDps) && Math.abs(v.gxDps) >= Math.abs(v.gzDps)
    ? 'gx(roll)' : Math.abs(v.gyDps) >= Math.abs(v.gzDps) ? 'gy(pitch)' : 'gz(yaw)'
  console.log(
    `  actionId=${t.actionId} ${t.name}\n` +
      `     roll=${v.rollDeg}°  pitch=${v.pitchDeg}°  yaw=${v.yawDeg}°\n` +
      `     gx=${v.gxDps} gy=${v.gyDps} gz=${v.gzDps}  → 角速度主轴 ${axisOfOmega}\n` +
      `     文档要求：主轴 ${DOC[t.actionId].axis}，目标 ${DOC[t.actionId].target}`,
  )
}

console.log('\n各模板姿态角（起始→顶点）与分段传感器姿态：')
for (const t of MOTION_TEMPLATES) {
  const a0 = sampleAngles(t, 0)
  const a5 = sampleAngles(t, 0.5)
  for (const sp of ['wrist', 'upper-arm']) {
    const s = sensorAttitude(t.basePosture, sp, a0, seg)
    const p = sensorAttitude(t.basePosture, sp, a5, seg)
    console.log(
      `  ${t.name} @${sp}: roll ${s.rollDeg.toFixed(1)}→${p.rollDeg.toFixed(1)}  pitch ${s.pitchDeg.toFixed(1)}→${p.pitchDeg.toFixed(1)}  yaw ${s.yawDeg.toFixed(1)}→${p.yawDeg.toFixed(1)}`,
    )
  }
}

await server.close()
