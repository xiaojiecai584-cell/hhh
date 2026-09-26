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
import { ERROR_SEVERITY, type SensorSample } from '../core/analysis/ruleClassifier'
import { segmentMotion, describeSegment, type SegmentRange } from '../core/analysis/segmentation'

export type LoggedEvent = EventPacket & { id: number }
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
  targetReps: number
  setActive: boolean
  currentActionId: number | null
  pending: PendingRecord | null
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
let lastCountAt = 0 // 上次统计次数时的采样点位置
let autoStopping = false // 防止自动停止重入
// 次数统计独立于录制：从收到 0x82 起缓存原始 0x01 流，用于数次数
let countBuffer: SensorSample[] = []
let countActive = false

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
          countBuffer.push(sample)
          if (countBuffer.length > 12000) countBuffer.splice(0, countBuffer.length - 12000) // 上限 ~4 分钟
          if (!autoStopping && countBuffer.length - lastCountAt >= 25) {
            lastCountAt = countBuffer.length
            const count = segmentMotion(countBuffer).length
            if (count !== useBleStore.getState().repCount) useBleStore.setState({ repCount: count })
            if (targetRepsFlag > 0 && count >= targetRepsFlag) {
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
    setActive: false,
    pending: null,
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
  targetReps: 0,
  setActive: false,
  currentActionId: null,
  pending: null,

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
    await active?.disconnect()
    set({ deviceName: null, latestPose: null, lastAck: null })
  },

  sendStartAction: async (target, label) => {
    if (!active) return
    const bytes = encodeStartAction(target)
    try {
      await active.send(bytes)
      // 开始新一组：重置次数统计（与录制无关）
      countBuffer = []
      countActive = true
      lastCountAt = 0
      autoStopping = false
      set((s) => ({
        txLog: [...s.txLog, { id: seq++, hex: toHex(bytes), label: label ?? '开始动作' }].slice(-50),
        currentActionId: target.actionId,
        repCount: 0,
        setActive: true,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  sendStopAction: async (label) => {
    // 结束本组：停掉次数统计
    countActive = false
    countBuffer = []
    autoStopping = false
    set({ setActive: false })
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
    try {
      await Promise.all(
        ranges.map((r, i) => {
          const label = labels[i]
          if (!label) return Promise.resolve()
          const slice = buf.slice(r.start, r.end + 1)
          const dur = slice.length ? slice[slice.length - 1].t - slice[0].t : 0
          // 统一为人工标注标准：annotations（空数组 = 标准），每项带 code/severity/startMs/endMs
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
