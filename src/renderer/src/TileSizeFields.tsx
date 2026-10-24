import { useState } from 'react'
import { hexagonHeight, layoutTypeLabels, type LayoutBody } from '../../shared/layout'
import { DimensionInput } from './DimensionInput'
import { dimensionUnit } from '../../shared/roll-dimensions'
import type { Material } from '../../shared/materials'

export function TileSizeFields({ material }: { material: Material | null }): React.JSX.Element {
  const [layoutType, setLayoutType] = useState<LayoutBody['layoutType']>(
    material?.layoutType ?? 'tile'
  )
  const isRoll = layoutType !== 'tile'
  const [tileShape, setTileShape] = useState<Material['tileShape']>(
    material?.tileShape ?? 'rectangle'
  )
  const isHexagon = !isRoll && tileShape === 'hexagon'
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
      {!isRoll ? (
        <label>
          タイルの形状
          <select
            name="tileShape"
            aria-label="タイルの形状"
            value={tileShape}
            onChange={(e) => setTileShape(e.target.value as Material['tileShape'])}
          >
            <option value="rectangle">四角形（正方形・長方形）</option>
            <option value="hexagon">ヘキサゴン（正六角形）</option>
          </select>
        </label>
      ) : (
        <input type="hidden" name="tileShape" value="rectangle" />
      )}
      {isHexagon && (
        <div className="hexagon-standard-guide">
          <svg
            viewBox="0 0 195 160"
            role="img"
            aria-label="正六角形の寸法図。Wは平行な辺の間、Lは上下の頂点の間の寸法です。"
          >
            <polygon
              points="80,10 125,36 125,88 80,114 35,88 35,36"
              fill="#e9f3ef"
              stroke="#19675a"
              strokeWidth="2"
            />
            <path
              d="M35 123v19 M125 123v19 M35 134h90 M140 10h18 M140 114h18 M150 10v104"
              fill="none"
              stroke="currentColor"
            />
            <text x="80" y="155" textAnchor="middle">
              W
            </text>
            <text x="163" y="68">
              L
            </text>
          </svg>
          <p>
            Wは向かい合う平行な辺の間の寸法です。Lは上下の頂点間の寸法を自動計算します。目地を含まないタイル1枚の寸法を入力してください。
          </p>
        </div>
      )}
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
              : isHexagon && axis !== 'T'
                ? axis === 'W'
                  ? '対辺W（mm）'
                  : '対角L（自動・mm）'
                : `${label}（mm）`}
            {isHexagon && axis === 'L' ? (
              <>
                <output aria-label="材料の対角寸法L">
                  {dimensions.tileWidthMm === ''
                    ? '—'
                    : hexagonHeight(dimensions.tileWidthMm).toFixed(2)}
                </output>
                <input
                  type="hidden"
                  name={key}
                  value={dimensions.tileWidthMm === '' ? '' : hexagonHeight(dimensions.tileWidthMm)}
                />
              </>
            ) : isRoll ? (
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
                aria-label={
                  isHexagon && axis === 'W' ? '材料の対辺寸法W（mm）' : `材料の${label}（mm）`
                }
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
          : isHexagon
            ? '正六角形に対応しています。厚みは任意です。床の割り付けでマスタを選ぶと形状と寸法を引き継ぎます。目地幅は割り付け時に設定します。'
            : '必要な寸法を自由に入力できます。目地幅は割り付け画面で設定します。'}
      </p>
    </fieldset>
  )
}
