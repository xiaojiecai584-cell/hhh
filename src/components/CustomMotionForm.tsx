import { useEffect, useRef, useState } from 'react'
import { useCustomMotionStore } from '../store/useCustomMotionStore'
import { useMotionStore } from '../store/useMotionStore'
import { useAppStore } from '../store/useAppStore'
import { useBodyStore } from '../store/useBodyStore'
import HumanViewport from './HumanViewport'
import {
  AXIS_LABELS,
  JOINT_RANGE,
  POSTURE_LABELS,
  SENSOR_LABELS,
  SPEED_LABELS,
  type BasePosture,
  type JointAngles,
  type MainAxis,
  type MotionTemplate,
  type SensorPosition,
  type SpeedProfile,
} from '../core/motion/types'
import { recommendSensor } from '../core/motion/kinematics'
import { httpMotionGenerator, type GeneratedDraft } from '../core/analysis/motionGenerator'
import { fetchReferenceImage, type ReferenceImage } from '../core/analysis/referenceImage'

const SENSOR_OPTIONS = Object.entries(SENSOR_LABELS) as [SensorPosition, string][]
const POSTURE_OPTIONS = Object.entries(POSTURE_LABELS) as [BasePosture, string][]
const SPEED_OPTIONS = Object.entries(SPEED_LABELS) as [SpeedProfile, string][]

const AXIS_BY_SENSOR: Record<SensorPosition, MainAxis[]> = {
  wrist: [1, 2, 3],
  'upper-arm': [1, 2, 3],
  thigh: [4, 5],
  shin: [4, 5],
}

const ANGLE_KEYS: { key: keyof JointAngles; label: string }[] = [
  { key: 'torsoFlexion', label: '躯干屈' },
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
  torsoFlexion: 0,
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
    ? ['torsoFlexion', 'hipFlexion', 'kneeFlexion']
    : ['torsoFlexion', 'shoulderFlexion', 'shoulderAbduction', 'elbowFlexion']
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
  searchTerm: string
  mainAxis: MainAxis
  sensorPosition: SensorPosition
  basePosture: BasePosture
  speedProfile: SpeedProfile
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
    searchTerm: '',
    mainAxis: d.mainAxis,
    sensorPosition: sensor,
    basePosture: posture,
    speedProfile: 'variable',
    peakAngleDeg: 90,
    wristToleranceDeg: 15,
    cadence: 30,
    durationMs: 2000,
    kfStart: d.start,
    kfMid: d.mid,
    kfEnd: d.end,
  }
}

/** 把已保存的动作模板还原为可编辑的草稿（折叠为起始/顶点/结束三帧） */
function templateToDraft(t: MotionTemplate): Draft {
  const sorted = [...t.keyframes].sort((a, b) => a.t - b.t)
  const start = sorted[0]?.angles ?? { ...ZERO }
  const end = sorted[sorted.length - 1]?.angles ?? { ...ZERO }
  const mid = sorted.find((k) => Math.abs(k.t - 0.5) < 0.01) ?? sorted[Math.floor(sorted.length / 2)]
  return {
    name: t.name,
    searchTerm: '',
    mainAxis: t.mainAxis,
    sensorPosition: t.sensorPosition,
    basePosture: t.basePosture,
    speedProfile: t.speedProfile,
    peakAngleDeg: t.peakAngleDeg,
    wristToleranceDeg: t.wristToleranceDeg,
    cadence: t.cadence,
    durationMs: t.durationMs,
    kfStart: start,
    kfMid: mid?.angles ?? { ...ZERO },
    kfEnd: end,
  }
}

