import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Python 分析后端（fitness_motion_ai）地址。
 * 留空 = 不使用后端，网站回退到本地规则分析器（阈值与后端一致）。
 */
interface ApiConfigState {
  baseUrl: string
  setBaseUrl: (v: string) => void
}

const ENV_BASE = (import.meta.env.VITE_MOTION_AI_BASE_URL as string | undefined) ?? ''

export const useApiConfigStore = create<ApiConfigState>()(
  persist(
    (set) => ({
      baseUrl: ENV_BASE,
      setBaseUrl: (baseUrl) => set({ baseUrl: baseUrl.trim() }),
    }),
    { name: 'lindoway-api-config' },
  ),
)
