import { create } from 'zustand'
import type { AnalysisResult } from '../core/analysis/analyzer'

interface ReportState {
  analysis: AnalysisResult | null
  setAnalysis: (a: AnalysisResult) => void
  reset: () => void
}

export const useReportStore = create<ReportState>((set) => ({
  analysis: null,
  setAnalysis: (analysis) => set({ analysis }),
  reset: () => set({ analysis: null }),
}))
