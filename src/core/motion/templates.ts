import type { MotionTemplate } from './types'

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: 'seated-press',
    name: '坐姿推举',
    type: 'preset',
    actionId: 1,
    mainAxis: 2,
    sensorPosition: 'wrist',
    basePosture: 'seated',
    speedProfile: 'variable',
    peakAngleDeg: 180,
    wristToleranceDeg: 15,
    cadence: 30,
    durationMs: 2000,
    keyframes: [
      // 起始=推举准备位（投降状）：大臂侧平举（外展90）+ 屈肘90 → 双手在肩两侧、前臂竖直向上。
      // 注意必须走「肩外展」而不是「肩屈」：全屈+外展0 会变成上臂前平举、手在脸前方。
      {
        t: 0,
        angles: { torsoFlexion: 0, shoulderFlexion: 0, shoulderAbduction: 90, elbowFlexion: 90, hipFlexion: 90, kneeFlexion: 90 },
        easing: 'smoothstep',
      },
      // 顶点=推起：大臂继续在额状面外展至竖直（180），肘伸直 → 双臂过头
      {
        t: 0.5,
        angles: { torsoFlexion: 0, shoulderFlexion: 0, shoulderAbduction: 180, elbowFlexion: 5, hipFlexion: 90, kneeFlexion: 90 },
        easing: 'smoothstep',
      },
      {
        t: 1,
        angles: { torsoFlexion: 0, shoulderFlexion: 0, shoulderAbduction: 90, elbowFlexion: 90, hipFlexion: 90, kneeFlexion: 90 },
        easing: 'smoothstep',
      },
    ],
  },
  {
    id: 'lateral-raise',
    name: '站姿侧平举',
    type: 'preset',
    actionId: 2,
    mainAxis: 2,
    sensorPosition: 'wrist',
    basePosture: 'standing',
    speedProfile: 'variable',
    peakAngleDeg: 90,
    wristToleranceDeg: 15,
    cadence: 30,
    durationMs: 2000,
    keyframes: [
      {
        t: 0,
        angles: { torsoFlexion: 0, shoulderFlexion: 0, shoulderAbduction: 0, elbowFlexion: 15, hipFlexion: 0, kneeFlexion: 0 },
        easing: 'smoothstep',
      },
      {
        t: 0.5,
        angles: { torsoFlexion: 0, shoulderFlexion: 0, shoulderAbduction: 90, elbowFlexion: 15, hipFlexion: 0, kneeFlexion: 0 },
        easing: 'smoothstep',
      },
      {
        t: 1,
        angles: { torsoFlexion: 0, shoulderFlexion: 0, shoulderAbduction: 0, elbowFlexion: 15, hipFlexion: 0, kneeFlexion: 0 },
        easing: 'smoothstep',
      },
    ],
  },
]
