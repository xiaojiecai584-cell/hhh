import type { ReactElement } from 'react'
import { useAppStore, type TabId } from './store/useAppStore'
import TabBar from './components/TabBar'
import ConnectPage from './pages/ConnectPage'
import BodyPage from './pages/BodyPage'
import MotionPage from './pages/MotionPage'
import DemoPage from './pages/DemoPage'
import ReportPage from './pages/ReportPage'
import DataPage from './pages/DataPage'

const META: Record<TabId, { title: string; sub: string }> = {
  connect: { title: '连接设备', sub: '蓝牙 · 虚拟设备' },
  body: { title: '身体数据', sub: '等比例人体模型' },
  motion: { title: '动作库', sub: '预设 + 自定义' },
  demo: { title: '实时演示', sub: '标准动作回放' },
  report: { title: '锻炼报告', sub: '事件与分析' },
  data: { title: '数据中心', sub: '历史与累计' },
}

const PAGES: Record<TabId, () => ReactElement> = {
  connect: ConnectPage,
  body: BodyPage,
  motion: MotionPage,
  demo: DemoPage,
  report: ReportPage,
  data: DataPage,
}

export default function App() {
  const tab = useAppStore((s) => s.tab)
  const meta = META[tab]
  const Page = PAGES[tab]

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__logo">L</div>
        <div className="app__titles">
          <span className="app__title">{meta.title}</span>
          <span className="app__subtitle">{meta.sub}</span>
        </div>
      </header>
      <main className="app__main">
        <Page />
      </main>
      <TabBar />
    </div>
  )
}
