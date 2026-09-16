import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MotionTemplate } from '../core/motion/types'

interface CustomMotionState {
  customs: MotionTemplate[]
  addCustom: (t: MotionTemplate) => void
  removeCustom: (id: string) => void
}

export const useCustomMotionStore = create<CustomMotionState>()(
  persist(
    (set) => ({
      customs: [],
      addCustom: (t) => set((s) => ({ customs: [...s.customs, t] })),
      removeCustom: (id) => set((s) => ({ customs: s.customs.filter((c) => c.id !== id) })),
    }),
    { name: 'lindoway-custom-motions' },
  ),
)
