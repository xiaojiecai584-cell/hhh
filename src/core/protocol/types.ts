// BT36 通信协议类型（对齐 Lindoway通信协议.md）
// 帧格式：AA | Type | Payload(定长) | SUM | 55，多字节字段大端

export type Axis = 1 | 2 | 3 | 4 | 5 // 1肩屈 2肩外展 3肘屈 4髋屈 5膝屈

export const FRAME = {
  pose: 0x01, // 姿态帧 50Hz
  event: 0x02, // 事件帧（判姿报警）
  ack: 0x80, // ACK（回显动作类型）
  startAction: 0x82, // 开始动作（目标姿态帧，下发目标姿态）
  stopAction: 0x83, // 停止采集（App 数够预设次数后下发，MCU 收到即停止上行）
} as const

// 0x01 姿态帧
export interface PoseFrame {
  type: 0x01
  timestampMs: number // 0 = 无有效数据
  rollDeg: number // ÷100
  pitchDeg: number // ÷100
  yawDeg: number // ÷100
  axG: number // ÷1000
  ayG: number // ÷1000
  azG: number // ÷1000
  gxDps: number // ÷10
  gyDps: number // ÷10
  gzDps: number // ÷10
}

// 0x02 事件帧（payload 待定，此处为 provisional：动作类型 + 代偿标志位 + 峰值角度 + 耗时）
export interface EventPacket {
  type: 0x02
  actionId: number
  flags: { wristFlip: boolean; shortRange: boolean; momentum: boolean }
  peakAngleDeg: number
  durationMs: number
}

// 0x80 ACK
export interface AckFrame {
  type: 0x80
  actionId: number
}

export type IncomingFrame = PoseFrame | EventPacket | AckFrame

// 0x82 目标姿态参数：字段与 0x01 姿态帧一致（同缩放、同大端），表示标准动作的 IMU 目标值
export interface ImuTarget {
  actionId: number
  rollDeg: number // ÷100
  pitchDeg: number // ÷100
  yawDeg: number // ÷100
  axG: number // ÷1000
  ayG: number // ÷1000
  azG: number // ÷1000
  gxDps: number // ÷10
  gyDps: number // ÷10
  gzDps: number // ÷10
}

export const ACTION_NAMES: Record<number, string> = {
  1: '坐姿推举',
  2: '站姿侧平举',
}
