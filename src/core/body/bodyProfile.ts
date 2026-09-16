// 身体数据与等比例段长估算

export interface BodyProfile {
  heightCm: number
  weightKg: number
  shoulderWidthCm: number
  upperArmCm: number
  forearmCm: number
  torsoCm: number
}

export const DEFAULT_PROFILE: BodyProfile = {
  heightCm: 175,
  weightKg: 70,
  shoulderWidthCm: 42,
  upperArmCm: 32,
  forearmCm: 26,
  torsoCm: 52,
}

export interface ResolvedSegments {
  heightM: number
  torsoLen: number
  shoulderWidth: number
  upperArmLen: number
  forearmLen: number
  thighLen: number
  shinLen: number
  headRadius: number
  hipWidth: number
}

/** 把录入数据换算成模型各段长度（米），缺失段按身高比例估算 */
export function resolveSegments(p: BodyProfile): ResolvedSegments {
  const h = p.heightCm / 100
  return {
    heightM: h,
    torsoLen: Math.max(0.2, p.torsoCm / 100),
    shoulderWidth: Math.max(0.2, p.shoulderWidthCm / 100),
    upperArmLen: Math.max(0.15, p.upperArmCm / 100),
    forearmLen: Math.max(0.12, p.forearmCm / 100),
    thighLen: h * 0.245,
    shinLen: h * 0.246,
    headRadius: h * 0.072,
    hipWidth: Math.max(0.18, (p.shoulderWidthCm / 100) * 0.72),
  }
}
