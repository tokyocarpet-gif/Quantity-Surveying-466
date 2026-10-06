import { panelPatterns, panelAlignments, type WallPanelResult } from './wall-panels'
import type { WallBody } from './wall-layout'
const mm = (v: number) => Number(v.toFixed(3))
export function WallPanelSummary({ result: r }: { result: WallPanelResult }) {
  return (
    <div className="wall-totals" data-testid="wall-panel-totals">
      <span>
        施工面積 <b>{r.netArea.toFixed(1)}㎡</b>
      </span>
      <span>
        必要元材 <b>{r.count}枚</b>
      </span>
      <span>
        全形 {r.full}枚 ／ カット {r.cut}枚
      </span>
    </div>
  )
}
export function WallPanelSpecification({ body: b }: { body: WallBody }) {
  const p = b.panel!
  return (
    <p>
      材料 W {p.widthMm} × L {p.heightMm}
      {p.thicknessMm != null ? ` × T ${p.thicknessMm}` : ''} mm ·{' '}
      {p.rotate ? '90°回転' : '標準方向'} · {panelPatterns[p.pattern]} · 目地 {p.gapMm}mm ·{' '}
      貼り始め：{b.startSide === 'right' ? '右から' : '左から'} ·{' '}
      {p.alignment === 'edge' && b.startSide === 'right'
        ? '右下から'
        : panelAlignments[p.alignment]}{' '}
      · 横移動 {p.offsetX}mm / 縦移動 {p.offsetY}mm · 施工範囲：床から {p.bottomMm}mm / 高さ{' '}
      {p.coverageHeightMm ?? b.heightMm - p.bottomMm}mm
    </p>
  )
}
export function WallPanelSchedule({
  result: r,
  heading
}: {
  result: WallPanelResult
  heading?: string
}) {
  return (
    <>
      <p className="panel-description">
        緑は全形、橙はカット材。表の寸法は施工時の横×縦の外形です。切欠き・分割がある場合は展開図で位置を確認してください。同じ番号の部分は1枚の元材から取る計算です。端材の別位置への再利用、切断刃の幅、予備枚数は含みません。
      </p>
      <p>
        材料実面積 {r.laidArea.toFixed(1)}㎡ ／ 元材面積 {r.sourceArea.toFixed(1)}㎡ ／ 端材面積{' '}
        {r.offcutArea.toFixed(1)}㎡
      </p>
      <table className="wall-drop-table">
        <thead>
          {heading && (
            <tr>
              <th className="wall-context" colSpan={5}>
                {heading}
              </th>
            </tr>
          )}
          <tr>
            <th>番号</th>
            <th>区分</th>
            <th>外形 横 mm</th>
            <th>外形 縦 mm</th>
            <th>開口加工</th>
          </tr>
        </thead>
        <tbody>
          {r.pieces.map((p) => (
            <tr key={p.number}>
              <td>{p.number}</td>
              <td>{p.full ? '全形' : 'カット'}</td>
              <td>{mm(p.cutWidthMm)}</td>
              <td>{mm(p.cutHeightMm)}</td>
              <td>{p.notched ? 'あり（展開図参照）' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
