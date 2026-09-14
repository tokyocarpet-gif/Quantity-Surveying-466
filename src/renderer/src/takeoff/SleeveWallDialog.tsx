import { useState } from 'react'
import { distance, sleeveWallSchema, type Room, type SleeveWall } from '../../../shared/takeoff'
import { quantityText, TakeoffDialog } from './Dialogs'
export function SleeveWallDialog({
  room,
  wall,
  scale,
  busy,
  error,
  save,
  close
}: {
  room: Room
  wall: SleeveWall
  scale: number
  busy: boolean
  error: string
  save: (wall: SleeveWall) => void
  close: () => void
}): React.JSX.Element {
  const [faces, setFaces] = useState(wall.faces)
  const [height, setHeight] = useState(wall.heightMm === null ? '' : String(wall.heightMm))
  const [baseboard, setBaseboard] = useState(wall.includeBaseboard)
  const [validation, setValidation] = useState('')
  const length = distance(...wall.points) * scale
  const appliedHeight = height === '' ? room.heightMm : Number(height)
  return (
    <TakeoffDialog title="袖壁の設定" busy={busy} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          setValidation('')
          try {
            save(
              sleeveWallSchema.parse({
                ...wall,
                name: form.get('name'),
                faces,
                heightMm: height === '' ? null : Number(height),
                includeBaseboard: baseboard
              })
            )
          } catch (e) {
            setValidation(e instanceof Error ? e.message : '入力を確認してください。')
          }
        }}
      >
        <div className="form-body">
          <p>部屋「{room.name}」の壁・巾木に加算します。床・天井の面積は変わりません。</p>
          <label>
            袖壁名
            <input
              name="name"
              aria-label="袖壁名"
              required
              maxLength={120}
              defaultValue={wall.name}
            />
          </label>
          <label>
            拾う面
            <select
              aria-label="袖壁の面数"
              value={faces}
              onChange={(e) => setFaces(Number(e.target.value) as 1 | 2)}
            >
              <option value={2}>両面（2面）</option>
              <option value={1}>片面（1面）</option>
            </select>
          </label>
          <label>
            高さ（mm・空欄は部屋と同じ）
            <input
              aria-label="袖壁の高さ"
              type="number"
              min="1"
              max="10000000"
              step="any"
              value={height}
              placeholder={`部屋と同じ：${room.heightMm} mm`}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
          <label className="sleeve-check">
            <input
              type="checkbox"
              checked={baseboard}
              onChange={(e) => setBaseboard(e.target.checked)}
            />
            袖壁の巾木も拾う
          </label>
          <div className="scale-summary">
            長さ {quantityText(length)} m × {faces}面<br />
            壁加算：
            {room.enabledCategories.includes('wall')
              ? `${quantityText((length * faces * appliedHeight) / 1000)} ㎡`
              : '壁は拾う部位に未選択'}
            <br />
            巾木加算：
            {room.enabledCategories.includes('baseboard')
              ? `${quantityText(baseboard ? length * faces : 0)} m`
              : '巾木は拾う部位に未選択'}
          </div>
          <p>
            仕上げ・単価はこの範囲の壁・巾木を使います。端部の小口や重なりは自動調整しません。数量固定中の項目は固定値を保持します。
          </p>
          {(validation || error) && (
            <div role="alert" className="form-error">
              {validation || error}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            戻る
          </button>
          <button className="primary" disabled={busy}>
            数量を確認
          </button>
        </footer>
      </form>
    </TakeoffDialog>
  )
}
