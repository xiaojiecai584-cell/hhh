import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BLE_CONFIG, type BleConfig } from '../core/ble/config'

interface BleConfigState {
  config: BleConfig
  setField: (key: keyof BleConfig, value: string | boolean) => void
  reset: () => void
}

export const useBleConfigStore = create<BleConfigState>()(
  persist(
    (set) => ({
      config: { ...DEFAULT_BLE_CONFIG },
      setField: (key, value) => set((s) => ({ config: { ...s.config, [key]: value } })),
      reset: () => set({ config: { ...DEFAULT_BLE_CONFIG } }),
    }),
    {
      name: 'lindoway-ble-config',
      version: 2,
      // 旧版存的是 BT36 的 0xFFE0/0xFFE1，升级后重置为 NUS 默认值
      migrate: () => ({ config: { ...DEFAULT_BLE_CONFIG } }),
    },
  ),
)
