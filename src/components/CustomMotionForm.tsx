import { useEffect, useRef, useState } from 'react'
import { useCustomMotionStore } from '../store/useCustomMotionStore'
import { useMotionStore } from '../store/useMotionStore'
import { useAppStore } from '../store/useAppStore'
import { useBodyStore } from '../store/useBodyStore'
import HumanViewport from './HumanViewport'
import {
  AXIS_LABELS,
  POSTURE_LABELS,
  SENSOR_LABELS,
  type BasePosture,
  type JointAngles,
  type MainAxis,
  type MotionTemplate,
  type SensorPosition,
} from '../core/motion/types'
import { recommendSensor } from '../core/motion/kinematics'
import { httpMotionGenerator, type GeneratedDraft } from '../core/analysis/motionGenerator'

const SENSOR_OPTIONS = Object.entries(SENSOR_LABELS) as [SensorPosition, string][]
const POSTURE_OPTIONS = Object.entries(POSTURE_LABELS) as [BasePosture, string][]

const AXIS_BY_SENSOR: Record<SensorPosition, MainAxis[]> = {
  wrist: [1, 2, 3],
  'upper-arm': [1, 2, 3],
  thigh: [4, 5],
  shin: [4, 5],
}

const ANGLE_KEYS: { key: keyof JointAngles; label: string }[] = [
  { key: 'shoulderFlexion', label: '肩屈' },
  { key: 'shoulderAbduction', label: '肩外展' },
  { key: 'elbowFlexion', label: '肘屈' },
  { key: 'hipFlexion', label: '髋屈' },
  { key: 'kneeFlexion', label: '膝屈' },
]

const KF_ROWS = [
  { key: 'kfStart', label: '起始 (t=0)' },
  { key: 'kfMid', label: '顶点 (t=0.5)' },
  { key: 'kfEnd', label: '结束 (t=1)' },
] as const

type KfKey = (typeof KF_ROWS)[number]['key']

const ZERO: JointAngles = {
  shoulderFlexion: 0,
  shoulderAbduction: 0,
  elbowFlexion: 0,
  hipFlexion: 0,
  kneeFlexion: 0,
}

/** 根据佩戴位置 + 姿态，决定需要编辑的关节 */
function relevantKeys(sensor: SensorPosition, posture: BasePosture): (keyof JointAngles)[] {
  const lower = sensor === 'thigh' || sensor === 'shin'
  const base: (keyof JointAngles)[] = lower
    ? ['hipFlexion', 'kneeFlexion']
    : ['shoulderFlexion', 'shoulderAbduction', 'elbowFlexion']
  // 坐姿时额外展示髋/膝（作为基准姿态关节）
  if (posture === 'seated' && !lower) return [...base, 'hipFlexion', 'kneeFlexion']
  return base
}

/** 依据位置/姿态给出合理的起始关键帧与主运动轴 */
function buildDefaults(sensor: SensorPosition, posture: BasePosture) {
  const lower = sensor === 'thigh' || sensor === 'shin'
  const sit = posture === 'seated'
  const start: JointAngles = { ...ZERO, hipFlexion: sit ? 90 : 0, kneeFlexion: sit ? 90 : 0 }
  const end: JointAngles = { ...start }
  const mid: JointAngles = { ...start }
  if (lower) mid.hipFlexion = sit ? 30 : 60
  else mid.shoulderFlexion = 90
  const mainAxis: MainAxis = lower ? 4 : 1
  return { mainAxis, start, mid, end }
}

interface Draft {
  name: string
  mainAxis: MainAxis
  sensorPosition: SensorPosition
  basePosture: BasePosture
  peakAngleDeg: number
  wristToleranceDeg: number
  cadence: number
  durationMs: number
  kfStart: JointAngles
  kfMid: JointAngles
  kfEnd: JointAngles
}

function makeDraft(sensor: SensorPosition = 'wrist', posture: BasePosture = 'standing'): Draft {
  const d = buildDefaults(sensor, posture)
  return {
    name: '自定义动作',
    mainAxis: d.mainAxis,
    sensorPosition: sensor,
    basePosture: posture,
    peakAngleDeg: 90,
    wristToleranceDeg: 15,
    cadence: 30,
    durationMs: 2000,
    kfStart: d.start,
    kfMid: d.mid,
    kfEnd: d.end,
  }
}

