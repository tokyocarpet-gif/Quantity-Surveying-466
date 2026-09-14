import type { Point } from './takeoff'
import { rotate } from './layout'

const epsilon = 1e-6 // millimetres
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
function covered(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length]
    const edge = { x: b.x - a.x, y: b.y - a.y }
    const relative = { x: point.x - a.x, y: point.y - a.y }
    const length = Math.hypot(edge.x, edge.y)
    if (
      length &&
      Math.abs(cross(edge, relative)) <= epsilon * length &&
      dot(relative, edge) >= -epsilon * length &&
      dot(relative, edge) <= length * length + epsilon * length
    )
      return true
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y)
    )
      inside = !inside
  }
  return inside
}
export interface LayoutWallDimension {
  key: string
  label: string
  wallIndex: number
  distanceMm: number
  end: Point
}

/** First actual room boundary along each layout axis, measured from its movable anchor. */
export function layoutWallDimensions(
  polygon: Point[],
  anchor: Point,
  angle: number,
  scale: number
): {
  inside: boolean
  dimensions: LayoutWallDimension[]
} {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(angle))
    throw new Error('寸法の縮尺・角度を確認してください。')
  const factor = scale * 1000
  const local = polygon.map((p) =>
    rotate({ x: (p.x - anchor.x) * factor, y: (p.y - anchor.y) * factor }, -angle)
  )
  if (!covered({ x: 0, y: 0 }, local)) return { inside: false, dimensions: [] }
  const dimensions: LayoutWallDimension[] = []
  for (const [key, label, dx, dy] of [
    ['x-minus', '横−', -1, 0],
    ['x-plus', '横＋', 1, 0],
    ['y-minus', '縦−', 0, -1],
    ['y-plus', '縦＋', 0, 1]
  ] as const) {
    const direction = { x: dx, y: dy }
    const hits: { distanceMm: number; wallIndex: number; alignment: number }[] = []
    const add = (value: number, wallIndex: number, alignment = 0): void => {
      if (value >= -epsilon) hits.push({ distanceMm: Math.max(0, value), wallIndex, alignment })
    }
    for (let i = 0; i < local.length; i++) {
      const a = local[i],
        b = local[(i + 1) % local.length]
      const acrossA = cross(direction, a),
        acrossB = cross(direction, b)
      if (Math.abs(acrossA - acrossB) <= epsilon) {
        if (Math.abs(acrossA) <= epsilon) {
          const alongA = dot(direction, a),
            alongB = dot(direction, b)
          add(alongA, i)
          add(alongB, i)
          if (Math.min(alongA, alongB) <= 0 && Math.max(alongA, alongB) >= 0) add(0, i)
        }
      } else {
        const t = -acrossA / (acrossB - acrossA)
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        if (t >= -epsilon / length && t <= 1 + epsilon / length)
          add(
            dot(direction, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }),
            i,
            Math.abs(acrossB - acrossA) / length
          )
      }
    }
    // At a shared corner, label the wall across the dimension rather than the wall along it.
    hits.sort((a, b) =>
      Math.abs(a.distanceMm - b.distanceMm) > epsilon
        ? a.distanceMm - b.distanceMm
        : b.alignment - a.alignment || a.wallIndex - b.wallIndex
    )
    let hit = hits[0]
    if (!hit) continue
    if (hit.distanceMm <= epsilon) {
      const next = hits.find((h) => h.distanceMm > epsilon)
      // On a wall, measure into the room; outward directions remain zero.
      if (next) {
        const step = Math.min(0.01, next.distanceMm / 2)
        if (covered({ x: dx * step, y: dy * step }, local)) hit = next
      }
    }
    const delta = rotate({ x: dx * hit.distanceMm, y: dy * hit.distanceMm }, angle)
    dimensions.push({
      key,
      label,
      wallIndex: hit.wallIndex,
      distanceMm: hit.distanceMm,
      end: { x: anchor.x + delta.x / factor, y: anchor.y + delta.y / factor }
    })
  }
  return { inside: true, dimensions }
}
