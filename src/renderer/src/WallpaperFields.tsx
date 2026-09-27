import { useState } from 'react'
import { matchLabels, type Wallpaper } from '../../shared/wall-layout'
export const emptyWallpaper = (): Wallpaper => ({
  widthMm: 0,
  repeatMm: 0,
  horizontalRepeatMm: 0,
  match: 'none',
  stepMm: 0,
  rollLengthMm: null
})
export function WallpaperFields({
  value,
  onChange
}: {
  value: Wallpaper
  onChange: (m: Wallpaper) => void
}) {
  const field = (
    key: 'widthMm' | 'repeatMm' | 'horizontalRepeatMm' | 'stepMm' | 'rollLengthMm',
    label: string
  ) => (
    <label>
      {label}
      <input
        name={`wp-${key}`}
        aria-label={label}
        type="number"
        min="0"
        step="any"
        value={key === 'widthMm' && value[key] === 0 ? '' : (value[key] ?? '')}
        onChange={(e) =>
          onChange({
            ...value,
            [key]: e.target.value === '' && key === 'rollLengthMm' ? null : Number(e.target.value)
          })
        }
      />
    </label>
  )
  return (
    <div className="wallpaper-fields">
      {field('widthMm', 'クロスの有効幅（mm）')}
      <label>
        柄合わせ
        <select
          name="wp-match"
          aria-label="クロスの柄合わせ"
          value={value.match}
          onChange={(e) => onChange({ ...value, match: e.target.value as Wallpaper['match'] })}
        >
          {Object.entries(matchLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {field('repeatMm', '縦リピート（mm）')}
      {field('horizontalRepeatMm', '横リピート（mm）')}
      {value.match === 'step' && (
        <>
          {field('stepMm', 'ステップずれ（mm）')}
          <button
            type="button"
            className="secondary"
            onClick={() => onChange({ ...value, stepMm: value.repeatMm / 2 })}
          >
            縦リピートの半分にする
          </button>
        </>
      )}
      {field('rollLengthMm', 'クロスの巻き長さ（mm・任意）')}
      <p className="panel-description">
        有効幅は継ぎ合わせ後の幅です。横リピートは仕様として表示します。ステップ柄はメーカー指定のずれ量を入力してください。
      </p>
    </div>
  )
}
export function WallpaperMasterFields({ initial }: { initial: Wallpaper | null | undefined }) {
  const [enabled, setEnabled] = useState(!!initial),
    [value, setValue] = useState(initial ?? emptyWallpaper())
  return (
    <fieldset className="wallpaper-master">
      <legend>壁クロスの割り付け規格</legend>
      <label>
        <input
          type="checkbox"
          name="wallpaperEnabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        クロスの有効幅・リピートを設定する
      </label>
      {enabled && <WallpaperFields value={value} onChange={setValue} />}
    </fieldset>
  )
}