function num(v: string, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default function CustomMotionForm() {
  const addCustom = useCustomMotionStore((s) => s.addCustom)
  const setTemplateId = useMotionStore((s) => s.setTemplateId)
  const setTab = useAppStore((s) => s.setTab)
  const profile = useBodyStore((s) => s.profile)
  const [draft, setDraft] = useState<Draft>(() => makeDraft())
  const [genDesc, setGenDesc] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genResult, setGenResult] = useState<string | null>(null)
  const previewRef = useRef<JointAngles | null>(draft.kfMid)

  // 顶点姿态实时预览
  useEffect(() => {
    previewRef.current = draft.kfMid
  }, [draft])

  const setKey = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const setAngle = (kf: KfKey, key: keyof JointAngles, v: number) =>
    setDraft((d) => ({ ...d, [kf]: { ...d[kf], [key]: v } }))

  const onSensorChange = (sensor: SensorPosition) => {
    const d = buildDefaults(sensor, draft.basePosture)
    setDraft((prev) => ({
      ...prev,
      sensorPosition: sensor,
      mainAxis: d.mainAxis,
      kfStart: d.start,
      kfMid: d.mid,
      kfEnd: d.end,
    }))
  }

  const onPostureChange = (posture: BasePosture) => {
    const d = buildDefaults(draft.sensorPosition, posture)
    setDraft((prev) => ({
      ...prev,
      basePosture: posture,
      mainAxis: d.mainAxis,
      kfStart: d.start,
      kfMid: d.mid,
      kfEnd: d.end,
    }))
  }

  const save = () => {
    const t: MotionTemplate = {
      id: `custom-${Date.now()}`,
      name: draft.name.trim() || '自定义动作',
      type: 'custom',
      actionId: 0,
      mainAxis: draft.mainAxis,
      sensorPosition: draft.sensorPosition,
      basePosture: draft.basePosture,
      peakAngleDeg: draft.peakAngleDeg,
      wristToleranceDeg: draft.wristToleranceDeg,
      cadence: draft.cadence,
      durationMs: draft.durationMs,
      keyframes: [
        { t: 0, angles: draft.kfStart, easing: 'smoothstep' },
        { t: 0.5, angles: draft.kfMid, easing: 'smoothstep' },
        { t: 1, angles: draft.kfEnd, easing: 'smoothstep' },
      ],
    }
    addCustom(t)
    setTemplateId(t.id)
    setTab('demo')
  }

  const applyGenerated = (d: GeneratedDraft) => {
    const sorted = [...d.keyframes].sort((a, b) => a.t - b.t)
    const start = sorted[0]?.angles ?? { ...ZERO }
    const end = sorted[sorted.length - 1]?.angles ?? { ...ZERO }
    const mid = sorted.find((k) => Math.abs(k.t - 0.5) < 0.01) ?? sorted[Math.floor(sorted.length / 2)]
    setDraft({
      name: d.name,
      mainAxis: d.mainAxis,
      sensorPosition: d.sensorPosition,
      basePosture: d.basePosture,
      peakAngleDeg: d.peakAngleDeg,
      wristToleranceDeg: d.wristToleranceDeg,
      cadence: d.cadence,
      durationMs: d.durationMs,
      kfStart: start,
      kfMid: mid?.angles ?? { ...ZERO },
      kfEnd: end,
    })
  }

  const onGenerate = async () => {
    const desc = genDesc.trim()
    if (!desc || genLoading) return
    setGenLoading(true)
    setGenError(null)
    setGenResult(null)
    try {
      const d = await httpMotionGenerator.generate(desc)
      applyGenerated(d)
      setGenResult(d.name)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenLoading(false)
    }
  }

  const shown = ANGLE_KEYS.filter((a) =>
    relevantKeys(draft.sensorPosition, draft.basePosture).includes(a.key),
  )
  const axisOptions = AXIS_BY_SENSOR[draft.sensorPosition]
  const recommended = recommendSensor([draft.kfStart, draft.kfMid, draft.kfEnd])

  return (
    <div className="card">
      <h3 className="card__title">新建自定义动作</h3>
      <p className="card__desc" style={{ marginTop: 4 }}>
        先确定表带佩戴位置，再配置对应的关节指标。
      </p>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field__label">智能生成 · 描述你的动作</span>
        <div className="row" style={{ marginTop: 6 }}>
          <input
            className="input input--text"
            style={{ flex: 1 }}
            value={genDesc}
            onChange={(e) => setGenDesc(e.target.value)}
            placeholder="如：俯卧撑、哑铃侧平举、深蹲…"
          />
          <button
            className="btn"
            onClick={onGenerate}
            disabled={genLoading}
            style={{ padding: '8px 14px' }}
          >
            {genLoading ? '生成中…' : '生成'}
          </button>
        </div>
        {genError && <div className="error" style={{ marginTop: 8 }}>{genError}</div>}
        {genResult && !genError && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--accent)' }}>
            已生成「{genResult}」，参数已填入下方，可继续手动修改后保存。
          </div>
        )}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field__label">① 表带佩戴位置</span>
        <div className="seg">
          {SENSOR_OPTIONS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`seg__btn${draft.sensorPosition === v ? ' seg__btn--active' : ''}`}
              onClick={() => onSensorChange(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          系统推荐：{SENSOR_LABELS[recommended]}
          {recommended !== draft.sensorPosition && (
            <button
              type="button"
              className="chip chip--btn"
              style={{ marginLeft: 6 }}
              onClick={() => onSensorChange(recommended)}
            >
              采用推荐
            </button>
          )}
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field__label">② 基准姿态</span>
        <div className="seg">
          {POSTURE_OPTIONS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`seg__btn${draft.basePosture === v ? ' seg__btn--active' : ''}`}
              onClick={() => onPostureChange(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field__label">③ 主运动轴</span>
        <div className="seg">
          {axisOptions.map((a) => (
            <button
              key={a}
              type="button"
              className={`seg__btn${draft.mainAxis === a ? ' seg__btn--active' : ''}`}
              onClick={() => setKey('mainAxis', a)}
            >
              {AXIS_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      <div className="field-grid" style={{ marginTop: 12 }}>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="field__label">名称</span>
          <input
            className="input input--text"
            type="text"
            value={draft.name}
            onChange={(e) => setKey('name', e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">峰值角度（°）</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={draft.peakAngleDeg}
            onChange={(e) => setKey('peakAngleDeg', num(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="field__label">节律（次/分）</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={draft.cadence}
            onChange={(e) => setKey('cadence', num(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="field__label">腕容限（°）</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={draft.wristToleranceDeg}
            onChange={(e) => setKey('wristToleranceDeg', num(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="field__label">单次时长（ms）</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={draft.durationMs}
            onChange={(e) => setKey('durationMs', num(e.target.value))}
          />
        </label>
      </div>

      <div className="muted" style={{ fontSize: 12, margin: '14px 0 6px' }}>
        ④ 关键帧（关节角度）
      </div>
      {KF_ROWS.map((row) => (
        <div key={row.key}>
          <div className="muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>
            {row.label}
          </div>
          <div
            className="field-grid"
            style={{ gridTemplateColumns: shown.length === 2 ? '1fr 1fr' : '1fr 1fr 1fr' }}
          >
            {shown.map((a) => (
              <label className="field" key={a.key}>
                <span className="field__label">{a.label}</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={draft[row.key][a.key]}
                  onChange={(e) => setAngle(row.key, a.key, num(e.target.value))}
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="muted" style={{ fontSize: 12, margin: '14px 0 6px' }}>
        ⑤ 3D 预览（顶点姿态）
      </div>
      <HumanViewport
        profile={profile}
        poseRef={previewRef}
        posture={draft.basePosture}
        sensorPosition={draft.sensorPosition}
      />

      <div className="btn-grid" style={{ marginTop: 14 }}>
        <button className="btn btn--ghost" onClick={() => setDraft(makeDraft())}>
          重置
        </button>
        <button className="btn" onClick={save}>
          保存并演示
        </button>
      </div>
    </div>
  )
}
