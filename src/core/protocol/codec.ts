import {
  FRAME,
  type EventPacket,
  type ImuTarget,
  type IncomingFrame,
  type PoseFrame,
} from './types'

const HDR = 0xaa
const TAIL = 0x55

// 各 Type 的 Payload 长度（帧总长 = 1 AA + 1 Type + payload + 1 SUM + 1 55）
const PAYLOAD_LEN: Record<number, number> = {
  [FRAME.pose]: 22, // 姿态帧
  [FRAME.event]: 6, // 事件帧（provisional）
  [FRAME.ack]: 1, // ACK（回显动作类型）
}

function sum8(b: Uint8Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]
  return s & 0xff
}

/** 编码一帧：AA | Type | Payload | SUM | 55 */
export function encodeFrame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 1 + payload.length + 1 + 1)
  out[0] = HDR
  out[1] = type
  out.set(payload, 2)
  out[2 + payload.length] = sum8(out, 0, 2 + payload.length)
  out[out.length - 1] = TAIL
  return out
}

// ---- 大端读写 ----
function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1]
}
function i16be(b: Uint8Array, o: number): number {
  const v = u16be(b, o)
  return v > 0x7fff ? v - 0x10000 : v
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}
function put16be(b: Uint8Array, o: number, v: number) {
  b[o] = (v >> 8) & 0xff
  b[o + 1] = v & 0xff
}

/** 流式解析器：喂字节流，吐出校验通过的完整帧 */
export class FrameParser {
  private buf: number[] = []

  push(bytes: Uint8Array): Uint8Array[] {
    this.buf.push(...bytes)
    const frames: Uint8Array[] = []
    for (;;) {
      const idx = this.buf.indexOf(HDR)
      if (idx < 0) {
        this.buf = []
        break
      }
      if (idx > 0) this.buf.splice(0, idx)
      if (this.buf.length < 2) break
      const type = this.buf[1]
      const plen = PAYLOAD_LEN[type]
      if (plen === undefined) {
        this.buf.splice(0, 1) // 未知类型：跳过继续找
        continue
      }
      const total = 1 + 1 + plen + 1 + 1
      if (this.buf.length < total) break
      const frame = new Uint8Array(this.buf.splice(0, total))
      if (sum8(frame, 0, total - 2) !== frame[total - 2] || frame[total - 1] !== TAIL) {
        continue // 校验失败丢弃
      }
      frames.push(frame)
    }
    return frames
  }
}

/** 解析 0x01 姿态帧 */
export function parsePose(frame: Uint8Array): PoseFrame {
  return {
    type: FRAME.pose,
    timestampMs: u32be(frame, 2),
    rollDeg: i16be(frame, 6) / 100,
    pitchDeg: i16be(frame, 8) / 100,
    yawDeg: i16be(frame, 10) / 100,
    axG: i16be(frame, 12) / 1000,
    ayG: i16be(frame, 14) / 1000,
    azG: i16be(frame, 16) / 1000,
    gxDps: i16be(frame, 18) / 10,
    gyDps: i16be(frame, 20) / 10,
    gzDps: i16be(frame, 22) / 10,
  }
}

/** 解析 0x02 事件帧（provisional） */
export function parseEvent(frame: Uint8Array): EventPacket {
  const flags = frame[3]
  return {
    type: FRAME.event,
    actionId: frame[2],
    flags: {
      wristFlip: (flags & 0x01) !== 0,
      shortRange: (flags & 0x02) !== 0,
      momentum: (flags & 0x04) !== 0,
    },
    peakAngleDeg: u16be(frame, 4) / 10,
    durationMs: u16be(frame, 6) * 10,
  }
}

/** 解析 0x80 ACK */
export function parseAck(frame: Uint8Array): { type: 0x80; actionId: number } {
  return { type: FRAME.ack, actionId: frame[2] }
}

/** 解码任意上行帧 */
export function decodeFrame(frame: Uint8Array): IncomingFrame | null {
  const type = frame[1]
  if (type === FRAME.pose) return parsePose(frame)
  if (type === FRAME.event) return parseEvent(frame)
  if (type === FRAME.ack) return parseAck(frame)
  return null
}

