import type { SessionReport } from '../report/reportEngine'
import type { AnalysisResult } from '../analysis/analyzer'

/** 一次训练会话的记录（本地历史存储，供数据库分析） */
export interface SessionRecord {
  id: string
  startedAt: number
  actionId: number
  actionName: string
  report: SessionReport
  analysis: AnalysisResult | null
}
