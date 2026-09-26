import type { ReactNode } from 'react'
import { DEBUG_TABS, MAIN_TABS, useAppStore, type TabId } from '../store/useAppStore'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const ICONS: Record<TabId, ReactNode> = {
  connect: <path d="m7 7 10 10-5 5V2l5 5L7 17" />, // 蓝牙
  body: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-1a7 7 0 0 1 7-7 7 7 0 0 1 7 7v1" />
    </>
  ),
  motion: (
    <>
      <rect x="2" y="9" width="4" height="6" rx="1.2" />
      <rect x="18" y="9" width="4" height="6" rx="1.2" />
      <path d="M6 12h12" />
    </>
  ),
  demo: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M7.5 4.5v15l12-7.5z" />
    </svg>
  ),
  report: (
    <>
      <path d="M5 20v-6" />
      <path d="M12 20V4" />
      <path d="M19 20v-9" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="5" rx="7.5" ry="3" />
      <path d="M4.5 5v14c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V5" />
      <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
    </>
  ),
  repo: (
    <>
      <ellipse cx="12" cy="5" rx="7.5" ry="3" />
      <path d="M4.5 5v7c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
      <path d="M4.5 12v7c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-7" />
    </>
  ),
}

const LABELS: Record<TabId, string> = {
  connect: '训练',
  body: '我的',
  motion: '动作',
  demo: '演示',
  report: '报告',
  data: '数据',
  repo: '仓库',
}

export default function TabBar() {
  const tab = useAppStore((s) => s.tab)
  const route = useAppStore((s) => s.route)
  const setTab = useAppStore((s) => s.setTab)
  const ids = route === 'debug' ? DEBUG_TABS : MAIN_TABS

  return (
    <nav className="tabbar">
      {ids.map((id) => (
        <button
          key={id}
          className={`tabbar__item${tab === id ? ' tabbar__item--active' : ''}`}
          onClick={() => setTab(id)}
        >
          <Icon>{ICONS[id]}</Icon>
          <span>{LABELS[id]}</span>
        </button>
      ))}
    </nav>
  )
}
