import type { Point } from './takeoff'
export const clampZoom = (zoom: number): number => Math.max(0.2, Math.min(8, zoom))
/** Keep the same PDF point under the cursor as the displayed scale changes. */
export function zoomOffset(offset: Point, anchor: Point, ratio: number): Point {
  return {
    x: anchor.x - (anchor.x - offset.x) * ratio,
    y: anchor.y - (anchor.y - offset.y) * ratio
  }
}
/** Assist near an axis without constraining diagonal drawing; tolerance is in screen pixels. */
export function axisAssistPoint(point: Point, origin: Point, scale: number): Point {
  const dx = Math.abs(point.x - origin.x),
    dy = Math.abs(point.y - origin.y)
  const tolerance = 8 / scale
  const slope = Math.tan((5 * Math.PI) / 180)
  if (dy <= tolerance && dy <= dx * slope) return { x: point.x, y: origin.y }
  if (dx <= tolerance && dx <= dy * slope) return { x: origin.x, y: point.y }
  return point
}
