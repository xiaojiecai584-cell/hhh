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
      // 坐姿推举：启用停顿语法（顶端/底端各有明显停顿）。
      // 这里的参数是**按现场反馈放宽过**的一套，只作用于本动作，
      // 不影响其它动作（DEFAULT_REP_OPTIONS 里 requirePause 默认关闭）。
      //   |ω| < 45°/s：停顿期间的腕部微调常达 30~40°/s
      //   |a_vert| < 0.08g：重力方向估计有滞后，0.03g 过严；
      //                     再往上放（0.12g）会把慢速动作误判成静止（实测 12 次数成 15）
      //   窗口 300ms：现场停顿 0.4~0.6s，400ms 窗口几乎零余量
      //   安静比例 0.7：允许 30% 样本有扰动
      return {
        ...base,
        requirePause: true,
        pauseOmegaDps: 45,
        pauseAccelG: 0.08,
        pauseQuietFrac: 0.7,
        pauseMinMs: 300,
        halfCycleMinMs: 350,
      }
    case 2:
      // 站姿侧平举：姿态/角速度判据已足够，不套用停顿语法
      return { ...base, requirePause: false }
    default:
      return { ...base, requirePause: false }
  }
}
