import { MaterialInput } from '../MaterialInput'
import { useState } from 'react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import {
  categories,
  categoryLabels,
  categoryUnits,
  emptyFinishes,
  roomInputSchema,
  roomQuantities,
  type Point,
  type Room,
  type RoomInput
} from '../../../shared/takeoff'
import { materialSpecification, type Material } from '../../../shared/materials'
import { quantityText } from './Dialogs'
export function RoomForm({
  room,
  materials,
  groupSize,
  roomNames,
  heightHistory,
  openMaterials,
  polygon,
  scale,
  busy,
  save,
  redraw,
  remove,
  cancel
}: {
  room: Room | null
  materials: Material[]
  groupSize: number
  roomNames: string[]
  heightHistory: number[]
  openMaterials: () => void
  polygon: Point[]
  scale: number | null
  busy: boolean
  save: (input: RoomInput) => void
  redraw: () => void
  remove: () => void
  cancel: () => void
}): React.JSX.Element {
  const [error, setError] = useState('')
  const [name, setName] = useState(room?.name ?? '')
  const [enabled, setEnabled] = useState(room?.enabledCategories ?? [...categories])
  const [finishes, setFinishes] = useState(room?.finishes ?? emptyFinishes())
  const [height, setHeight] = useState(String(room?.heightMm ?? heightHistory[0] ?? 2400))
  let quantities: Record<string, number> | null = null
  try {
    quantities = roomQuantities(polygon, scale, Number(height), room?.sleeveWalls)
  } catch {
    /* Validation appears on submit. */
  }
  return (
    <form
      className="room-form"
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        const form = new FormData(event.currentTarget)
        try {
          const input = roomInputSchema.parse({
            name: form.get('name'),
            color: form.get('color'),
            heightMm: Number(height),
            polygon,
            finishes,
            sleeveWalls: room?.sleeveWalls ?? [],
            enabledCategories: enabled
          })
          roomQuantities(polygon, scale, input.heightMm, input.sleeveWalls)
          save(input)
        } catch (e) {
          setError(e instanceof Error ? e.message : '入力を確認してください。')
        }
      }}
    >
      <fieldset disabled={busy}>
        <h3>{room ? '部屋を編集' : '部屋を登録'}</h3>
        <p className="panel-description">拾う部位を選び、平面の面積と外周から計算します。</p>
        <label>
          部屋名
          <input
            aria-label="部屋名"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="room-name-history"
            required
            maxLength={120}
            placeholder="例：会議室"
            autoFocus
          />
        </label>
        {groupSize > 1 && (
          <p className="panel-description">
            部屋名は統合した全{groupSize}
            範囲に反映します。部位・高さ・仕上げ・形状はこの範囲だけを変更します。
          </p>
        )}
        <datalist id="room-name-history">
          {roomNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {!!roomNames.length && (
          <select
            aria-label="部屋名の履歴から選択"
            value=""
            onChange={(e) => setName(e.target.value)}
          >
            <option value="" disabled>
              部屋名の履歴から選択
            </option>
            {roomNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        <div className="room-fields">
          <label>
            天井・壁高さ（mm）
            <input
              aria-label="天井・壁高さ（mm）"
              type="number"
              min="1"
              max="10000000"
              step="any"
              required
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
          <label>
            色
            <input
              aria-label="部屋の色"
              type="color"
              name="color"
              defaultValue={room?.color ?? '#327e6d'}
            />
          </label>
        </div>
        {!!heightHistory.length && (
          <select
            aria-label="高さの履歴から選択"
            value=""
            onChange={(e) => setHeight(e.target.value)}
          >
            <option value="" disabled>
              高さの履歴から選択
            </option>
            {heightHistory.map((h) => (
              <option key={h} value={h}>
                {quantityText(h)} mm
              </option>
            ))}
          </select>
        )}
        {room?.sleeveWalls.length ? (
          <p className="panel-description">
            袖壁 {room.sleeveWalls.length}{' '}
            本を含む数量です。図形の描き直し後も袖壁の線は保持します。
          </p>
        ) : null}
        <div className="room-geometry">
          <span>{polygon.length}頂点</span>
          <button type="button" className="text-button" onClick={redraw}>
            <Pencil size={13} />
            形状を描き直す
          </button>
        </div>
        <div className="category-actions">
          <button type="button" className="text-button" onClick={() => setEnabled([...categories])}>
            4部位すべて
          </button>
          <button type="button" className="text-button" onClick={() => setEnabled([])}>
            選択を解除
          </button>
        </div>
        <div className="category-selection">
          {categories.map((c) => (
            <label key={c} className="category-toggle">
              <input
                type="checkbox"
                aria-label={`${categoryLabels[c]}を拾う`}
                checked={enabled.includes(c)}
                onChange={(e) =>
                  setEnabled(e.target.checked ? [...enabled, c] : enabled.filter((v) => v !== c))
                }
              />
              {categoryLabels[c]}
            </label>
          ))}
        </div>
        <button type="button" className="secondary wide" onClick={openMaterials}>
          仕上げ材マスタを開く
        </button>
        {categories
          .filter((c) => enabled.includes(c))
          .map((c) => (
            <div className="finish-input" key={c}>
              <div>
                <strong>{categoryLabels[c]}</strong>
                <span>
                  {quantities ? quantityText(quantities[c]) : '—'} {categoryUnits[c]}
                </span>
              </div>
              {enabled.includes(c) && (
                <>
                  <MaterialInput
                    label={`${categoryLabels[c]}の仕上げ`}
                    value={finishes[c].name}
                    materials={materials.filter(
                      (m) => m.category === c && m.unit === categoryUnits[c]
                    )}
                    onChange={(name) => setFinishes((f) => ({ ...f, [c]: { ...f[c], name } }))}
                    onSelect={(m) =>
                      setFinishes((f) => ({
                        ...f,
                        [c]: {
                          name: m.name,
                          specification: materialSpecification(m),
                          unitPrice: m.unitPrice
                        }
                      }))
                    }
                  />
                  <input
                    aria-label={`${categoryLabels[c]}の仕様・規格`}
                    placeholder="仕様・規格"
                    maxLength={400}
                    value={finishes[c].specification ?? ''}
                    onChange={(e) =>
                      setFinishes((f) => ({
                        ...f,
                        [c]: { ...f[c], specification: e.target.value }
                      }))
                    }
                  />
                  <label className="price-label">
                    <input
                      aria-label={`${categoryLabels[c]}の単価`}
                      name={`${c}-price`}
                      type="number"
                      min="0"
                      max="1000000000"
                      step="any"
                      value={finishes[c].unitPrice ?? ''}
                      onChange={(e) =>
                        setFinishes((f) => ({
                          ...f,
                          [c]: {
                            ...f[c],
                            unitPrice: e.target.value === '' ? null : Number(e.target.value)
                          }
                        }))
                      }
                      placeholder="単価（任意）"
                    />
                    <span>円/{categoryUnits[c]}</span>
                  </label>
                </>
              )}
            </div>
          ))}
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <button type="submit" className="primary wide">
          <Check size={16} />
          数量を確認
        </button>
        <button type="button" className="secondary wide" onClick={cancel}>
          編集をやめる
        </button>
        {room && (
          <button type="button" className="text-button danger-text" onClick={remove}>
            <Trash2 size={14} />
            {groupSize > 1 ? 'この範囲を削除' : 'この部屋を削除'}
          </button>
        )}
      </fieldset>
    </form>
  )
}
