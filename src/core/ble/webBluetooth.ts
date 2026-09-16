import type { BLETransport, TransportState } from './transport'
import { decodeFrame, FrameParser } from '../protocol/codec'
import type { IncomingFrame } from '../protocol/types'
import { normalizeUuid, type BleConfig } from './config'

export class WebBluetoothTransport implements BLETransport {
  readonly kind = 'web' as const
  state: TransportState = 'disconnected'

  private device: BluetoothDevice | null = null
  private gatt: BluetoothRemoteGATTServer | null = null
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private frameCbs = new Set<(f: IncomingFrame, raw: Uint8Array) => void>()
  private stateCbs = new Set<(s: TransportState) => void>()
  private parser = new FrameParser()

  constructor(private getConfig: () => BleConfig) {}

  get name(): string {
    return this.device?.name ?? '未知设备'
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

  private handleDisconnected = () => {
    this.setState('disconnected')
    this.gatt = null
    this.writeChar = null
    this.notifyChar = null
  }

  async connect() {
    if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
      throw new Error('当前浏览器不支持 Web Bluetooth（请用 Android Chrome / Edge）')
    }
    this.setState('connecting')
    try {
      const cfg = this.getConfig()
      const svc = normalizeUuid(cfg.serviceUuid)
      const namePrefix = cfg.deviceNameFilter.trim()
      const options: RequestDeviceOptions = cfg.acceptAllDevices
        ? { acceptAllDevices: true, optionalServices: [svc] }
        : {
            filters: [{ services: [svc], ...(namePrefix ? { namePrefix } : {}) }],
            optionalServices: [svc],
          }
      const device = await navigator.bluetooth.requestDevice(options)
      device.addEventListener('gattserverdisconnected', this.handleDisconnected)
      this.device = device
      const gatt = await device.gatt!.connect()
      this.gatt = gatt
      const service = await gatt.getPrimaryService(svc)
      this.writeChar = await service.getCharacteristic(normalizeUuid(cfg.writeUuid))
      this.notifyChar = await service.getCharacteristic(normalizeUuid(cfg.notifyUuid))
      this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotify)
      await this.notifyChar.startNotifications()
      this.setState('connected')
    } catch (e) {
      this.setState('disconnected')
      throw e
    }
  }

  async disconnect() {
    if (this.gatt?.connected) this.gatt.disconnect()
    this.handleDisconnected()
  }

  async send(data: Uint8Array) {
    if (!this.writeChar) throw new Error('未连接设备')
    await this.writeChar.writeValue(new Uint8Array(data))
  }

  private onNotify = (ev: Event) => {
    const value = (ev.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    for (const frame of this.parser.push(bytes)) {
      const decoded = decodeFrame(frame)
      if (decoded) this.frameCbs.forEach((cb) => cb(decoded, frame))
    }
  }
}
