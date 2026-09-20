import { create } from 'zustand'
import type { BLETransport, TransportKind, TransportState } from '../core/ble/transport'
import { WebBluetoothTransport } from '../core/ble/webBluetooth'
import { VirtualDeviceTransport } from '../core/ble/virtualDevice'
import { useBleConfigStore } from './useBleConfigStore'
import { encodeStartAction, toHex } from '../core/protocol/codec'
import {
  ACTION_NAMES,
  FRAME,
  type AckFrame,
  type EventPacket,
  type ImuTarget,
  type PoseFrame,
} from '../core/protocol/types'
import { classifyMotion, type RuleResult, type SensorSample } from '../core/analysis/ruleClassifier'

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
  currentActionId: number | null
  lastClassification: RuleResult | null
  setKind: (kind: TransportKind) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendStartAction: (target: ImuTarget, label?: string) => Promise<void>
  startRecording: () => void
  stopRecording: () => Promise<void>
  clearClassification: () => void
  clearEvents: () => void
  clearRawRx: () => void
}

let active: BLETransport | null = null
let cleanups: (() => void)[] = []
let seq = 0
let recordBuffer: SensorSample[] = []
let recordingFlag = false

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
      if (recordingFlag && frame.type === FRAME.pose) {
        recordBuffer.push({
          t: frame.timestampMs,
          ax: frame.axG,
          ay: frame.ayG,
          az: frame.azG,
          gx: frame.gxDps,
          gy: frame.gyDps,
          gz: frame.gzDps,
        })
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
    lastClassification: null,
  })
}

export const useBleStore = create<BleState>((set) => ({
  kind: 'virtual',
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
  currentActionId: null,
  lastClassification: null,

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
      set((s) => ({
        txLog: [...s.txLog, { id: seq++, hex: toHex(bytes), label: label ?? '开始动作' }].slice(-50),
        currentActionId: target.actionId,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  startRecording: () => {
    recordBuffer = []
    recordingFlag = true
    set({ recording: true, recordingCount: 0, lastClassification: null })
  },

  stopRecording: async () => {
    const samples = recordBuffer
    const actionId = useBleStore.getState().currentActionId ?? 1
    recordBuffer = []
    recordingFlag = false
    set({ recording: false, recordingCount: 0 })
    const result = classifyMotion(samples, actionId)
    set({ lastClassification: result })
    try {
      await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'sensor_sample',
          actionId,
          actionName: ACTION_NAMES[actionId] ?? `动作${actionId}`,
          samples,
          result,
        }),
      })
    } catch {
      /* ignore */
    }
  },

  clearClassification: () => set({ lastClassification: null }),

  clearEvents: () => set({ events: [] }),
  clearRawRx: () => set({ rawRx: [], rxCounts: { pose: 0, event: 0, ack: 0 } }),
}))

// 初始化默认虚拟设备
attach(new VirtualDeviceTransport())
