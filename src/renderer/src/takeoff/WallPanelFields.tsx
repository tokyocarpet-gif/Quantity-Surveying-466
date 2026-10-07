import { useWallRangeHistory } from './useWallRangeHistory'
import type { Material } from '../../../shared/materials'
import {
  defaultWallPanel,
  panelPatterns,
  panelAlignments,
  type WallPanel
} from '../../../shared/wall-panels'
import type { WallBody } from '../../../shared/wall-layout'
export function WallPanelFields({
  body,
  materials,
  historyPanels,
  edit,
  openMaster
}: {
  body: WallBody
  materials: Material[]
  historyPanels: WallPanel[]
  edit: (b: WallBody) => void
  openMaster: () => void
}) {
  const history = useWallRangeHistory(historyPanels)
  const p = body.panel ?? defaultWallPanel()
  const change = (next: Partial<WallPanel>) => edit({ ...body, panel: { ...p, ...next } })
  const field = (
    key:
      | 'widthMm'
      | 'heightMm'
      | 'thicknessMm'
      | 'gapMm'
      | 'offsetX'
      | 'offsetY'
      | 'bottomMm'
      | 'coverageHeightMm',
    label: string,
    nullable = false
  ) => (
    <label>
      {label}
      <input
        list={key === 'bottomMm' || key === 'coverageHeightMm' ? `wall-range-${key}` : undefined}
        onBlur={(e) => {
          if (key === 'bottomMm' || key === 'coverageHeightMm')
            history.remember(key, e.target.value)
        }}
        type="number"
        step="any"
        min={key.startsWith('offset') ? -100000 : 0}
        placeholder={nullable ? '未設定' : ''}
        value={p[key] ?? ''}
        onChange={(e) =>
          change({ [key]: e.target.value === '' && nullable ? null : Number(e.target.value) })
        }
      />
    </label>
  )
  return (
    <>
      <label>
        物件マスタから選ぶ
        <select
          aria-label="壁の板材・タイル材料"
          value=""
          onChange={(e) => {
            const m = materials.find((m) => m.id === e.target.value)
            if (m)
              edit({
                ...body,
                materialName: m.name,
                panel: {
                  ...p,
                  widthMm: m.tileWidthMm,
                  heightMm: m.tileHeightMm,
                  thicknessMm: m.tileThicknessMm
                }
              })
          }}
        >
          <option value="">材料を選択</option>
          {materials
            .filter((m) => m.layoutType === 'tile' && !m.wallpaper)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.tileWidthMm && m.tileHeightMm
                  ? `（${m.tileWidthMm}×${m.tileHeightMm}mm）`
                  : '（規格未設定）'}
              </option>
            ))}
        </select>
      </label>
      <button className="secondary" onClick={openMaster}>
        マスタ管理を開く
      </button>
      <label>
        材料名
        <input
          maxLength={120}
          value={body.materialName}
          onChange={(e) => edit({ ...body, materialName: e.target.value })}
        />
      </label>
      {field('widthMm', '材料のW（mm）', true)}
      {field('heightMm', '材料のL（mm）', true)}
      {field('thicknessMm', '材料のT（mm・任意）', true)}
      <button className="secondary" onClick={() => change({ rotate: !p.rotate })}>
        材料を90°回転（{p.rotate ? '回転中' : '標準方向'}）
      </button>
      {body.kind === 'tile' && (
        <>
          <label>
            貼り方
            <select
              aria-label="壁タイルの貼り方"
              value={p.pattern}
              onChange={(e) => change({ pattern: e.target.value as WallPanel['pattern'] })}
            >
              {Object.entries(panelPatterns).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {field('gapMm', '壁タイルの目地幅（mm）')}
        </>
      )}
      <h3>施工範囲</h3>
      {field('bottomMm', '施工範囲の床からの高さ（mm）')}
      {field('coverageHeightMm', '施工範囲の高さ（mm・空欄は壁上端まで）', true)}
      {(['bottomMm', 'coverageHeightMm'] as const).map((key) => (
        <datalist key={key} id={`wall-range-${key}`}>
          {history.values[key].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      ))}
      <p className="panel-description">
        入力した数値は履歴から選択できます。空欄の高さは壁上端までです。
      </p>
      <h3>割り付けの基準・微調整</h3>
      <label>
        基準
        <select
          aria-label="壁材の割り付け基準"
          value={p.alignment}
          onChange={(e) => change({ alignment: e.target.value as WallPanel['alignment'] })}
        >
          {Object.entries(panelAlignments).map(([v, l]) => (
            <option key={v} value={v}>
              {v === 'edge' && body.startSide === 'right' ? '右下から' : l}
            </option>
          ))}
        </select>
      </label>
      {field('offsetX', '壁材の横移動（mm）')}
      {field('offsetY', '壁材の縦移動（mm）')}
      <p className="panel-description">
        横は右、縦は上がプラスです。マイナスも入力できます。材料マスタの「タイル・その他」のW・L・Tを使います。
      </p>
    </>
  )
}
