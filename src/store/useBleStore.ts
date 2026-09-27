import { create } from 'zustand'
import type { BLETransport, TransportKind, TransportState } from '../core/ble/transport'
import { WebBluetoothTransport } from '../core/ble/webBluetooth'
import { VirtualDeviceTransport } from '../core/ble/virtualDevice'
import { useBleConfigStore } from './useBleConfigStore'
import { encodeStartAction, encodeStopAction, toHex } from '../core/protocol/codec'
import {
  ACTION_NAMES,
  FRAME,
  type AckFrame,
  type EventPacket,
  type ImuTarget,
  type PoseFrame,
} from '../core/protocol/types'
import { ERROR_SEVERITY } from '../core/analysis/ruleClassifier'
import {
  estimateSamplingRate,
  phaseRanges,
  SIGNAL_CHANNELS,
  type SensorSample,
} from '../core/analysis/contract'
import { useSubjectStore } from './useSubjectStore'
import { segmentMotion, describeSegment, type SegmentRange } from '../core/analysis/segmentation'
import { RepCounter, type RepEvent } from '../core/analysis/repCounter'
import { analyzeSet, type SetAnalysis } from '../core/analysis/setAnalysis'
import { MOTION_TEMPLATES } from '../core/motion/templates'
import { useApiConfigStore } from './useApiConfigStore'
import { useDataStore } from './useDataStore'
export type LoggedEvent = EventPacket & { id: number }
/** 在线计数产出的每一次重复；带上该次的原始样本，供动作分析（后端 /api/v1/motion/analyze）使用 */
export type RepRecord = RepEvent & { samples: SensorSample[] }
export interface TxEntry {
  id: number
  hex: string
  label: string
}
export interface RawRxEntry {
  id: number
  time: string
  typeLabel: string
  hex: string
}
export interface ManualLabel {
  standard: boolean
  errorCodes: string[]
}
export interface PendingSegment {
  durationMs: number
  peak: number
  axis: string
  count: number
}
export interface PendingRecord {
  actionId: number
  actionName: string
  segments: PendingSegment[]
}

/** 一组的分析结果（结束时自动生成并存入历史） */
export interface SetReport {
  setId: string
  actionId: number
  actionName: string
  analysis: SetAnalysis
  analyzedAt: number
  savedToHistory: boolean
}

/** 结束时对本次重复做的快照——开始下一组会清空 repEvents，快照保证还能重新分析 */
interface SetSnapshot {
  setId: string
  actionId: number
  actionName: string
  startedAt: number
  reps: { index: number; samples: SensorSample[] }[]
}