function num(v: string, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

interface CustomMotionFormProps {
  initial?: MotionTemplate
  onSaved?: () => void
}

export default function CustomMotionForm({ initial, onSaved }: CustomMotionFormProps) {
  const addCustom = useCustomMotionStore((s) => s.addCustom)
  const updateCustom = useCustomMotionStore((s) => s.updateCustom)
  const setTemplateId = useMotionStore((s) => s.setTemplateId)
  const setTab = useAppStore((s) => s.setTab)
  const profile = useBodyStore((s) => s.profile)
  const [draft, setDraft] = useState<Draft>(() => (initial ? templateToDraft(initial) : makeDraft()))
  const [previewKf, setPreviewKf] = useState<KfKey>('kfMid')
  const [genDesc, setGenDesc] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genResult, setGenResult] = useState<string | null>(null)
  const previewRef = useRef<JointAngles | null>(draft.kfMid)
  const [reviewState, setReviewState] = useState<string | null>(null)
  const editedRef = useRef(false) // 用户是否已手动改过（改过则不自动覆盖）
  const pollRef = useRef(0) // 轮询代次，用于取消过期的轮询

  // 关键帧姿态实时预览
  useEffect(() => {
    previewRef.current = draft[previewKf]
  }, [draft, previewKf])

  const searchTerm = (draft.searchTerm || '').trim()
  const [refImg, setRefImg] = useState<ReferenceImage | null>(null)
  const [refLoading, setRefLoading] = useState(false)

  // 自动检索真实动作参考图
  useEffect(() => {
    if (!searchTerm) {
      setRefImg(null)
      return
    }
    let alive = true
    setRefLoading(true)
    setRefImg(null)
    fetchReferenceImage(searchTerm).then((img) => {
      if (!alive) return
      setRefImg(img)
      setRefLoading(false)
    })
    return () => {
      alive = false
    }
  }, [searchTerm])

  const setKey = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    editedRef.current = true
    setDraft((d) => ({ ...d, [k]: v }))
  }

  const setAngle = (kf: KfKey, key: keyof JointAngles, v: number) => {
    editedRef.current = true
    setDraft((d) => ({
      ...d,
      [kf]: {
        ...d[kf],
        [key]: Math.min(JOINT_RANGE[key][1], Math.max(JOINT_RANGE[key][0], v)),
      },
    }))
  }

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
      id: initial?.id ?? `custom-${Date.now()}`,
      name: draft.name.trim() || '自定义动作',
      type: 'custom',
      actionId: 0,
      mainAxis: draft.mainAxis,
      sensorPosition: draft.sensorPosition,
      basePosture: draft.basePosture,
      speedProfile: draft.speedProfile,
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
    // 上报训练样本（动作描述 → 最终参数），异步不阻塞保存
    try {
      fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: genDesc.trim() || null,
          name: t.name,
          basePosture: t.basePosture,
          sensorPosition: t.sensorPosition,
          mainAxis: t.mainAxis,
          speedProfile: t.speedProfile,
          keyframes: t.keyframes,
        }),
      }).catch(() => {})
    } catch {
      /* ignore */
    }

    if (initial) {
      updateCustom(t)
      onSaved?.()
    } else {
      addCustom(t)
      setTemplateId(t.id)
      setTab('demo')
    }
  }

  const applyGenerated = (d: GeneratedDraft) => {
    const sorted = [...d.keyframes].sort((a, b) => a.t - b.t)
    const start = sorted[0]?.angles ?? { ...ZERO }
    const end = sorted[sorted.length - 1]?.angles ?? { ...ZERO }
    const mid = sorted.find((k) => Math.abs(k.t - 0.5) < 0.01) ?? sorted[Math.floor(sorted.length / 2)]
    setDraft({
      name: d.name,
      searchTerm: d.searchTerm ?? '',
      mainAxis: d.mainAxis,
      sensorPosition: d.sensorPosition,
      basePosture: d.basePosture,
      speedProfile: d.speedProfile,
      peakAngleDeg: d.peakAngleDeg,
      wristToleranceDeg: d.wristToleranceDeg,
      cadence: d.cadence,
      durationMs: d.durationMs,
      kfStart: start,
      kfMid: mid?.angles ?? { ...ZERO },
      kfEnd: end,
    })
  }

  /** 应用视觉评审修正：把修正后的 basePose + moves 重新合成为起始/顶点/结束三帧 */
  const applyCorrection = (
    basePose: Record<string, number>,
    moves: { joint: string; from: number; to: number }[],
  ) => {
    setDraft((d) => {
      const start = { ...d.kfStart }
      const mid = { ...d.kfMid }
      for (const a of ANGLE_KEYS) {
        const v = basePose[a.key]
        if (Number.isFinite(v)) {
          start[a.key] = v
          mid[a.key] = v
        }
      }
      for (const m of moves) {
        if (!ANGLE_KEYS.some((a) => a.key === m.joint)) continue
        const kk = m.joint as keyof JointAngles
        start[kk] = m.from
        mid[kk] = m.to
      }
      return { ...d, kfStart: start, kfMid: mid, kfEnd: { ...start } }
    })
  }

  /** 轮询后台视觉评审结果（约 30 秒内出结果） */
  const pollReview = async (id: string) => {
    const gen = ++pollRef.current
    setReviewState('视觉评审中…（约 30 秒）')
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      if (pollRef.current !== gen) return // 已被新一轮生成取代
      try {
        const res = await fetch(`/api/review?id=${encodeURIComponent(id)}`)
        if (!res.ok) continue
        const data = await res.json()
        if (!data || data.status === 'pending') continue
        if (data.status === 'disabled') {
          setReviewState(`视觉评审未启用（${data.reason ?? ''}）`)
          return
        }
        if (data.status === 'error' || data.error) {
          setReviewState(`视觉评审失败：${String(data.error ?? '').slice(0, 50)}`)
          return
        }
        if (data.correct === true) {
          setReviewState('视觉评审通过 ✅')
          return
        }
        const cp = data.corrected?.basePose
        const cm = data.corrected?.moves
        if (cp && Array.isArray(cm) && !editedRef.current) {
          applyCorrection(cp, cm)
          setReviewState(`已按视觉评审自动修正 ✅${data.reason ? `（${data.reason}）` : ''}`)
        } else if (editedRef.current) {
          setReviewState(`视觉评审建议修正，但你已手动调整，未覆盖${data.reason ? `（${data.reason}）` : ''}`)
        } else {
          setReviewState('视觉评审完成')
        }
        return
      } catch {
        /* 忽略，继续重试 */
      }
    }
    setReviewState('视觉评审超时（未取到结果）')
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
      editedRef.current = false
      setReviewState(null)
      const moveText = d.moves
        .map((m) => `${ANGLE_KEYS.find((a) => a.key === m.joint)?.label ?? m.joint} ${m.from}°→${m.to}°`)
        .join('、')
      setGenResult(moveText ? `${d.name}（主运动：${moveText}）` : d.name)
      if (d.reviewId) void pollReview(d.reviewId)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenLoading(false)
    }
  }

  const relevant = new Set(relevantKeys(draft.sensorPosition, draft.basePosture))
  const shown = ANGLE_KEYS
  const axisOptions = AXIS_BY_SENSOR[draft.sensorPosition]
  const recommended = recommendSensor([draft.kfStart, draft.kfMid, draft.kfEnd])

  return (
    <div className="card">
      <h3 className="card__title">{initial ? '编辑自定义动作' : '新建自定义动作'}</h3>
      <p className="card__desc" style={{ marginTop: 4 }}>
        先确定表带佩戴位置，再配置关节指标；生成后可微调全部 6 个关节角度。
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
        {reviewState && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {reviewState}
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

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field__label">速度模式</span>
        <div className="seg">
          {SPEED_OPTIONS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`seg__btn${draft.speedProfile === v ? ' seg__btn--active' : ''}`}
              onClick={() => setKey('speedProfile', v)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          匀速：角速度恒定；非匀速：起停缓、中间快（正弦速度曲线）。
        </p>
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
        ④ 关键帧（全部 6 个关节角度，标注「主」为佩戴位置相关关节）
      </div>
      {KF_ROWS.map((row) => (
        <div key={row.key}>
          <div className="muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>
            {row.label}
          </div>
          <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            {shown.map((a) => (
              <label className="field" key={a.key}>
                <span className="field__label">
                  {a.label}
                  {relevant.has(a.key) && (
                    <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 3 }}>主</span>
                  )}
                </span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min={JOINT_RANGE[a.key][0]}
                  max={JOINT_RANGE[a.key][1]}
                  value={draft[row.key][a.key]}
                  onChange={(e) => setAngle(row.key, a.key, num(e.target.value))}
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="muted" style={{ fontSize: 12, margin: '14px 0 6px' }}>
        ⑤ 3D 预览
      </div>
      <div className="seg" style={{ marginBottom: 8 }}>
        {KF_ROWS.map((row) => (
          <button
            key={row.key}
            type="button"
            className={`seg__btn${previewKf === row.key ? ' seg__btn--active' : ''}`}
            onClick={() => setPreviewKf(row.key)}
          >
            {row.label}
          </button>
        ))}
      </div>
      <HumanViewport
        profile={profile}
        poseRef={previewRef}
        posture={draft.basePosture}
        sensorPosition={draft.sensorPosition}
      />

      <div className="muted" style={{ fontSize: 12, margin: '12px 0 6px' }}>
        ⑥ 真实动作参考图{searchTerm ? `（检索词：${searchTerm}）` : '（AI 生成后自动联网检索）'}
      </div>
      {refLoading && <div className="muted" style={{ fontSize: 12 }}>正在联网检索参考图…</div>}
      {!refLoading && refImg && (
        <figure style={{ margin: 0 }}>
          <img
            src={refImg.thumburl}
            alt={refImg.title}
            style={{
              width: '100%',
              maxHeight: 240,
              objectFit: 'contain',
              background: '#fff',
              borderRadius: 8,
            }}
          />
          <figcaption className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            来源：
            <a href={refImg.descriptionurl} target="_blank" rel="noreferrer">
              {refImg.title.replace(/^File:/, '')}
            </a>
          </figcaption>
        </figure>
      )}
      {!refLoading && !refImg && (
        <div className="muted" style={{ fontSize: 12 }}>
          未自动找到参考图，可
          <a
            href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchTerm || draft.name)}`}
            target="_blank"
            rel="noreferrer"
          >
            {' '}在 Google 图片搜索
          </a>
        </div>
      )}

      <div className="btn-grid" style={{ marginTop: 14 }}>
        <button
          className="btn btn--ghost"
          onClick={() => setDraft(initial ? templateToDraft(initial) : makeDraft())}
        >
          重置
        </button>
        <button className="btn" onClick={save}>
          {initial ? '保存修改' : '保存并演示'}
        </button>
      </div>
    </div>
  )
}
