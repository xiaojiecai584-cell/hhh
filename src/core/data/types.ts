import type { AnalysisResult } from '../analysis/analyzer'
import type { SetAnalysis } from '../analysis/setAnalysis'

/** 一次训练会话的记录（本地历史存储，供数据库分析） */
export interface SessionRecord {
  id: string
  startedAt: number
  actionId: number
  actionName: string
  /**
   * 整组分析结果：逐次动作分析（后端 /api/v1/motion/analyze，或本地规则分析器）的汇总。
   * 旧版本记录用的是 0x02 事件流报告，没有这个字段；读取时按缺失处理。
   */
  set?: SetAnalysis | null
  analysis: AnalysisResult | null
}
