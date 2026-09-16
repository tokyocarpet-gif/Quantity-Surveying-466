import type { PointerEvent } from 'react'
import { distance, type Point } from '../../../shared/takeoff'
import { axisAssistPoint } from '../../../shared/view-navigation'
import type { PdfView } from './PdfPage'
const shape = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ')
export function LayoutBoundaryDrawing({
  view,
  source,
  current,
  points,
  cursor,
  update,
  move,
  finish,
  cancel
}: {
  view: PdfView
  source: Point[]
  current: Point[]
  points: Point[]
  cursor: Point | null
  update: (points: Point[]) => void
  move: (point: Point | null) => void
  finish: (points: Point[]) => void
  cancel: () => void
}): React.JSX.Element {
  const logical = (e: PointerEvent<SVGSVGElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    const point = {
      x: Math.max(0, Math.min(view.width, ((e.clientX - rect.left) / rect.width) * view.width)),
      y: Math.max(0, Math.min(view.height, ((e.clientY - rect.top) / rect.height) * view.height))
    }
    if (points.length >= 3 && distance(point, points[0]) < 8 / view.scale) return points[0]
    return points.length ? axisAssistPoint(point, points.at(-1)!, view.scale) : point
  }
  return (
    <svg
      className="takeoff-overlay crosshair"
      data-testid="layout-boundary-overlay"
      viewBox={`0 0 ${view.width} ${view.height}`}
      tabIndex={0}
      aria-label="割り付け範囲の描画領域"
      onPointerMove={(e) => {
        if (!e.buttons) move(logical(e))
      }}
      onPointerLeave={() => move(null)}
      onPointerUp={(e) => {
        if (e.button !== 0 || e.detail > 1) return
        e.currentTarget.focus({ preventScroll: true })
        const point = logical(e)
        if (points.length >= 3 && distance(point, points[0]) < 0.01) {
          finish(points)
          return
        }
        if (points.length < 500 && (!points.length || distance(point, points.at(-1)!) >= 0.01))
          update([...points, point])
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        finish(points)
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(points)
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          update(points.slice(0, -1))
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    >
      <polygon
        points={shape(source)}
        fill="none"
        stroke="#85968f"
        strokeDasharray="6 4"
        strokeWidth={1.5 / view.scale}
        pointerEvents="none"
      />
      <polygon
        points={shape(current)}
        fill="none"
        stroke="#184f96"
        strokeWidth={1.5 / view.scale}
        pointerEvents="none"
      />
      <polyline
        points={shape(cursor ? [...points, cursor] : points)}
        fill="none"
        stroke="#b46916"
        strokeWidth={2 / view.scale}
        pointerEvents="none"
      />
      {points.map((point, i) => (
        <circle
          key={i}
          cx={point.x}
          cy={point.y}
          r={4 / view.scale}
          fill="white"
          stroke="#b46916"
          strokeWidth={1.5 / view.scale}
          pointerEvents="none"
        />
      ))}
    </svg>
  )
}
