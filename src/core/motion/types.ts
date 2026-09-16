// 动作引擎共享类型

export interface JointAngles {
  torsoFlexion: number // 躯干屈（前倾 +），度
  shoulderFlexion: number // 肩屈（前举 +），度
  shoulderAbduction: number // 肩外展（侧举 +），度
  elbowFlexion: number // 肘屈，度
  hipFlexion: number // 髋屈（前抬腿 +），度
  kneeFlexion: number // 膝屈，度
}

export type MainAxis = 1 | 2 | 3 | 4 | 5 // 1肩屈 2肩外展 3肘屈 4髋屈 5膝屈

export type SensorPosition = 'wrist' | 'upper-arm' | 'thigh' | 'shin'
export type BasePosture = 'standing' | 'seated' | 'prone' | 'supine'
export type SpeedProfile = 'uniform' | 'variable' // 匀速 / 非匀速

export interface Keyframe {
  t: number // 归一化时间 0..1
  angles: JointAngles
  easing: 'linear' | 'smoothstep'
}

export interface MotionTemplate {
  id: string
  name: string
  type: 'preset' | 'custom'
  actionId: number // 下发到硬件的动作 ID
  mainAxis: MainAxis
  sensorPosition: SensorPosition // 表带/传感器佩戴位置
  basePosture: BasePosture // 基准姿态
  speedProfile: SpeedProfile // 速度模式：匀速/非匀速
  peakAngleDeg: number
  wristToleranceDeg: number
  cadence: number // 节律 次/分
  durationMs: number // 单次时长
  keyframes: Keyframe[]
}

export const SENSOR_LABELS: Record<SensorPosition, string> = {
  wrist: '手腕',
  'upper-arm': '上臂',
  thigh: '大腿',
  shin: '小腿/脚踝',
}

export const POSTURE_LABELS: Record<BasePosture, string> = {
  standing: '站立',
  seated: '坐姿',
  prone: '俯卧',
  supine: '仰卧',
}

export const SPEED_LABELS: Record<SpeedProfile, string> = {
  uniform: '匀速',
  variable: '非匀速',
}

export const AXIS_LABELS: Record<MainAxis, string> = {
  1: '肩屈',
  2: '肩外展',
  3: '肘屈',
  4: '髋屈',
  5: '膝屈',
}
