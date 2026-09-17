import { useState } from 'react'
import { useMotionStore } from '../store/useMotionStore'
import { useAppStore } from '../store/useAppStore'
import { useCustomMotionStore } from '../store/useCustomMotionStore'
import { MOTION_TEMPLATES } from '../core/motion/templates'
import { AXIS_LABELS, POSTURE_LABELS, SENSOR_LABELS, type MotionTemplate } from '../core/motion/types'
import CustomMotionForm from '../components/CustomMotionForm'

export default function MotionPage() {
  const templateId = useMotionStore((s) => s.templateId)
  const setTemplateId = useMotionStore((s) => s.setTemplateId)
  const setTab = useAppStore((s) => s.setTab)
  const customs = useCustomMotionStore((s) => s.customs)
  const removeCustom = useCustomMotionStore((s) => s.removeCustom)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<MotionTemplate | null>(null)

  const goDemo = (id: string) => {
    setTemplateId(id)
    setTab('demo')
  }

  return (
    <div className="page">
      <div className="card">
        <h3 className="card__title">预设动作</h3>
        <p className="card__desc">内置两个标准动作，可在「演示」页实时回放，或下发到设备。</p>
      </div>

      {MOTION_TEMPLATES.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {AXIS_LABELS[t.mainAxis]} · {SENSOR_LABELS[t.sensorPosition]}佩戴 ·{' '}
                {POSTURE_LABELS[t.basePosture]}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                峰值 {t.peakAngleDeg}° · 节律 {t.cadence}/min
              </div>
            </div>
            <span className="chip">{templateId === t.id ? '已选中' : '预设'}</span>
          </div>
          <div className="btn-grid" style={{ marginTop: 12 }}>
            <button className="btn btn--ghost" onClick={() => setTemplateId(t.id)}>
              选择
            </button>
            <button className="btn" onClick={() => goDemo(t.id)}>
              去演示
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <div className="row">
          <h3 className="card__title">自定义动作</h3>
          <button
            className="btn btn--ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => {
              setEditing(null)
              setShowForm((v) => !v)
            }}
          >
            {showForm ? '收起' : '新建'}
          </button>
        </div>
        {customs.length === 0 ? (
          <p className="card__desc" style={{ marginTop: 8 }}>
            暂无自定义动作。点击「新建」，用关键帧参数定义你自己的标准动作。
          </p>
        ) : (
          <div className="log-list" style={{ marginTop: 10 }}>
            {customs.map((t) => (
              <div className="log-item" key={t.id}>
                <div className="row">
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      峰值 {t.peakAngleDeg}° · {t.durationMs}ms · {t.cadence}/min
                    </div>
                  </div>
                  <span className="chip">{templateId === t.id ? '已选中' : '自定义'}</span>
                </div>
                <div className="btn-grid" style={{ marginTop: 10 }}>
                  <button className="btn btn--ghost" onClick={() => goDemo(t.id)}>
                    演示
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => {
                      setEditing(t)
                      setShowForm(true)
                    }}
                  >
                    编辑
                  </button>
                  <button className="btn btn--ghost" onClick={() => removeCustom(t.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <CustomMotionForm
          key={editing?.id ?? 'new'}
          initial={editing ?? undefined}
          onSaved={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
