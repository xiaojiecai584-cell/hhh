// 按动作给出计数参数——两个动作的信号特性根本不同，不能共用一套。
//
// 依据（都是实测）：
//   坐姿推举：传感器装在哑铃上，做推举时哑铃手柄接近水平、只做竖直平移，
//             几乎不旋转 → 陀螺仪几乎没有信号，`d` 中位仅 4.6°。
//             唯一可靠的判别是「顶端/底端各有 0.4~0.6s 停顿」这个结构，
//             所以启用**停顿语法**（底停顿→上举→顶停顿→下放→底停顿）。
//   站姿侧平举：哑铃真的在转（陀螺仪峰值中位 150°/s），姿态判据 `d` 正常工作，
//             原来的「角速度回落 + 姿态回落」判据已经够好（离线 96.6%），
//             不应套用停顿语法——否则没有顶端停顿的动作会被按"每隔一次"计而少计。
import { shapeTemplateFor } from './motionTemplates'
import type { RepCounterOptions } from './repCounter'

/** 有自定义参数的动作编号 */
export const ACTIONS_WITH_REP_OVERRIDES = [1] as const

export function repOptionsFor(actionId: number): Partial<RepCounterOptions> {
  const tpl = shapeTemplateFor(actionId)
  const base: Partial<RepCounterOptions> = {
    template: tpl?.mean,
    templateAxis: tpl?.axis,
  }
  switch (actionId) {
    case 1:
      // 坐姿推举：启用停顿语法（顶端/底端各有明显停顿）
      return {
        ...base,
        requirePause: true,
        pauseMinMs: 400, // 现场实测两端各停 0.4~0.6s
        pauseOmegaDps: 30,
        pauseAccelG: 0.03,
        pauseQuietFrac: 0.8, // 滑动窗口容错：允许 20% 样本有扰动
      }
    case 2:
      // 站姿侧平举：姿态/角速度判据已足够，不套用停顿语法
      return { ...base, requirePause: false }
    default:
      return { ...base, requirePause: false }
  }
}
