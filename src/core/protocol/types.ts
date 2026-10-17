// BT36 通信协议类型（对齐 Lindoway通信协议.md）
// 帧格式：AA | Type | Payload(定长) | SUM | 55，多字节字段大端

export type Axis = 1 | 2 | 3 | 4 | 5 // 1肩屈 2肩外展 3肘屈 4髋屈 5膝屈

export const FRAME = {
  pose: 0x01, // 姿态帧 50Hz（MCU→APP）
  startEvent: 0x02, // **动作开始事件（MCU→APP）**：启动权在设备端，见下方 StartEventFrame
  ack: 0x80, // ACK（回显动作类型）
  startAction: 0x82, // 旧：APP 下发开始动作（目标姿态帧）。启动权已移到设备端，仅调试时使用
  stopAction: 0x83, // 停止采集（APP 主动结束本组时下发）
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

/** 设备端启动方式 */
export type StartMode = 1 | 2 // 1 = 语音模式（关键词触发），2 = 隐私模式（倒计时）

export const START_MODE_LABEL: Record<StartMode, string> = {
  1: '语音模式',
  2: '隐私模式',
}

/**
 * 0x02 动作开始事件（7 字节，MCU→APP）
 *
 * 偏移 0 帧头 0xAA | 1 类型 0x02 | 2 actionId | 3 mode | 4 reps | 5 SUM | 6 帧尾 0x55
 * SUM = 偏移 0~4 共 5 字节累加取低 8 位。
 *
 * **启动权在设备端**：用户在设备上通过语音关键词或倒计时启动，设备发这一帧通知 App。
 * App 收到后开始计数、并按本帧的 reps 作为本组目标次数（不再由 App 下发 0x82）。
 */
export interface StartEventFrame {
  type: 0x02
  actionId: number // 1 = 坐姿推举，2 = 站姿侧平举
  mode: StartMode
  reps: number // 1~99，设备菜单设置，默认 10
}

// 0x80 ACK
export interface AckFrame {
  type: 0x80
  actionId: number
}

export type IncomingFrame = PoseFrame | StartEventFrame | AckFrame

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
