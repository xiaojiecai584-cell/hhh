import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SensorPosition } from '../core/analysis/contract'

/**
 * 受试者与佩戴信息。
 *
 * 为什么单独存：Python 后端的数据契约要求每条样本带 `subjectId` 和 `sensorPosition`，
 * 而此前网站两个都没上报，导致导入审计里出现
 *   "subjectId": "subject_unknown"
 *   sensor.position = "unknown"
 * 于是无法按受试者划分训练/验证/测试集，也无法校验佩戴位置与主轴映射。
 */
interface SubjectState {
  subjectId: string
  sensorPosition: SensorPosition
  setSubjectId: (v: string) => void
  setSensorPosition: (v: SensorPosition) => void
}

function defaultSubjectId(): string {
  return `subject-${Math.random().toString(36).slice(2, 8)}`
}

export const useSubjectStore = create<SubjectState>()(
  persist(
    (set) => ({
      subjectId: defaultSubjectId(),
      sensorPosition: 'right_upper_arm',
      setSubjectId: (subjectId) => set({ subjectId }),
      setSensorPosition: (sensorPosition) => set({ sensorPosition }),
    }),
    { name: 'lindoway-subject' },
  ),
)
