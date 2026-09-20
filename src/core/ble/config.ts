// BLE 适配参数（可在网页端配置，无需改代码）
// 新版硬件：ESP32-S3 + 标准 NUS（Nordic UART Service），广播名 Lindoway。

export interface BleConfig {
  serviceUuid: string
  writeUuid: string
  notifyUuid: string
  deviceNameFilter: string
  acceptAllDevices: boolean
}

export const DEFAULT_BLE_CONFIG: BleConfig = {
  serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // NUS 服务
  writeUuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // 下行 RX：网页→设备（发 0x82）
  notifyUuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // 上行 TX：设备→网页（收 0x01）
  deviceNameFilter: 'Lindoway',
  acceptAllDevices: false,
}

/** 短 UUID（如 ffe0 / 0xFFE1）补全为 128 位标准格式 */
export function normalizeUuid(input: string): string {
  const s = input.trim().toLowerCase().replace(/^0x/, '')
  if (/^[0-9a-f]{1,4}$/.test(s)) {
    return `0000${s.padStart(4, '0')}-0000-1000-8000-00805f9b34fb`
  }
  return input.trim()
}
