import { useBodyStore } from '../store/useBodyStore'
import type { BodyProfile } from '../core/body/bodyProfile'
import HumanViewport from '../components/HumanViewport'

const FIELDS: { key: keyof BodyProfile; label: string; unit: string }[] = [
  { key: 'heightCm', label: '身高', unit: 'cm' },
  { key: 'weightKg', label: '体重', unit: 'kg' },
  { key: 'shoulderWidthCm', label: '肩宽', unit: 'cm' },
  { key: 'upperArmCm', label: '上臂长', unit: 'cm' },
  { key: 'forearmCm', label: '前臂长', unit: 'cm' },
  { key: 'torsoCm', label: '躯干长', unit: 'cm' },
]

export default function BodyPage() {
  const profile = useBodyStore((s) => s.profile)
  const setField = useBodyStore((s) => s.setField)
  const reset = useBodyStore((s) => s.reset)

  return (
    <div className="page">
      <div className="card">
        <h3 className="card__title">身体数据</h3>
        <div className="field-grid" style={{ marginTop: 12 }}>
          {FIELDS.map((f) => (
            <label className="field" key={f.key}>
              <span className="field__label">
                {f.label}（{f.unit}）
              </span>
              <span className="field__input">
                <input
                  type="number"
                  inputMode="decimal"
                  value={profile[f.key]}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                />
              </span>
            </label>
          ))}
        </div>
        <button className="btn btn--ghost" onClick={reset} style={{ marginTop: 12 }}>
          恢复默认
        </button>
      </div>

      <div className="card">
        <div className="row">
          <h3 className="card__title">等比例人体模型</h3>
          <span className="chip">随数据缩放</span>
        </div>
        <HumanViewport profile={profile} />
      </div>
    </div>
  )
}
