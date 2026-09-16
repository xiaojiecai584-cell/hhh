import { create } from 'zustand'
import { DEFAULT_PROFILE, type BodyProfile } from '../core/body/bodyProfile'

interface BodyState {
  profile: BodyProfile
  setField: (key: keyof BodyProfile, value: number) => void
  reset: () => void
}

export const useBodyStore = create<BodyState>((set) => ({
  profile: { ...DEFAULT_PROFILE },
  setField: (key, value) => set((s) => ({ profile: { ...s.profile, [key]: value } })),
  reset: () => set({ profile: { ...DEFAULT_PROFILE } }),
}))
