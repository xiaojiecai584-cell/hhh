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
      throw new Error('当前浏览器不支持 Web Bluetooth（请用安卓 Chrome/Edge，且必须是 HTTPS 地址）')
    }
    this.setState('connecting')
    // 记录当前步骤，失败时能精确指出卡在哪一环
    let step = '选择设备'
    try {
      const cfg = this.getConfig()
      const svc = normalizeUuid(cfg.serviceUuid)
      const namePrefix = cfg.deviceNameFilter.trim()
      const options: RequestDeviceOptions = cfg.acceptAllDevices
        ? { acceptAllDevices: true, optionalServices: [svc] }
        : namePrefix
          ? { filters: [{ namePrefix }], optionalServices: [svc] }
          : { filters: [{ services: [svc] }], optionalServices: [svc] }

      step = '选择设备'
      const device = await navigator.bluetooth.requestDevice(options)
      device.addEventListener('gattserverdisconnected', this.handleDisconnected)
      this.device = device

      const g = device.gatt
      if (!g) throw new Error('该设备不支持 GATT 连接')

      // 安卓上 gatt.connect() 偶发失败，重试一次
      step = 'GATT 连接'
      let gatt: BluetoothRemoteGATTServer | null = null
      for (let i = 0; i < 2; i++) {
        try {
          gatt = await g.connect()
          break
        } catch (e) {
          if (i === 1) throw e
          await new Promise((r) => setTimeout(r, 600))
        }
      }
      if (!gatt) throw new Error('GATT 连接未建立')
      this.gatt = gatt

      step = `查找服务 ${svc.slice(0, 8)}…`
      let service: BluetoothRemoteGATTService
      try {
        service = await gatt.getPrimaryService(svc)
      } catch (e) {
        // 失败时列出设备实际提供的服务，便于定位
        let found = ''
        try {
          const all = await gatt.getPrimaryServices()
          found = all.map((s) => s.uuid).join(', ')
        } catch {
          /* ignore */
        }
        throw new Error(
          `未找到服务（错误：${e instanceof Error ? e.message : e}）` +
            `${found ? `；设备实际提供：${found}` : '；且无法列出设备服务（可能已断开）'}。` +
            `常见原因：安卓蓝牙缓存过期（到系统设置里"忽略/取消配对"该设备后重试）、或固件服务 UUID 与配置不一致`,
        )
      }

      step = '查找读写特征'
      this.writeChar = await service.getCharacteristic(normalizeUuid(cfg.writeUuid))
      this.notifyChar = await service.getCharacteristic(normalizeUuid(cfg.notifyUuid))
      this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotify)

      step = '启动通知'
      await this.notifyChar.startNotifications()
      this.setState('connected')
    } catch (e) {
      this.setState('disconnected')
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`【${step}】${msg}`)
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
