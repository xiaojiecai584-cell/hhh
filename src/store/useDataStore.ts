import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionRecord } from '../core/data/types'

interface DataState {
  sessions: SessionRecord[]
  saveSession: (s: SessionRecord) => void
  removeSession: (id: string) => void
  clearSessions: () => void
}

/** 数据存储仓库（单用户个人历史）：本地持久化 */
export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      sessions: [],
      saveSession: (s) => set((st) => ({ sessions: [...st.sessions, s] })),
      removeSession: (id) => set((st) => ({ sessions: st.sessions.filter((x) => x.id !== id) })),
      clearSessions: () => set({ sessions: [] }),
    }),
    { name: 'lindoway-sessions' },
  ),
)
