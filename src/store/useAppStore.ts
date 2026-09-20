import { create } from 'zustand'

export type TabId = 'connect' | 'body' | 'motion' | 'demo' | 'report' | 'data' | 'repo'

interface AppState {
  tab: TabId
  setTab: (tab: TabId) => void
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'connect',
  setTab: (tab) => set({ tab }),
}))
