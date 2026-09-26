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

/**
 * 肩外展时大臂随之产生的「自然外旋」（度），上限 ±90°。
 *
 * 为什么需要它：肘屈只能绕大臂自身的局部 X 轴弯曲。大臂外展 90° 后该轴变成世界 Y 轴，
 * 于是屈肘只能让前臂在水平面内前后摆、抬不起来——真实的「投降状/哑铃推举准备位」
 * （外展 90 + 屈肘 90 + 前臂朝上）就做不出来。人体靠大臂外旋（掌心朝前）实现。
 * 这里是模型上的**耦合近似**（不是独立自由度）：外展多少就外旋多少，封顶 90°。
 */
export function shoulderTwistDeg(abductionDeg: number): number {
  return Math.max(-90, Math.min(90, abductionDeg))
}

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

/** 各关节生理活动度上限 [min, max]（度），作为 AI 生成与手动输入的统一约束 */
export const JOINT_RANGE: Record<keyof JointAngles, [number, number]> = {
  torsoFlexion: [0, 80],
  shoulderFlexion: [0, 180],
  shoulderAbduction: [0, 180],
  elbowFlexion: [0, 150],
  hipFlexion: [0, 140],
  kneeFlexion: [0, 150],
}
