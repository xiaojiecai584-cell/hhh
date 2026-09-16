import type { MotionTemplate } from './types'

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: 'seated-press',
    name: '坐姿推举',
    type: 'preset',
    actionId: 1,
    mainAxis: 1,
    sensorPosition: 'wrist',
    basePosture: 'seated',
    peakAngleDeg: 180,
    wristToleranceDeg: 15,
    cadence: 30,
    durationMs: 2000,
    keyframes: [
      {
        t: 0,
        angles: { shoulderFlexion: 0, shoulderAbduction: 0, elbowFlexion: 90, hipFlexion: 90, kneeFlexion: 90 },
        easing: 'smoothstep',
      },
      {
        t: 0.5,
        angles: { shoulderFlexion: 180, shoulderAbduction: 0, elbowFlexion: 5, hipFlexion: 90, kneeFlexion: 90 },
        easing: 'smoothstep',
      },
      {
        t: 1,
        angles: { shoulderFlexion: 0, shoulderAbduction: 0, elbowFlexion: 90, hipFlexion: 90, kneeFlexion: 90 },
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
    peakAngleDeg: 90,
    wristToleranceDeg: 15,
    cadence: 30,
    durationMs: 2000,
    keyframes: [
      {
        t: 0,
        angles: { shoulderFlexion: 0, shoulderAbduction: 0, elbowFlexion: 15, hipFlexion: 0, kneeFlexion: 0 },
        easing: 'smoothstep',
      },
      {
        t: 0.5,
        angles: { shoulderFlexion: 0, shoulderAbduction: 90, elbowFlexion: 15, hipFlexion: 0, kneeFlexion: 0 },
        easing: 'smoothstep',
      },
      {
        t: 1,
        angles: { shoulderFlexion: 0, shoulderAbduction: 0, elbowFlexion: 15, hipFlexion: 0, kneeFlexion: 0 },
        easing: 'smoothstep',
      },
    ],
  },
]
