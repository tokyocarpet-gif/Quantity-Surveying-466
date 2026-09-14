import type { LayoutWallDimension } from '../../../shared/layout-dimensions'
import { dimensionLabel, type RollDimensionType } from '../../../shared/roll-dimensions'
import type { Point } from '../../../shared/takeoff'

export const dimensionText = (value: number): string =>
  value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })

export function LayoutDimensionsOverlay({
  anchor,
  dimensions,
  scale,
  avoidPoint,
  layoutType = 'tile'
}: {
  anchor: Point
  dimensions: LayoutWallDimension[]
  scale: number
  avoidPoint?: Point
  layoutType?: RollDimensionType
}): React.JSX.Element {
  return (
    <g pointerEvents="none" data-testid="layout-wall-dimensions" fill="#9c2856" stroke="#9c2856">
      {dimensions.map((d) => {
        const dx = d.end.x - anchor.x,
          dy = d.end.y - anchor.y
        const length = Math.hypot(dx, dy)
        if (length < 1e-8) return null
        const nx = -dy / length,
          ny = dx / length,
          tick = 5 / scale
        const middle = { x: (anchor.x + d.end.x) / 2, y: (anchor.y + d.end.y) / 2 }
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle < -90) angle += 180
        // At a wall origin, put dimension text on the side away from the room's
        // sheet labels. Keep the existing placement for center-based dimensions.
        const radians = (angle * Math.PI) / 180
        const side =
          avoidPoint &&
          -(avoidPoint.x - middle.x) * Math.sin(radians) +
            (avoidPoint.y - middle.y) * Math.cos(radians) <
            0
            ? 1
            : -1
        return (
          <g key={d.key}>
            <title>
              {d.label}・壁{d.wallIndex + 1}まで{' '}
              {layoutType === 'tile'
                ? `${dimensionText(d.distanceMm)} mm`
                : dimensionLabel(d.distanceMm, layoutType)}
            </title>
            <line
              x1={anchor.x}
              y1={anchor.y}
              x2={d.end.x}
              y2={d.end.y}
              strokeWidth={1.3 / scale}
              strokeDasharray={`${5 / scale} ${3 / scale}`}
            />
            <line
              x1={d.end.x - nx * tick}
              y1={d.end.y - ny * tick}
              x2={d.end.x + nx * tick}
              y2={d.end.y + ny * tick}
              strokeWidth={1.5 / scale}
            />
            {length * scale >= 100 && (
              <text
                transform={`translate(${middle.x},${middle.y}) rotate(${angle})`}
                y={(avoidPoint ? side * 14 + 4 : -8) / scale}
                fontSize={12 / scale}
                textAnchor="middle"
                stroke="white"
                strokeWidth={4 / scale}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                壁{d.wallIndex + 1} ·{' '}
                {layoutType === 'tile'
                  ? `${dimensionText(d.distanceMm)} mm`
                  : dimensionLabel(d.distanceMm, layoutType)}
              </text>
            )}
          </g>
        )
      })}
      <text
        x={anchor.x + 16 / scale}
        y={anchor.y - 16 / scale}
        fontSize={12 / scale}
        stroke="white"
        strokeWidth={4 / scale}
        paintOrder="stroke"
      >
        基準点
      </text>
    </g>
  )
}
