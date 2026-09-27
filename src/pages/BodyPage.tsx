import { useBodyStore } from '../store/useBodyStore'
import { useSubjectStore } from '../store/useSubjectStore'
import { useApiConfigStore } from '../store/useApiConfigStore'
import { SENSOR_POSITION_LABEL, SENSOR_POSITIONS } from '../core/analysis/contract'
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
  const { subjectId, sensorPosition, setSubjectId, setSensorPosition } = useSubjectStore()
  const baseUrl = useApiConfigStore((s) => s.baseUrl)
  const setBaseUrl = useApiConfigStore((s) => s.setBaseUrl)

  return (
    <div className="page">
      {/* 采集与后端设置：后端数据契约要求每条样本带 subjectId 与 sensorPosition，
          此前两者都没上报，导致导入审计里是 subject_unknown / position=unknown */}
      <div className="card">
        <h3 className="card__title">采集设置</h3>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field__label">受试者编号（用于按人划分训练/验证/测试集）</span>
          <input
            className="input input--text"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          />
        </label>
        <div className="field" style={{ marginTop: 12 }}>
          <span className="field__label">传感器佩戴位置</span>
          <div className="seg" style={{ marginTop: 6 }}>
            {SENSOR_POSITIONS.map((p) => (
              <button
                key={p}
                type="button"
                className={`seg__btn${sensorPosition === p ? ' seg__btn--active' : ''}`}
                onClick={() => setSensorPosition(p)}
              >
                {SENSOR_POSITION_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field__label">分析后端地址（留空 = 用本地规则分析器）</span>
          <input
            className="input input--text"
            placeholder="http://127.0.0.1:8000"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <p className="card__desc" style={{ marginTop: 8 }}>
          后端只支持上臂佩戴并区分左右，与前端的动作轴映射一致。
        </p>
      </div>

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
