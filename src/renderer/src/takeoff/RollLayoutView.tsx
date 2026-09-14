import { rollMaterialRows, type computeLayout } from '../../../shared/layout'
import type { Point } from '../../../shared/takeoff'
import {
  dimensionLabel,
  dimensionNumber,
  dimensionUnit,
  type RollDimensionType
} from '../../../shared/roll-dimensions'
type Roll = NonNullable<ReturnType<typeof computeLayout>['roll']>

function MeasuredLine({
  from,
  to,
  text,
  scale
}: {
  from: Point
  to: Point
  text: string
  scale: number
}): React.JSX.Element {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy)
  const nx = -dy / length,
    ny = dx / length,
    tick = 4 / scale
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angle >= 90) angle -= 180
  if (angle < -90) angle += 180
  return (
    <g strokeWidth={1 / scale}>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {[from, to].map((point, i) => (
        <line
          key={i}
          x1={point.x - nx * tick}
          y1={point.y - ny * tick}
          x2={point.x + nx * tick}
          y2={point.y + ny * tick}
        />
      ))}
      <text
        transform={`translate(${(from.x + to.x) / 2},${(from.y + to.y) / 2}) rotate(${angle})`}
        y={-7 / scale}
        textAnchor="middle"
        fontSize={11 / scale}
        fill="#24596b"
        stroke="white"
        strokeWidth={3 / scale}
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  )
}
export function RollOverlay({
  strips,
  scale,
  layoutType,
  showDimensions
}: {
  strips: Roll['strips']
  scale: number
  layoutType: RollDimensionType
  showDimensions: boolean
}): React.JSX.Element {
  return (
    <g pointerEvents="none" data-testid="roll-overlay" stroke="#24596b" fill="none">
      {strips.map((s) => {
        const dx = s.to.x - s.from.x,
          dy = s.to.y - s.from.y,
          length = Math.hypot(dx, dy)
        const ux = dx / length,
          uy = dy / length,
          width = (length * s.widthMm) / s.lengthMm
        const widthPosition = width * scale < 64 ? (s.number % 2 ? 0.12 : 0.22) : 0.25
        const widthCenter = { x: s.from.x + dx * widthPosition, y: s.from.y + dy * widthPosition }
        const badge = showDimensions
          ? { x: s.from.x + dx * 0.84, y: s.from.y + dy * 0.84 }
          : s.center
        return (
          <g key={s.number} strokeWidth={1.5 / scale}>
            <title>
              シート{s.number}・W {dimensionLabel(s.widthMm, layoutType, 'W')}・L{' '}
              {dimensionLabel(s.lengthMm, layoutType)}
            </title>
            {showDimensions && (
              <g data-testid="roll-sheet-dimensions" data-sheet-number={s.number}>
                <MeasuredLine
                  from={s.from}
                  to={s.to}
                  text={`L ${dimensionLabel(s.lengthMm, layoutType)}`}
                  scale={scale}
                />
                <MeasuredLine
                  from={{
                    x: widthCenter.x - (uy * width) / 2,
                    y: widthCenter.y + (ux * width) / 2
                  }}
                  to={{ x: widthCenter.x + (uy * width) / 2, y: widthCenter.y - (ux * width) / 2 }}
                  text={`W ${dimensionLabel(s.widthMm, layoutType, 'W')}`}
                  scale={scale}
                />
              </g>
            )}
            <circle cx={badge.x} cy={badge.y} r={11 / scale} fill="white" />
            <text
              x={badge.x}
              y={badge.y}
              dominantBaseline="central"
              textAnchor="middle"
              fontSize={11 / scale}
              fill="#24596b"
              stroke="none"
            >
              {s.number}
            </text>
          </g>
        )
      })}
    </g>
  )
}
export function RollResults({
  roll,
  widthMm,
  trimMm,
  stockMm,
  layoutType
}: {
  roll: Roll
  widthMm: number
  trimMm: number
  stockMm: number | null
  layoutType: RollDimensionType
}): React.JSX.Element {
  const sizes = rollMaterialRows(roll.strips)
  return (
    <>
      <span>シート {roll.strips.length} 枚</span>
      <strong data-testid="roll-total-length">
        使用L合計 {dimensionLabel(roll.lengthM * 1000, layoutType)}
      </strong>
      <strong data-testid="roll-total-area">
        使用材料面積 {roll.requiredArea.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} ㎡
      </strong>
      <span data-testid="roll-count">
        最大出荷 W {dimensionLabel(roll.maxWidthMm, layoutType, 'W')} / L{' '}
        {stockMm === null ? '未設定' : dimensionLabel(stockMm, layoutType)}
      </span>
      <span>{roll.freeCut ? 'フリーカット' : '幅なり出荷'}</span>
      <div
        className="roll-size-summary"
        data-testid="roll-size-summary"
        aria-label="切出し寸法ごとの枚数"
      >
        <span>使用材料（W × L × 枚数）</span>
        {sizes.map((row) => (
          <span key={`${row.widthMm}:${row.lengthMm}`}>
            W {dimensionLabel(row.widthMm, layoutType, 'W')} × L{' '}
            {dimensionLabel(row.lengthMm, layoutType)} × {row.sheets.length}枚 ={' '}
            {row.area.toLocaleString('ja-JP', {
              maximumFractionDigits: 1,
              minimumFractionDigits: 1
            })}{' '}
            ㎡
          </span>
        ))}
      </div>
      {roll.packing && (
        <p data-testid="roll-order-comparison">
          最大出荷L内の組合せ（参考）：番号順 {roll.regularCount}本 → 調整後 {roll.efficientCount}本
          {roll.reorderCuts
            ? roll.efficientCount! < roll.regularCount!
              ? '（調整を適用中）'
              : '（巻数は同じため番号順を維持）'
            : '（現在は番号順）'}
          {' · '}最大Lまでの余裕合計{' '}
          {dimensionLabel(
            roll.packing.rolls.reduce((sum, r) => sum + r.remainingMm, 0),
            layoutType
          )}
        </p>
      )}
      {roll.overLength && (
        <p className="form-error" role="alert">
          最大出荷Lを超えるシートがあります。最大出荷Lや敷く方向を見直してください。継ぎ足しは自動で配置しません。
        </p>
      )}
      <details className="roll-cut-list">
        <summary>
          使用材料の内訳（最大W {dimensionLabel(roll.maxWidthMm, layoutType, 'W')}・切りしろ両端各{' '}
          {trimMm} mm）
        </summary>
        <p>
          敷設寸法はシートごとの最大幅・最大長です。使用Lは両端の切りしろを含みます。使用Wはフリーカットなら実測幅をmm単位で切り上げ、幅なり出荷なら最大出荷Wです。
        </p>
        {roll.packing && (
          <div className="roll-stock-remaining" data-testid="roll-stock-remaining">
            {roll.packing.rolls.map((r) => (
              <span key={r.number}>
                {r.number}本目の組合せ：{r.sheets.length}枚（シート {r.sheets.join('・')}）／ 使用{' '}
                {dimensionLabel(r.usedMm, layoutType)} ／ 残り{' '}
                {dimensionLabel(r.remainingMm, layoutType)}
              </span>
            ))}
          </div>
        )}
        <div className="roll-cut-scroll">
          <table aria-label="シートの切り出し一覧">
            <thead>
              <tr>
                <th>切出し順</th>
                <th>シート</th>
                <th>実測W（{dimensionUnit(layoutType)}）</th>
                <th>実測L（{dimensionUnit(layoutType)}）</th>
                <th>使用W（{dimensionUnit(layoutType)}）</th>
                <th>使用L（{dimensionUnit(layoutType)}）</th>
                <th>使用面積（㎡）</th>
                <th>割当巻</th>
                <th>確認</th>
              </tr>
            </thead>
            <tbody>
              {[...roll.strips]
                .sort((a, b) => a.cutOrder - b.cutOrder)
                .map((s) => (
                  <tr key={s.number}>
                    <td>{s.cutOrder}</td>
                    <th>{s.number}</th>
                    <td>{dimensionNumber(s.widthMm, layoutType, 'W')}</td>
                    <td>{dimensionNumber(s.lengthMm, layoutType)}</td>
                    <td>{dimensionNumber(s.cutWidthMm, layoutType, 'W')}</td>
                    <td>{dimensionNumber(s.cutLengthMm, layoutType)}</td>
                    <td>{((s.cutWidthMm * s.cutLengthMm) / 1e6).toFixed(1)}</td>
                    <td>{s.rollNumber === null ? '—' : `${s.rollNumber}本目`}</td>
                    <td>{s.overLength ? '最大出荷L超過' : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
