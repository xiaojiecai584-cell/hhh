import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionRecord } from '../core/data/types'

interface DataState {
  sessions: SessionRecord[]
  /** 保存一次训练记录。同一 id 覆盖（重复保存不会产生重复记录） */
  saveSession: (s: SessionRecord) => void
  removeSession: (id: string) => void
  clearSessions: () => void
}

/** 数据存储仓库（单用户个人历史）：本地持久化 */
export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      sessions: [],
      // 一组结束时自动保存，用户再点一次「保存」不应该多出一条
      saveSession: (s) =>
        set((st) => ({
          sessions: st.sessions.some((x) => x.id === s.id)
            ? st.sessions.map((x) => (x.id === s.id ? s : x))
            : [...st.sessions, s],
        })),
      removeSession: (id) => set((st) => ({ sessions: st.sessions.filter((x) => x.id !== id) })),
      clearSessions: () => set({ sessions: [] }),
    }),
    {
      name: 'lindoway-sessions',
      version: 2,
      // v1 存的是旧的 0x02 事件报告（report 字段），其统计在真机上恒为空；
      // v2 改为逐次动作分析（set 字段）。旧记录保留展示，缺失的新字段按空处理。
      migrate: (persisted) => persisted as DataState,
    },
  ),
)
