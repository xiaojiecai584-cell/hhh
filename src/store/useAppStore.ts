import { create } from 'zustand'

export type TabId = 'connect' | 'body' | 'motion' | 'demo' | 'report' | 'data' | 'repo'

/** main = 给用户看的极简界面；debug = 调试站（数据帧 / 虚拟设备 / 采集标注 / 数据仓库） */
export type Route = 'main' | 'debug'

/** 用户界面只保留日常要用的：训练 / 动作 / 演示 / 报告 / 我的 */
export const MAIN_TABS: TabId[] = ['connect', 'motion', 'demo', 'report', 'body']
/** 调试站：连接调试 / 数据中心 / 数据仓库 */
export const DEBUG_TABS: TabId[] = ['connect', 'data', 'repo']

function readRoute(): Route {
  if (typeof location === 'undefined') return 'main'
  return location.hash.replace(/^#\/?/, '').startsWith('debug') ? 'debug' : 'main'
}

interface AppState {
  tab: TabId
  route: Route
  setTab: (tab: TabId) => void
  setRoute: (route: Route) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  tab: 'connect',
  route: readRoute(),
  setTab: (tab) => set({ tab }),
  setRoute: (route) => {
    if (typeof location !== 'undefined') {
      // 用 replaceState 避免污染历史记录，也避免留下孤立的 '#'
      const url = route === 'debug' ? `${location.pathname}#/debug` : location.pathname
      history.replaceState(null, '', url)
    }
    const tabs = route === 'debug' ? DEBUG_TABS : MAIN_TABS
    const cur = get().tab
    set({ route, tab: tabs.includes(cur) ? cur : 'connect' })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const route = readRoute()
    const tabs = route === 'debug' ? DEBUG_TABS : MAIN_TABS
    const cur = useAppStore.getState().tab
    useAppStore.setState({ route, tab: tabs.includes(cur) ? cur : 'connect' })
  })
}
