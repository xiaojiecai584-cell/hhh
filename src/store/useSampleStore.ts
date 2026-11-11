import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 新一轮（坐姿推举重采）的独立数据集。
 *
 * **刻意与 useDataStore 分开**：使用独立的 localStorage key（lindoway-samples-v2），
 * 不复用训练历史，避免新采集的数据与既有记录混在一起。
 */
export type SampleCondition =
  | 'normal'
  | 'fast'
  | 'slow'
  | 'large'
  | 'small'
  | 'static'
  | 'shake'
  | 'irregular'

export const SAMPLE_CONDITION_LABEL: Record<SampleCondition, string> = {
  normal: '标准',
  fast: '偏快',
  slow: '偏慢',
  large: '幅度偏大',
  small: '幅度偏小',
  static: '完全不动',
  shake: '轻轻晃动',
  irregular: '非标准（其它）',
}

/** 一轮采集里的一条样本：原始帧 + 人工标注 */
export interface LabeledSample {
  id: string
  actionId: number
  actionName: string
  condition: SampleCondition
  /** 人工数出来的真实次数 */
  trueReps: number
  /** 人工标注的错误类型（可多选，空数组 = 标准动作） */
  errorCodes: string[]
  /** 自由备注（例如"第 5 次幅度明显不足"） */
  note: string
  samplingRateHz: number
  durationMs: number
  frameCount: number
  capturedAt: string
  frames: { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }[]
}

interface SampleState {
  samples: LabeledSample[]
  addSample: (s: LabeledSample) => void
  removeSample: (id: string) => void
  clearSamples: () => void
}

/** 独立存储：key 与既有数据仓库（lindoway-data）完全不同，互不影响 */
export const useSampleStore = create<SampleState>()(
  persist(
    (set) => ({
      samples: [],
      addSample: (s) => set((st) => ({ samples: [...st.samples, s] })),
      removeSample: (id) => set((st) => ({ samples: st.samples.filter((x) => x.id !== id) })),
      clearSamples: () => set({ samples: [] }),
    }),
    { name: 'lindoway-samples-v2' },
  ),
)

/** 估算已占比（localStorage 通常上限 5MB），用于在界面上提示及时导出 */
export function estimateStoreBytes(samples: LabeledSample[]): number {
  return samples.reduce((a, s) => a + s.frameCount * 62 + 400, 0)
}
