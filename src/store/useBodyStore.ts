import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PROFILE, type BodyProfile } from '../core/body/bodyProfile'

interface BodyState {
  profile: BodyProfile
  setField: (key: keyof BodyProfile, value: number) => void
  reset: () => void
}

export const useBodyStore = create<BodyState>()(
  persist(
    (set) => ({
      profile: { ...DEFAULT_PROFILE },
      setField: (key, value) => set((s) => ({ profile: { ...s.profile, [key]: value } })),
      reset: () => set({ profile: { ...DEFAULT_PROFILE } }),
    }),
    { name: 'lindoway-body-profile' },
  ),
)
