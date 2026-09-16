import type { BLETransport, TransportState } from './transport'
import { encodeAck, encodeEvent, encodePose, parseImuTarget } from '../protocol/codec'
import {
  FRAME,
  type AckFrame,
  type EventPacket,
  type IncomingFrame,
  type PoseFrame,
} from '../protocol/types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const round1 = (n: number) => Math.round(n * 10) / 10
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** 虚拟设备：按 BT36 协议模拟（50Hz 姿态流 + 0x80 ACK + 0x02 事件） */
export class VirtualDeviceTransport implements BLETransport {
  readonly kind = 'virtual' as const
  state: TransportState = 'disconnected'

  private frameCbs = new Set<(f: IncomingFrame, raw: Uint8Array) => void>()
  private stateCbs = new Set<(s: TransportState) => void>()
  private poseTimer: ReturnType<typeof setInterval> | null = null
  private repTimer: ReturnType<typeof setInterval> | null = null
  private actionId = 0
  private axis: 'roll' | 'pitch' | 'yaw' = 'pitch'
  private peakAngleDeg = 180
  private running = false
  private t0 = 0

  get name(): string {
    return 'Lindoway 虚拟设备'
  }

  private setState(s: TransportState) {
    this.state = s
    this.stateCbs.forEach((cb) => cb(s))
  }

  onFrame(cb: (f: IncomingFrame, raw: Uint8Array) => void) {
    this.frameCbs.add(cb)
    return () => this.frameCbs.delete(cb)
  }

  onStateChange(cb: (s: TransportState) => void) {
    this.stateCbs.add(cb)
    return () => this.stateCbs.delete(cb)
  }

  async connect() {
    this.setState('connecting')
    await delay(450)
    this.setState('connected')
    this.t0 = Date.now()
    this.poseTimer = setInterval(() => this.emitPose(), 20) // 50Hz
  }

  async disconnect() {
    this.stopReps()
    if (this.poseTimer) clearInterval(this.poseTimer)
    this.poseTimer = null
    this.running = false
    this.setState('disconnected')
  }

  async send(data: Uint8Array) {
    const type = data[1]
    if (type === FRAME.startAction) {
      const t = parseImuTarget(data)
      this.actionId = t.actionId
      const ar = Math.abs(t.rollDeg)
      const ap = Math.abs(t.pitchDeg)
      const ay = Math.abs(t.yawDeg)
      if (ar >= ap && ar >= ay) {
        this.axis = 'roll'
        this.peakAngleDeg = t.rollDeg
      } else if (ap >= ar && ap >= ay) {
        this.axis = 'pitch'
        this.peakAngleDeg = t.pitchDeg
      } else {
        this.axis = 'yaw'
        this.peakAngleDeg = t.yawDeg
      }
      this.running = true
      this.emitAck(this.actionId)
      this.startReps()
    }
  }

  private startReps() {
    this.stopReps()
    this.repTimer = setInterval(() => this.emitEvent(), 2000) // 默认节律 30 次/分
  }

  private stopReps() {
    if (this.repTimer) {
      clearInterval(this.repTimer)
      this.repTimer = null
    }
  }

  private emitAck(actionId: number) {
    const a: AckFrame = { type: FRAME.ack, actionId }
    const raw = encodeAck(a)
    this.frameCbs.forEach((cb) => cb(a, raw))
  }

  private emitEvent() {
    const r = Math.random()
    const flags = {
      wristFlip: r < 0.12,
      shortRange: r >= 0.12 && r < 0.3,
      momentum: r >= 0.3 && r < 0.4,
    }
    const peak = flags.shortRange ? this.peakAngleDeg * 0.68 : this.peakAngleDeg
    const e: EventPacket = {
      type: FRAME.event,
      actionId: this.actionId,
      flags,
      peakAngleDeg: round1(peak + (Math.random() * 3 - 1.5)),
      durationMs: Math.round(1600 + Math.random() * 700),
    }
    const raw = encodeEvent(e)
    this.frameCbs.forEach((cb) => cb(e, raw))
  }

  private emitPose() {
    const t = (Date.now() - this.t0) / 1000
    let roll = 0
    let pitch = 0
    let yaw = 0
    let ts = 0
    if (this.running) {
      const phase = (t % 2) / 2
      const a = Math.sin(phase * Math.PI) * this.peakAngleDeg
      if (this.axis === 'roll') roll = a
      else if (this.axis === 'pitch') pitch = a
      else yaw = a
      ts = Math.round(t * 1000)
    }
    const p: PoseFrame = {
      type: FRAME.pose,
      timestampMs: ts,
      rollDeg: round1(roll + (Math.random() * 2 - 1)),
      pitchDeg: round1(pitch + (Math.random() * 2 - 1)),
      yawDeg: round1(yaw + (Math.random() * 4 - 2)),
      axG: round3(Math.random() * 0.1),
      ayG: round3(Math.random() * 0.1),
      azG: round3(1 + Math.random() * 0.06),
      gxDps: round1(Math.random() * 20 - 10),
      gyDps: round1(Math.random() * 20 - 10),
      gzDps: round1(Math.random() * 20 - 10),
    }
    const raw = encodePose(p)
    this.frameCbs.forEach((cb) => cb(p, raw))
  }
}
