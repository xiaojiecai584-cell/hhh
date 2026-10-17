import type { BLETransport, TransportState } from './transport'
import { encodeAck, encodePose, encodeStartEvent, parseImuTarget } from '../protocol/codec'
import {
  FRAME,
  type AckFrame,
  type IncomingFrame,
  type PoseFrame,
  type StartEventFrame,
  type StartMode,
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
      // 旧路径（0x82）：启动权已移到设备端，这里仅保留给调试站手动触发
      const t = parseImuTarget(data)
      const ar = Math.abs(t.rollDeg)
      const ap = Math.abs(t.pitchDeg)
      const ay = Math.abs(t.yawDeg)
      const axis = ar >= ap && ar >= ay ? 'roll' : ap >= ar && ap >= ay ? 'pitch' : 'yaw'
      const peak = axis === 'roll' ? t.rollDeg : axis === 'pitch' ? t.pitchDeg : t.yawDeg
      this.deviceStart(t.actionId, 2, 10, axis, peak)
      this.emitAck(t.actionId)
      return
    }
    if (type === FRAME.stopAction) {
      // 0x83 停止采集：停止上行
      this.running = false
      this.stopReps()
    }
  }

  /**
   * 模拟**设备端启动**：真实设备在用户语音/倒计时后自己开始，
   * 然后发 0x02 动作开始事件通知 App。虚拟设备用这个方法复现。
   */
  deviceStart(actionId: number, mode: StartMode, reps: number, axis?: 'roll' | 'pitch' | 'yaw', peakAngleDeg?: number) {    this.actionId = actionId
    this.axis = axis ?? (actionId === 2 ? 'roll' : 'pitch')
    this.peakAngleDeg = peakAngleDeg ?? (actionId === 2 ? 90 : 180)
    this.running = true
    const e: StartEventFrame = { type: FRAME.startEvent, actionId, mode, reps }
    const raw = encodeStartEvent(actionId, mode, reps)
    this.frameCbs.forEach((cb) => cb(e, raw))
    this.startReps()
  }

  /** 每组开始时回一次 ACK（设备已装载动作），之后不再周期性发事件 */
  private startReps() {
    this.stopReps()
    this.repTimer = setInterval(() => this.emitAck(this.actionId), 2000)
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
