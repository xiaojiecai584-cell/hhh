import type { IncomingFrame, StartMode } from '../protocol/types'

export type TransportState = 'disconnected' | 'connecting' | 'connected'
export type TransportKind = 'web' | 'virtual'

/** 蓝牙传输抽象：业务层只依赖此接口，未来可替换为 Capacitor 原生实现 */
export interface BLETransport {
  readonly kind: TransportKind
  readonly name: string
  readonly state: TransportState
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(data: Uint8Array): Promise<void>
  /**
   * 仅调试用途：让**虚拟设备**模拟"设备端启动"并发出一帧 0x02 动作开始事件。
   * 真实设备由它自己（语音/倒计时）触发，App 无法也不该主动发起。
   */
  simulateDeviceStart?(actionId: number, mode: StartMode, reps: number): void
  /** frame = 解码后的帧；raw = 原始字节（用于调试窗口） */
  onFrame(cb: (frame: IncomingFrame, raw: Uint8Array) => void): () => void
  onStateChange(cb: (state: TransportState) => void): () => void
}