/** 编码 0x82 开始动作：动作编号 + 9 个 IMU 目标值（与 0x01 同字段同缩放），共 23 字节 */
export function encodeStartAction(target: ImuTarget): Uint8Array {
  const p = new Uint8Array(19)
  p[0] = target.actionId
  put16be(p, 1, Math.round(target.rollDeg * 100))
  put16be(p, 3, Math.round(target.pitchDeg * 100))
  put16be(p, 5, Math.round(target.yawDeg * 100))
  put16be(p, 7, Math.round(target.axG * 1000))
  put16be(p, 9, Math.round(target.ayG * 1000))
  put16be(p, 11, Math.round(target.azG * 1000))
  put16be(p, 13, Math.round(target.gxDps * 10))
  put16be(p, 15, Math.round(target.gyDps * 10))
  put16be(p, 17, Math.round(target.gzDps * 10))
  return encodeFrame(FRAME.startAction, p)
}

/**
 * 编码 0x83 停止采集：无载荷，共 4 字节 `AA 83 SUM 55`。
 * App 侧统计动作次数达标后下发，MCU 收到即停止上行采集。
 */
export function encodeStopAction(): Uint8Array {
  return encodeFrame(FRAME.stopAction, new Uint8Array(0))
}

/** 解码 0x82（供虚拟设备解析） */
export function parseImuTarget(frame: Uint8Array): ImuTarget {
  return {
    actionId: frame[2],
    rollDeg: i16be(frame, 3) / 100,
    pitchDeg: i16be(frame, 5) / 100,
    yawDeg: i16be(frame, 7) / 100,
    axG: i16be(frame, 9) / 1000,
    ayG: i16be(frame, 11) / 1000,
    azG: i16be(frame, 13) / 1000,
    gxDps: i16be(frame, 15) / 10,
    gyDps: i16be(frame, 17) / 10,
    gzDps: i16be(frame, 19) / 10,
  }
}

/** 编码 0x01 姿态帧（供虚拟设备生成原始字节） */
export function encodePose(p: PoseFrame): Uint8Array {
  const payload = new Uint8Array(22)
  payload[0] = (p.timestampMs >>> 24) & 0xff
  payload[1] = (p.timestampMs >>> 16) & 0xff
  payload[2] = (p.timestampMs >>> 8) & 0xff
  payload[3] = p.timestampMs & 0xff
  put16be(payload, 4, Math.round(p.rollDeg * 100))
  put16be(payload, 6, Math.round(p.pitchDeg * 100))
  put16be(payload, 8, Math.round(p.yawDeg * 100))
  put16be(payload, 10, Math.round(p.axG * 1000))
  put16be(payload, 12, Math.round(p.ayG * 1000))
  put16be(payload, 14, Math.round(p.azG * 1000))
  put16be(payload, 16, Math.round(p.gxDps * 10))
  put16be(payload, 18, Math.round(p.gyDps * 10))
  put16be(payload, 20, Math.round(p.gzDps * 10))
  return encodeFrame(FRAME.pose, payload)
}

/** 编码 0x02 事件帧（供虚拟设备生成原始字节） */
export function encodeEvent(e: EventPacket): Uint8Array {
  const payload = new Uint8Array(6)
  payload[0] = e.actionId
  payload[1] =
    (e.flags.wristFlip ? 0x01 : 0) |
    (e.flags.shortRange ? 0x02 : 0) |
    (e.flags.momentum ? 0x04 : 0)
  put16be(payload, 2, Math.round(e.peakAngleDeg * 10))
  put16be(payload, 4, Math.round(e.durationMs / 10))
  return encodeFrame(FRAME.event, payload)
}

/** 编码 0x80 ACK（供虚拟设备生成原始字节） */
export function encodeAck(a: { actionId: number }): Uint8Array {
  return encodeFrame(FRAME.ack, new Uint8Array([a.actionId]))
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}
