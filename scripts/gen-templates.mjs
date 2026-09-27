// 从 Python 后端工程包的模板产物生成前端用的形状模板。
// 用法：node scripts/gen-templates.mjs <包根目录>
// 后端用 `motion_ai.cli build-templates` 重新生成更好的模板后，重跑本脚本即可更新。
import { readFileSync, writeFileSync } from 'node:fs'

const P = process.argv[2] ?? 'D:/lindoway/.tmp-data/pkg/fitness_motion_ai_package'
const SRC = [
  { file: 'data/artifacts/templates/seated_shoulder_press.json', axis: 'gy' },
  { file: 'data/artifacts/templates/standing_lateral_raise.json', axis: 'gx' },
]

const round3 = (x) => Math.round(x * 1000) / 1000
const entries = []
for (const { file, axis } of SRC) {
  const j = JSON.parse(readFileSync(`${P}/${file}`, 'utf8'))
  entries.push({
    actionId: j.actionId,
    actionName: j.actionName,
    axis,
    samplingRate: j.samplingRate,
    templateLength: j.templateLength,
    sampleCount: j.sampleCount,
    mean: j.mean.map(round3),
  })
  console.log(`actionId=${j.actionId} ${j.actionName} len=${j.templateLength} sampleCount=${j.sampleCount} 轴=${axis}`)
}

const out = `// 自动生成，请勿手改——用 scripts/gen-templates.mjs 从后端模板产物重新生成。
//
// 来源：Python 后端 \`motion_ai.cli build-templates\` 的产物
//       （data/artifacts/templates/*.json），是各动作主轴（由后端 actions 注册表定义：
//        坐姿推举 gy、站姿侧平举 gx）在归一化时间上的平均波形，长度 128。
//
// 用途：非标准动作（幅度不足、轨迹不稳）往往幅度不达标但**形状仍与标准动作相似**。
//       归一化后与模板求相关，可以把这类动作救回来——这是单纯调幅度门限做不到的。
//
// 已知局限：当前 sampleCount 很小（坐姿推举 4、站姿侧平举 4，real_experiment 版本仅 1），
//           模板本身不够稳健。后端补足正确样本后重新生成即可提升。

export interface MotionShapeTemplate {
  actionId: number
  actionName: string
  /** 后端注册表定义的主分析轴 */
  axis: 'gx' | 'gy' | 'gz'
  samplingRate: number
  templateLength: number
  /** 模板由多少条样本平均而来；越小越不可靠 */
  sampleCount: number
  mean: number[]
}

export const MOTION_SHAPE_TEMPLATES: MotionShapeTemplate[] = ${JSON.stringify(entries, null, 2)}

export function shapeTemplateFor(actionId: number): MotionShapeTemplate | undefined {
  return MOTION_SHAPE_TEMPLATES.find((t) => t.actionId === actionId)
}
`

writeFileSync('D:/lindoway/src/core/analysis/motionTemplates.ts', out)
console.log(`\n已写入 src/core/analysis/motionTemplates.ts（${entries.length} 个模板）`)
