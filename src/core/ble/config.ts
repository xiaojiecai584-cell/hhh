// BLE 适配参数（可在网页端配置，无需改代码）

export interface BleConfig {
  serviceUuid: string
  writeUuid: string
  notifyUuid: string
  deviceNameFilter: string
  acceptAllDevices: boolean
}

export const DEFAULT_BLE_CONFIG: BleConfig = {
  serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
  writeUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
  notifyUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
  deviceNameFilter: '',
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
