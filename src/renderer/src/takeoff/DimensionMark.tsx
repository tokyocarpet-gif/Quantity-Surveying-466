import { dimensionLengthMm, distance, type DimensionLine } from '../../../shared/takeoff'

export function dimensionText(line: DimensionLine, scale: number): string {
  return `${Math.round(dimensionLengthMm(line, scale)).toLocaleString('ja-JP')} mm`
}

export function DimensionMark({
  line,
  scale,
  zoom,
  select,
  draft = false
}: {
  line: DimensionLine
  scale: number
  zoom: number
  select?: () => void
  draft?: boolean
}): React.JSX.Element {
  const [a, b] = line.points
  const length = distance(a, b)
  if (length < 0.01) return <g />
  const ux = (b.x - a.x) / length,
    uy = (b.y - a.y) / length
  const nx = -uy,
    ny = ux
  const c = { x: a.x + nx * line.offset, y: a.y + ny * line.offset }
  const d = { x: b.x + nx * line.offset, y: b.y + ny * line.offset }
  const tick = 5 / zoom,
    extra = ((line.offset < 0 ? -1 : 1) * 5) / zoom
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  const x = (c.x + d.x) / 2,
    y = (c.y + d.y) / 2
  return (
    <g
      data-testid={draft ? 'dimension-draft' : 'dimension-line'}
      data-dimension-id={line.id}
      opacity={draft ? 0.65 : 1}
      pointerEvents={select ? 'auto' : 'none'}
      onPointerUp={(e) => {
        if (select && e.button === 0) {
          e.stopPropagation()
          select()
        }
      }}
      style={{ cursor: select ? 'pointer' : undefined }}
    >
      <title>{dimensionText(line, scale)}（確認用・数量には含めません）</title>
      <g fill="none" stroke="#a45325" strokeWidth={1.3} vectorEffect="non-scaling-stroke">
        <path
          d={`M${a.x},${a.y} L${c.x + nx * extra},${c.y + ny * extra} M${b.x},${b.y} L${d.x + nx * extra},${d.y + ny * extra} M${c.x},${c.y} L${d.x},${d.y}`}
          vectorEffect="non-scaling-stroke"
        />
        {[c, d].map((p, i) => (
          <line
            key={i}
            x1={p.x - (ux + nx) * tick}
            y1={p.y - (uy + ny) * tick}
            x2={p.x + (ux + nx) * tick}
            y2={p.y + (uy + ny) * tick}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      {select && (
        <line
          x1={c.x}
          y1={c.y}
          x2={d.x}
          y2={d.y}
          stroke="transparent"
          strokeWidth={16}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text
        x={x}
        y={y}
        transform={`rotate(${angle} ${x} ${y})`}
        dy={-5 / zoom}
        textAnchor="middle"
        fontSize={12 / zoom}
        fontWeight={600}
        fill="#8b431f"
        stroke="white"
        strokeWidth={4 / zoom}
        paintOrder="stroke"
      >
        {dimensionText(line, scale)}
      </text>
    </g>
  )
}