function fmtTime(): string {
  const d = new Date()
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function typeLabel(frame: { type: number }): string {
  if (frame.type === FRAME.pose) return '姿态帧'
  if (frame.type === FRAME.ack) return 'ACK'
  return '事件帧'
}

interface BleState {
  kind: TransportKind
  state: TransportState
  deviceName: string | null
  latestPose: PoseFrame | null
  lastAck: AckFrame | null
  events: LoggedEvent[]
  txLog: TxEntry[]
  rawRx: RawRxEntry[]
  rxCounts: { pose: number; event: number; ack: number }
  error: string | null
  recording: boolean
  recordingCount: number
  repCount: number
  /** 本组已识别出的每一次重复（在线计数产出，字段对齐协议 0x02，并带原始样本） */
  repEvents: RepRecord[]
  targetReps: number
  setActive: boolean
  currentActionId: number | null
  pending: PendingRecord | null
  /** 最近一组的分析结果（一组结束时自动生成） */
  lastReport: SetReport | null
  analyzing: boolean
  analyzeError: string | null
  /** 重新分析最近一组（例如刚配置好后端地址后想用后端重跑） */
  analyzeLastSet: (opts?: { save?: boolean }) => Promise<void>
  setKind: (kind: TransportKind) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendStartAction: (target: ImuTarget, label?: string) => Promise<void>
  sendStopAction: (label?: string) => Promise<void>
  setTargetReps: (n: number) => void
  startRecording: () => void
  stopRecording: () => void
  submitSegments: (labels: (ManualLabel | null)[]) => Promise<void>
  discardPending: () => void
  clearEvents: () => void
  clearRawRx: () => void
}

let active: BLETransport | null = null
let cleanups: (() => void)[] = []
let seq = 0
let recordBuffer: SensorSample[] = []
let segmentRanges: SegmentRange[] = []
let recordingFlag = false
let targetRepsFlag = 0 // 本组目标次数（0 = 不限）
let autoStopping = false // 防止自动停止重入
// 本组计数器：在线、单调、只依赖已发生的样本（为什么不能用 segmentMotion 见 repCounter.ts）
let repCounter = new RepCounter()
let countActive = false
let lastSampleT = 0
/** 最近一段时间的原始样本环，用于按起止时间切出每一次重复的样本 */
let sampleRing: SensorSample[] = []
const SAMPLE_RING_MAX = 1000
/** 本次运行的组号与开始时间；结束一组时用它做历史记录 id，重复保存不会产生重复条目 */
let setId = ''
let setStartedAt = 0
/** 结束时的快照：开始下一组会清空 repEvents，快照保证「重新分析」还能跑 */
let snapshot: SetSnapshot | null = null
/** 本次 App 运行的会话号；一次采集上传共用一个 sessionId */
const setSessionId = `session-${Date.now().toString(36)}`

function attach(t: BLETransport) {
  cleanups.forEach((f) => f())
  cleanups = []
  active = t
  cleanups.push(
    t.onStateChange((state) => useBleStore.setState({ state })),
    t.onFrame((frame, raw) => {
      const id = seq++
      const entry: RawRxEntry = {
        id,
        time: fmtTime(),
        typeLabel: typeLabel(frame),
        hex: toHex(raw),
      }
      if (frame.type === FRAME.pose) {
        const sample: SensorSample = {
          t: frame.timestampMs,
          ax: frame.axG,
          ay: frame.ayG,
          az: frame.azG,
          gx: frame.gxDps,
          gy: frame.gyDps,
          gz: frame.gzDps,
        }
        // 录制缓冲（仅用于采集/标注数据）
        if (recordingFlag) recordBuffer.push(sample)
        // 次数统计（自 0x82 起常开，与录制无关）
        if (countActive) {
          lastSampleT = sample.t
          sampleRing.push(sample)
          if (sampleRing.length > SAMPLE_RING_MAX) sampleRing.splice(0, sampleRing.length - SAMPLE_RING_MAX)
          const ev = repCounter.push(sample)
          if (ev) {
            const count = repCounter.repCount
            // 切出这一次重复的原始样本（时间戳落在 [startMs, endMs] 内），供动作分析使用
            const reps = sampleRing.filter((x) => x.t >= ev.startMs && x.t <= ev.endMs)
            useBleStore.setState((s) => ({
              repCount: count,
              repEvents: [...s.repEvents, { ...ev, samples: reps }].slice(-200),
            }))
            if (!autoStopping && targetRepsFlag > 0 && count >= targetRepsFlag) {
              autoStopping = true
              void useBleStore.getState().sendStopAction(`达标 ${targetRepsFlag} 次 · 停止采集 (0x83)`)
              // 若正在录制，同时结束录制，便于对这批数据做标注
              if (useBleStore.getState().recording) useBleStore.getState().stopRecording()
            }
          }
        }
      }
      useBleStore.setState((s) => {
        const rxCounts = { pose: s.rxCounts.pose, event: s.rxCounts.event, ack: s.rxCounts.ack }
        const rawRx = [...s.rawRx, entry].slice(-100)
        if (frame.type === FRAME.pose) {
          rxCounts.pose++
          return { rawRx, rxCounts, latestPose: frame, recordingCount: recordingFlag ? recordBuffer.length : s.recordingCount }
        }
        if (frame.type === FRAME.ack) {
          rxCounts.ack++
          return { rawRx, rxCounts, lastAck: frame }
        }
        rxCounts.event++
        return {
          rawRx,
          rxCounts,
          events: [...s.events, { ...frame, id }].slice(-200),
        }
      })
    }),
  )
  recordBuffer = []
  recordingFlag = false
  useBleStore.setState({
    state: t.state,
    latestPose: null,
    lastAck: null,
    rawRx: [],
    rxCounts: { pose: 0, event: 0, ack: 0 },
    recording: false,
    recordingCount: 0,
    repCount: 0,
    repEvents: [],
    setActive: false,
    pending: null,
    lastReport: null,
    analyzing: false,
    analyzeError: null,
  })
}

export const useBleStore = create<BleState>((set) => ({
  // 用户界面默认连真机；虚拟设备只在调试站（#/debug）里切换使用
  kind: 'web',
  state: 'disconnected',
  deviceName: null,
  latestPose: null,
  lastAck: null,
  events: [],
  txLog: [],
  rawRx: [],
  rxCounts: { pose: 0, event: 0, ack: 0 },
  error: null,
  recording: false,
  recordingCount: 0,
  repCount: 0,
  repEvents: [],
  targetReps: 0,
  setActive: false,
  currentActionId: null,
  pending: null,
  lastReport: null,
  analyzing: false,
  analyzeError: null,

  setKind: (kind) => {
    const prev = active
    const t =
      kind === 'web'
        ? new WebBluetoothTransport(() => useBleConfigStore.getState().config)
        : new VirtualDeviceTransport()
    attach(t)
    void prev?.disconnect()
    set({ kind, deviceName: null, events: [], txLog: [], error: null })
  },

  connect: async () => {
    if (!active) return
    set({ error: null })
    try {
      await active.connect()
      set({ deviceName: active.name })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  disconnect: async () => {
    // 采集途中断连也要结束本组并出报告，否则这一组数据直接丢
    if (countActive) void useBleStore.getState().sendStopAction('连接断开 · 结束本组')
    await active?.disconnect()
    set({ deviceName: null, latestPose: null, lastAck: null })
  },

  sendStartAction: async (target, label) => {
    if (!active) return
    const bytes = encodeStartAction(target)
    try {
      await active.send(bytes)
      // 开始新一组：换一个全新的计数器（在线计数，不重算历史）
      repCounter = new RepCounter()
      countActive = true
      lastSampleT = 0
      sampleRing = []
      autoStopping = false
      setId = `set-${Date.now().toString(36)}`
      setStartedAt = Date.now()
      snapshot = null
      set((s) => ({
        txLog: [...s.txLog, { id: seq++, hex: toHex(bytes), label: label ?? '开始动作' }].slice(-50),
        currentActionId: target.actionId,
        repCount: 0,
        repEvents: [],
        lastReport: null,
        analyzeError: null,
        setActive: true,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  sendStopAction: async (label) => {
    // 结束本组：先把半途中的最后一次结算掉（记录可能在回落途中就截止了），再停计数
    if (countActive) {
      const tail = repCounter.flush(lastSampleT || Date.now())
      if (tail) {
        const reps = sampleRing.filter((x) => x.t >= tail.startMs && x.t <= tail.endMs)
        set((s) => ({
          repCount: repCounter.repCount,
          repEvents: [...s.repEvents, { ...tail, samples: reps }].slice(-200),
        }))
      }
    }
    countActive = false
    sampleRing = []
    autoStopping = false
    set({ setActive: false })

    // 结束即出报告：快照本组，然后自动分析并存入历史（不再依赖用户去报告页手动点）
    const st = useBleStore.getState()
    const actionId = st.currentActionId ?? 1
    snapshot = {
      setId: setId || `set-${Date.now().toString(36)}`,
      actionId,
      actionName: MOTION_TEMPLATES.find((t) => t.actionId === actionId)?.name ?? ACTION_NAMES[actionId] ?? `动作${actionId}`,
      startedAt: setStartedAt || Date.now(),
      reps: st.repEvents.map((r) => ({ index: r.index, samples: r.samples })),
    }
    void useBleStore.getState().analyzeLastSet({ save: true })

    if (!active) return
    const bytes = encodeStopAction()
    try {
      await active.send(bytes)
      set((s) => ({
        txLog: [...s.txLog, { id: seq++, hex: toHex(bytes), label: label ?? '停止采集 (0x83)' }].slice(-50),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  analyzeLastSet: async (opts) => {
    const snap = snapshot
    if (!snap || snap.reps.length === 0) {
      set({ lastReport: null, analyzing: false, analyzeError: null })
      return
    }
    const { subjectId, sensorPosition } = useSubjectStore.getState()
    const baseUrl = useApiConfigStore.getState().baseUrl
    set({ analyzing: true, analyzeError: null })
    try {
      const analysis = await analyzeSet(snap.reps, {
        actionId: snap.actionId,
        actionName: snap.actionName,
        sensorPosition,
        sessionId: `${snap.setId}-${subjectId}`,
        baseUrl,
      })
      if (!analysis) {
        set({ analyzing: false, lastReport: null })
        return
      }

      let savedToHistory = false
      if (opts?.save !== false) {
        const errors = analysis.errors
        useDataStore.getState().saveSession({
          id: snap.setId,
          startedAt: snap.startedAt,
          actionId: snap.actionId,
          actionName: snap.actionName,
          set: analysis,
          analysis: {
            score: Math.round(analysis.avgScore.overall),
            summary: `本组 ${analysis.totalReps} 次，可用 ${analysis.usableReps} 次，平均 ${analysis.avgScore.overall} 分`,
            advice: errors.map((e) => `${e.code} ${e.count} 次`),
            anomalies: errors.map((e) => ({ label: e.code, detail: `${e.count} 次` })),
          },
        })
        savedToHistory = true
      }

      set({
        analyzing: false,
        analyzeError: analysis.backendError,
        lastReport: {
          setId: snap.setId,
          actionId: snap.actionId,
          actionName: snap.actionName,
          analysis,
          analyzedAt: Date.now(),
          savedToHistory,
        },
      })
    } catch (e) {
      set({ analyzing: false, analyzeError: e instanceof Error ? e.message : String(e) })
    }
  },

  setTargetReps: (n) => {
    targetRepsFlag = Math.max(0, Math.floor(n) || 0)
    set({ targetReps: targetRepsFlag })
  },

  startRecording: () => {
    recordBuffer = []
    segmentRanges = []
    recordingFlag = true
    set({ recording: true, recordingCount: 0, pending: null })
  },

  // 录制只是「暂时采集数据」，与是否结束本组（0x83）无关
  stopRecording: () => {
    const actionId = useBleStore.getState().currentActionId ?? 1
    recordingFlag = false
    segmentRanges = segmentMotion(recordBuffer)
    const segments = segmentRanges.map((r) => describeSegment(recordBuffer, r))
    set({
      recording: false,
      recordingCount: 0,
      pending: {
        actionId,
        actionName: ACTION_NAMES[actionId] ?? `动作${actionId}`,
        segments,
      },
    })
  },

  submitSegments: async (labels) => {
    const p = useBleStore.getState().pending
    if (!p) return
    const buf = recordBuffer
    const ranges = segmentRanges
    recordBuffer = []
    segmentRanges = []
    set({ pending: null })
    const { subjectId, sensorPosition } = useSubjectStore.getState()
    const sessionId = setSessionId
    try {
      await Promise.all(
        ranges.map((r, i) => {
          const label = labels[i]
          if (!label) return Promise.resolve()
          const slice = buf.slice(r.start, r.end + 1)
          const dur = slice.length ? slice[slice.length - 1].t - slice[0].t : 0
          // 人工标注：annotations 每项带 code/severity/startMs/endMs（标准 §8.1）
          const annotations = label.standard
            ? []
            : label.errorCodes.map((code) => ({
                code,
                severity: ERROR_SEVERITY[code] ?? 'medium',
                startMs: 0,
                endMs: dur,
              }))
          return fetch('/api/collect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'sensor_sample',
              // ---- 与 Python 后端 DatasetRecord/DatasetLabel 对齐的字段 ----
              // 缺 label.standard 时，后端会把「无错误」的样本判成 unknown 而不是 correct，
              // 所以标准与否必须显式写进 label。
              label: { standard: label.standard },
              labelSource: 'human',
              isWeakLabel: false,
              subjectId,
              sessionId,
              sensor: {
                position: sensorPosition,
                samplingRate: estimateSamplingRate(slice),
                channels: [...SIGNAL_CHANNELS],
              },
              phases: phaseRanges(dur),
              // ---- 网站现有字段（保持兼容） ----
              actionId: p.actionId,
              actionName: p.actionName,
              samples: slice,
              annotations,
            }),
          })
        }),
      )
    } catch {
      /* ignore */
    }
  },

  discardPending: () => {
    recordBuffer = []
    segmentRanges = []
    set({ pending: null })
  },

  clearEvents: () => set({ events: [] }),
  clearRawRx: () => set({ rawRx: [], rxCounts: { pose: 0, event: 0, ack: 0 } }),
}))

// 初始传输层：真机（Web 蓝牙）。调试站可切到虚拟设备。
attach(new WebBluetoothTransport(() => useBleConfigStore.getState().config))
