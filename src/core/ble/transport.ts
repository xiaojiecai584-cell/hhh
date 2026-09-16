import type { IncomingFrame } from '../protocol/types'

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
  /** frame = 解码后的帧；raw = 原始字节（用于调试窗口） */
  onFrame(cb: (frame: IncomingFrame, raw: Uint8Array) => void): () => void
  onStateChange(cb: (state: TransportState) => void): () => void
}
