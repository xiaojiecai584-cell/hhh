import type { SessionReport } from '../report/reportEngine'
import type { AnalysisResult } from '../analysis/analyzer'
import type { SetAnalysis } from '../analysis/setAnalysis'

/** 一次训练会话的记录（本地历史存储，供数据库分析） */
export interface SessionRecord {
  id: string
  startedAt: number
  actionId: number
  actionName: string
  /** 旧：基于 0x02 事件流的报告（真机未实现 0x02 时为空） */
  report?: SessionReport | null
  /** 新：基于逐次动作分析（后端 /api/v1/motion/analyze 或本地规则）的整组报告 */
  set?: SetAnalysis | null
  analysis: AnalysisResult | null
}
