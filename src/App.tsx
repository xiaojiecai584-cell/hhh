import type { ReactElement } from 'react'
import { DEBUG_TABS, MAIN_TABS, useAppStore, type TabId } from './store/useAppStore'
import TabBar from './components/TabBar'
import ConnectPage from './pages/ConnectPage'
import BodyPage from './pages/BodyPage'
import MotionPage from './pages/MotionPage'
import DemoPage from './pages/DemoPage'
import ReportPage from './pages/ReportPage'
import DataPage from './pages/DataPage'
import RepoPage from './pages/RepoPage'

const META: Record<TabId, { title: string; sub: string }> = {
  connect: { title: '训练', sub: '蓝牙连接与本次训练' },
  body: { title: '我的', sub: '身体数据 · 等比例模型' },
  motion: { title: '动作库', sub: '预设 + 自定义' },
  demo: { title: '实时演示', sub: '标准动作回放' },
  report: { title: '锻炼报告', sub: '本次与历史' },
  data: { title: '数据中心', sub: '历史与累计' },
  repo: { title: '数据仓库', sub: '云端采集与分类' },
}

const PAGES: Record<TabId, () => ReactElement> = {
  connect: ConnectPage,
  body: BodyPage,
  motion: MotionPage,
  demo: DemoPage,
  report: ReportPage,
  data: DataPage,
  repo: RepoPage,
}

export default function App() {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)
  const tab = useAppStore((s) => s.tab)
  const ids = route === 'debug' ? DEBUG_TABS : MAIN_TABS
  const active = ids.includes(tab) ? tab : ids[0]
  const meta = META[active]
  const Page = PAGES[active]

  return (
    <div className={`app app--${route}`}>
      <header className="app__header">
        <div className="app__logo">L</div>
        <div className="app__titles">
          <span className="app__title">
            {meta.title}
            {route === 'debug' && <span className="app__mode">调试</span>}
          </span>
          <span className="app__subtitle">{meta.sub}</span>
        </div>
        <button
          className="app__link"
          onClick={() => setRoute(route === 'debug' ? 'main' : 'debug')}
        >
          {route === 'debug' ? '返回' : '调试'}
        </button>
      </header>
      <main className="app__main">
        <Page />
      </main>
      <TabBar />
    </div>
  )
}
