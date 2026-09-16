import type { EventPacket } from '../protocol/types'

export interface SessionReport {
  actionId: number
  totalReps: number
  complianceRate: number // 0..1
  compensationCount: number
  wristFlipCount: number
  shortRangeCount: number
  momentumCount: number
  avgPeakAngleDeg: number
  avgDurationMs: number
  events: EventPacket[]
}

/** 把 0x02 事件流聚合为一份训练报告 */
export function buildReport(events: EventPacket[]): SessionReport | null {
  const completes = events
  if (completes.length === 0) return null

  let wristFlip = 0
  let shortRange = 0
  let momentum = 0
  let sumPeak = 0
  let sumDur = 0
  let compensation = 0

  for (const e of completes) {
    if (e.flags.wristFlip) wristFlip++
    if (e.flags.shortRange) shortRange++
    if (e.flags.momentum) momentum++
    if (e.flags.wristFlip || e.flags.shortRange || e.flags.momentum) compensation++
    sumPeak += e.peakAngleDeg
    sumDur += e.durationMs
  }

  const n = completes.length
  return {
    actionId: completes[n - 1].actionId,
    totalReps: n,
    complianceRate: 1 - compensation / n,
    compensationCount: compensation,
    wristFlipCount: wristFlip,
    shortRangeCount: shortRange,
    momentumCount: momentum,
    avgPeakAngleDeg: sumPeak / n,
    avgDurationMs: sumDur / n,
    events: completes,
  }
}
