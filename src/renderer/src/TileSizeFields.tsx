import { useState } from 'react'
import { layoutTypeLabels, type LayoutBody } from '../../shared/layout'
import { DimensionInput } from './DimensionInput'
import { dimensionUnit } from '../../shared/roll-dimensions'
import type { Material } from '../../shared/materials'

export function TileSizeFields({ material }: { material: Material | null }): React.JSX.Element {
  const [layoutType, setLayoutType] = useState<LayoutBody['layoutType']>(
    material?.layoutType ?? 'tile'
  )
  const isRoll = layoutType !== 'tile'
  const [dimensions, setDimensions] = useState<
    Record<'tileWidthMm' | 'tileHeightMm' | 'tileThicknessMm', number | ''>
  >({
    tileWidthMm: material?.tileWidthMm ?? '',
    tileHeightMm: material?.tileHeightMm ?? '',
    tileThicknessMm: material?.tileThicknessMm ?? ''
  })
  return (
    <fieldset className="tile-size-fields">
      <legend>{isRoll ? '規格（W・L・T）' : '規格（mm）'}</legend>
      <label>
        材料の種類
        <select
          name="layoutType"
          aria-label="材料の種類"
          value={layoutType}
          onChange={(e) => setLayoutType(e.target.value as LayoutBody['layoutType'])}
        >
          {Object.entries(layoutTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="tile-dimensions">
        {(
          [
            ['tileWidthMm', '幅', 'W'],
            ['tileHeightMm', '長さ', 'L'],
            ['tileThicknessMm', '厚み', 'T']
          ] as const
        ).map(([key, label, axis]) => (
          <label key={key}>
            {isRoll
              ? `${axis}（${axis === 'T' ? label : `最大出荷${label}`}・${dimensionUnit(layoutType, axis)}）`
              : `${label}（mm）`}
            {isRoll ? (
              <DimensionInput
                key={`${layoutType}-${key}`}
                name={key}
                value={dimensions[key]}
                type={layoutType}
                axis={axis}
                label={`材料の${axis}（${dimensionUnit(layoutType, axis)}）`}
                min={0.001}
                max={key === 'tileHeightMm' ? 1000000 : 10000}
                onChange={(value) => setDimensions((old) => ({ ...old, [key]: value }))}
              />
            ) : (
              <input
                name={key}
                aria-label={`材料の${label}（mm）`}
                type="number"
                min="0.001"
                max={isRoll && key === 'tileHeightMm' ? 1000000 : 10000}
                step="any"
                placeholder="任意"
                value={dimensions[key]}
                onChange={(e) =>
                  setDimensions((old) => ({
                    ...old,
                    [key]: e.target.value === '' ? '' : Number(e.target.value)
                  }))
                }
              />
            )}
          </label>
        ))}
      </div>
      <p>
        {isRoll
          ? 'Wは最大出荷幅、Lは最大出荷長さ、Tは厚みです。Lは任意です。クリックすると登録値の桁数で編集できます。'
          : '必要な寸法を自由に入力できます。目地幅は割り付け画面で設定します。'}
      </p>
    </fieldset>
  )
}
