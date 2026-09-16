import type { SessionReport } from '../report/reportEngine'

export interface AnalysisResult {
  score: number // 0–100
  summary: string
  advice: string[]
  anomalies: { label: string; detail: string }[]
}

/** AI 分析接口：未来接入大模型时实现并注册即可，UI/报告层零改动 */
export interface Analyzer {
  name: string
  analyze(report: SessionReport): Promise<AnalysisResult>
}

/** 分析器注册表（当前为空，接入大模型后在此登记） */
export const analyzerRegistry: Analyzer[] = []

/** 常见建议模板（供人工输入快速套用） */
export const ADVICE_TEMPLATES = [
  '注意全程保持手腕中立，避免翻转',
  '控制向心阶段速度，避免借力甩动',
  '确保动作行程完整到位',
  '保持核心收紧，稳定躯干',
]
