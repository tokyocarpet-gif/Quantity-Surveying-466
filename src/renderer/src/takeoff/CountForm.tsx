import { MaterialInput } from '../MaterialInput'
import { materialSpecification, partLabel, type MaterialContext } from '../../../shared/materials'
import { categories, countUnitSchema, type CountInput, type Room } from '../../../shared/takeoff'

export function CountForm({
  value,
  onChange,
  masters,
  rooms,
  busy,
  adding,
  removing,
  onAdd,
  onRemove,
  undo,
  save,
  cancel,
  remove,
  saved
}: {
  value: CountInput
  onChange: (value: CountInput) => void
  masters: MaterialContext
  rooms: Room[]
  busy: boolean
  adding: boolean
  removing: boolean
  onAdd: () => void
  onRemove: () => void
  undo: () => void
  save: () => void
  cancel: () => void
  remove: () => void
  saved: boolean
}): React.JSX.Element {
  const change = (patch: Partial<CountInput>): void => onChange({ ...value, ...patch })
  const materials = masters.project.filter((m) => countUnitSchema.safeParse(m.unit).success)
  const parts = [
    ...new Set([
      '柱型',
      'ルーバー',
      ...categories,
      ...(masters.parts ?? []),
      ...materials.map((m) => m.category),
      value.category
    ])
  ]
  const units = [
    ...new Set([
      '個',
      '本',
      '箇所',
      '枚',
      '基',
      '台',
      ...(masters.units ?? []),
      ...materials.map((m) => m.unit),
      value.unit
    ])
  ].filter((u) => countUnitSchema.safeParse(u).success)
  return (
    <form
      className="count-form"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <fieldset disabled={busy}>
        <h3>{saved ? '個数拾いを編集' : '個数拾いを登録'}</h3>
        <p className="panel-description">
          柱型・ルーバーなどを1点ずつクリックして数えます。縮尺は不要です。
        </p>
        <div className="count-total" data-testid="count-draft-total">
          {value.points.length} <small>{value.unit}</small>
        </div>
        <div className="count-tools">
          <button
            type="button"
            className={adding ? 'primary' : 'secondary'}
            aria-pressed={adding}
            onClick={onAdd}
          >
            点を追加
          </button>
          <button
            type="button"
            className={removing ? 'primary' : 'secondary'}
            aria-pressed={removing}
            disabled={!value.points.length}
            onClick={onRemove}
          >
            点を取り消す
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!value.points.length}
            onClick={undo}
          >
            最後の点を戻す
          </button>
        </div>
        <p className="panel-description">
          {removing
            ? '取り消す番号の点をクリックしてください。'
            : '図面を右ドラッグで移動できます。'}
        </p>
        <label>
          部屋
          <select
            aria-label="個数拾いの部屋"
            value={value.roomId ?? ''}
            onChange={(e) => change({ roomId: e.target.value || null })}
          >
            <option value="">部屋未指定</option>
            {rooms
              .filter(
                (r, i, all) =>
                  all.findIndex((v) => v.groupId === r.groupId) === i || r.id === value.roomId
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          部位
          <select
            aria-label="個数拾いの部位"
            value={value.category}
            onChange={(e) => change({ category: e.target.value })}
          >
            <option value="">部位を選択</option>
            {parts.filter(Boolean).map((c) => (
              <option key={c} value={c}>
                {partLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称・仕上げ材
          <MaterialInput
            label="個数拾いの名称"
            value={value.name}
            materials={materials}
            onChange={(name) => change({ name })}
            onSelect={(m) =>
              change({
                name: m.name,
                category: m.category,
                specification: materialSpecification(m),
                unit: m.unit,
                unitPrice: m.unitPrice
              })
            }
          />
        </label>
        <label>
          仕様・規格
          <input
            aria-label="個数拾いの仕様・規格"
            value={value.specification}
            maxLength={400}
            onChange={(e) => change({ specification: e.target.value })}
          />
        </label>
        <label>
          単位
          <select
            aria-label="個数拾いの単位"
            value={value.unit}
            onChange={(e) => change({ unit: e.target.value })}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label>
          単価（円/{value.unit}）
          <input
            aria-label="個数拾いの単価"
            type="number"
            min="0"
            max="1000000000"
            step="any"
            value={value.unitPrice ?? ''}
            placeholder="空欄は未設定"
            onChange={(e) =>
              change({ unitPrice: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </label>
        <label>
          マークの色
          <input
            aria-label="個数拾いの色"
            type="color"
            value={value.color}
            onChange={(e) => change({ color: e.target.value })}
          />
        </label>
        <button className="primary wide" disabled={!value.points.length}>
          個数を確認
        </button>
        <button type="button" className="secondary wide" onClick={cancel}>
          編集をやめる
        </button>
        {saved && (
          <button type="button" className="text-button danger-text" onClick={remove}>
            この個数拾いを削除
          </button>
        )}
      </fieldset>
    </form>
  )
}
