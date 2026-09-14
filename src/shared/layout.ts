import { planRollCuts } from './roll-cut-order'
import { z } from 'zod'
import { idSchema } from './validation'
import { geometry, type Point } from './takeoff'

export const layoutTypeSchema = z.enum(['tile', 'sheet', 'carpet'])
export const layoutTypeLabels = {
  tile: 'タイル・その他',
  sheet: '長尺シート',
  carpet: 'ロールカーペット'
}
export const tileDimensions = {
  layoutType: layoutTypeSchema.default('tile'),
  tileWidthMm: z.number().finite().min(0.001).max(10000).nullable().default(null),
  tileHeightMm: z.number().finite().min(0.001).max(1000000).nullable().default(null),
  tileThicknessMm: z.number().finite().min(0.001).max(10000).nullable().default(null),
  // Legacy master gap is retained for backup compatibility; layout gap is set per room.
  tileGapMm: z.number().finite().min(0).max(100).default(0)
}
export const layoutBodySchema = z
  .object({
    rollCutMode: z.enum(['width', 'free']).default('width'),
    maxWidthMm: z.number().finite().min(10).max(10000).nullable().default(null),
    layoutType: layoutTypeSchema.default('tile'),
    reorderCuts: z.boolean().default(false),
    trimMm: z.number().finite().min(0).max(1000).default(0),
    materialId: idSchema.nullable(),
    materialName: z.string().trim().max(120),
    specification: z.string().trim().max(400),
    widthMm: z.number().finite().min(10).max(10000),
    heightMm: z.number().finite().min(10).max(1000000).nullable(),
    gapMm: z.number().finite().min(0).max(100),
    mode: z.enum(['center', 'wall']),
    axisX: z.enum(['joint', 'tile']),
    axisY: z.enum(['joint', 'tile']),
    wallIndex: z.number().int().min(0).max(499),
    angle: z.number().finite().min(-180).max(180),
    offsetX: z.number().finite().min(-1e7).max(1e7),
    offsetY: z.number().finite().min(-1e7).max(1e7)
  })
  .strict()
  .refine(
    (b) => b.layoutType === 'tile' || b.maxWidthMm === null || b.widthMm <= b.maxWidthMm,
    '割付Wは最大出荷W以下で入力してください。'
  )
  .refine(
    (b) => b.layoutType !== 'tile' || (b.heightMm !== null && b.heightMm <= 10000),
    'タイルの長さは10〜10,000mmで入力してください。'
  )
  .refine(
    (b) => b.layoutType === 'tile' || b.gapMm === 0,
    'ロール材の目地幅は0で設定してください。'
  )
export type LayoutBody = z.infer<typeof layoutBodySchema>
export interface LayoutDoc {
  roomId: string
  revision: number
  sourceKey: string
  body: LayoutBody
}
export const layoutSaveSchema = z
  .object({
    roomId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    sourceKey: z.string().max(60000),
    body: layoutBodySchema
  })
  .strict()
export type LayoutSave = z.infer<typeof layoutSaveSchema>
export const defaultLayout = (): LayoutBody => ({
  rollCutMode: 'width',
  maxWidthMm: null,
  reorderCuts: false,
  layoutType: 'tile',
  trimMm: 0,
  materialId: null,
  materialName: '',
  specification: '',
  widthMm: 500,
  heightMm: 500,
  gapMm: 0,
  mode: 'center',
  axisX: 'joint',
  axisY: 'joint',
  wallIndex: 0,
  angle: 0,
  offsetX: 0,
  offsetY: 0
})
export const layoutSourceKey = (polygon: Point[], scale: number): string =>
  JSON.stringify({ polygon, scale })
export function rollMaterialRows(
  strips: { number: number; cutWidthMm: number; cutLengthMm: number }[]
) {
  const rows = new Map<
    string,
    { widthMm: number; lengthMm: number; sheets: number[]; area: number }
  >()
  for (const s of strips) {
    const key = `${s.cutWidthMm}:${s.cutLengthMm}`
    const row = rows.get(key) ?? {
      widthMm: s.cutWidthMm,
      lengthMm: s.cutLengthMm,
      sheets: [],
      area: 0
    }
    row.sheets.push(s.number)
    row.area += (s.cutWidthMm * s.cutLengthMm) / 1e6
    rows.set(key, row)
  }
  return [...rows.values()]
}
export const rotate = (p: Point, angle: number): Point => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle)
})
const area = (p: Point[]): number => Math.abs(signedArea(p))
const signedArea = (p: Point[]): number =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length]
    const origin = p[0]
    return s + (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y)
  }, 0) / 2
// Clip a simple room polygon against a convex tile; signed boundary paths also
// preserve the total area when a concave room intersects the tile in separate parts.
function clipRect(polygon: Point[], x: number, y: number, w: number, h: number): Point[] {
  let p = polygon
  for (const [axis, boundary, sign] of [
    ['x', x, 1],
    ['x', x + w, -1],
    ['y', y, 1],
    ['y', y + h, -1]
  ] as const) {
    const out: Point[] = []
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length]
      const da = sign * (a[axis] - boundary),
        db = sign * (b[axis] - boundary)
      if (da >= 0) out.push(a)
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db)
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
      }
    }
    p = out
  }
  return p
}
export function computeLayout(polygon: Point[], scale: number, raw: LayoutBody) {
  const b = layoutBodySchema.parse(raw)
  geometry(polygon)
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('縮尺を設定してください。')
  if (b.mode === 'wall' && b.wallIndex >= polygon.length)
    throw new Error('基準の壁を選び直してください。')
  const mm = polygon.map((p) => ({ x: p.x * scale * 1000, y: p.y * scale * 1000 }))
  let origin = mm[0],
    angle = (b.angle * Math.PI) / 180
  if (b.mode === 'wall') {
    let a = mm[b.wallIndex],
      c = mm[(b.wallIndex + 1) % mm.length]
    if (signedArea(mm) < 0) [a, c] = [c, a]
    origin = a
    angle += Math.atan2(c.y - a.y, c.x - a.x)
  }
  const local = mm.map((p) => rotate({ x: p.x - origin.x, y: p.y - origin.y }, -angle))
  const minX = Math.min(...local.map((p) => p.x)),
    maxX = Math.max(...local.map((p) => p.x))
  const minY = Math.min(...local.map((p) => p.y)),
    maxY = Math.max(...local.map((p) => p.y))
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  const height = b.heightMm ?? 0
  const pitchX = b.widthMm + b.gapMm,
    pitchY = height + b.gapMm
  const anchor = b.mode === 'wall' ? { x: 0, y: 0 } : center
  const startX =
    anchor.x +
    (b.mode === 'wall' ? 0 : b.axisX === 'joint' ? b.gapMm / 2 : -b.widthMm / 2) +
    b.offsetX
  const startY =
    anchor.y + (b.mode === 'wall' ? 0 : b.axisY === 'joint' ? b.gapMm / 2 : -height / 2) + b.offsetY
  const toPage = (p: Point): Point => {
    const r = rotate(p, angle)
    return { x: (r.x + origin.x) / (scale * 1000), y: (r.y + origin.y) / (scale * 1000) }
  }
  const pageAnchor = toPage({ x: anchor.x + b.offsetX, y: anchor.y + b.offsetY })
  if (b.layoutType !== 'tile') return computeRoll(local, startX, b, toPage, angle, pageAnchor)
  const left = Math.floor((minX - startX) / pitchX),
    right = Math.ceil((maxX - startX) / pitchX)
  const top = Math.floor((minY - startY) / pitchY),
    bottom = Math.ceil((maxY - startY) / pitchY)
  if ((right - left + 1) * (bottom - top + 1) > 20000)
    throw new Error('割り付けが2万枚を超えます。材料寸法・縮尺を確認するか、部屋を分けてください。')
  const tiles: { polygon: Point[]; full: boolean; areaMm2: number }[] = []
  let full = 0,
    cut = 0,
    laidArea = 0
  for (let r = top; r <= bottom; r++)
    for (let c = left; c <= right; c++) {
      const x = startX + c * pitchX,
        y = startY + r * pitchY
      const clipped = clipRect(local, x, y, b.widthMm, height)
      const amount = area(clipped),
        tileArea = b.widthMm * height
      if (amount < Math.max(0.001, tileArea * 1e-9)) continue
      const whole = Math.abs(amount - tileArea) <= Math.max(0.01, tileArea * 1e-7)
      if (whole) full++
      else cut++
      laidArea += amount
      tiles.push({
        polygon: [
          { x, y },
          { x: x + b.widthMm, y },
          { x: x + b.widthMm, y: y + height },
          { x, y: y + height }
        ].map(toPage),
        full: whole,
        areaMm2: amount
      })
    }
  return {
    roll: null,
    tiles,
    full,
    cut,
    roomArea: area(local) / 1e6,
    laidArea: laidArea / 1e6,
    angle,
    anchor: toPage({ x: anchor.x + b.offsetX, y: anchor.y + b.offsetY })
  }
}

// Use boundary segments that enter the open strip. Polygon clipping can retain
// zero-area paths along a strip edge, which must not extend the cutting length.
function stripExtent(polygon: Point[], left: number, right: number) {
  const ys: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length]
    const low = Math.min(a.x, b.x),
      high = Math.max(a.x, b.x)
    if (high <= left + 1e-7 || low >= right - 1e-7) continue
    if (Math.abs(b.x - a.x) < 1e-7) {
      ys.push(a.y, b.y)
      continue
    }
    const t1 = (left - a.x) / (b.x - a.x),
      t2 = (right - a.x) / (b.x - a.x)
    const from = Math.max(0, Math.min(t1, t2)),
      to = Math.min(1, Math.max(t1, t2))
    ys.push(a.y + from * (b.y - a.y), a.y + to * (b.y - a.y))
  }
  return { fromY: Math.min(...ys), toY: Math.max(...ys) }
}

function computeRoll(
  local: Point[],
  startX: number,
  b: LayoutBody,
  toPage: (p: Point) => Point,
  angle: number,
  anchor: Point
) {
  const minX = Math.min(...local.map((p) => p.x)),
    maxX = Math.max(...local.map((p) => p.x))
  const minY = Math.min(...local.map((p) => p.y)),
    maxY = Math.max(...local.map((p) => p.y))
  const left = Math.floor((minX - startX) / b.widthMm),
    right = Math.ceil((maxX - startX) / b.widthMm)
  if (right - left > 2000)
    throw new Error('シートが2,000枚を超えます。ロール幅・縮尺を確認してください。')
  const strips: {
    number: number
    widthMm: number
    lengthMm: number
    cutLengthMm: number
    cutWidthMm: number
    rollNumber: number | null
    cutOrder: number
    overLength: boolean
    center: Point
    from: Point
    to: Point
  }[] = []
  const tiles: { polygon: Point[]; full: boolean; areaMm2: number }[] = []
  for (let c = left; c < right; c++) {
    const x = startX + c * b.widthMm
    const clipped = clipRect(local, x, minY, b.widthMm, maxY - minY)
    const amount = area(clipped)
    if (amount <= Math.max(0.001, area(local) * 1e-12)) continue
    const { fromY, toY } = stripExtent(local, x, x + b.widthMm)
    const lengthMm = toY - fromY
    // Whole-millimetre cutting lengths never round the required material down.
    const cutLengthMm = Math.ceil(lengthMm + b.trimMm * 2 - 1e-7)
    const overLength = b.heightMm !== null && cutLengthMm > b.heightMm + 1e-7
    const visibleX =
      (Math.min(...clipped.map((p) => p.x)) + Math.max(...clipped.map((p) => p.x))) / 2
    const actualWidth = Math.max(...clipped.map((p) => p.x)) - Math.min(...clipped.map((p) => p.x))
    const free = b.layoutType === 'carpet' && b.rollCutMode === 'free'
    strips.push({
      number: strips.length + 1,
      widthMm: actualWidth,
      cutWidthMm: free ? Math.ceil(actualWidth - 1e-7) : (b.maxWidthMm ?? b.widthMm),
      lengthMm,
      cutLengthMm,
      overLength,
      rollNumber: null,
      cutOrder: strips.length + 1,
      center: toPage({ x: visibleX, y: (fromY + toY) / 2 }),
      from: toPage({ x: visibleX, y: fromY }),
      to: toPage({ x: visibleX, y: toY })
    })
    tiles.push({
      polygon: [
        { x, y: fromY },
        { x: x + b.widthMm, y: fromY },
        { x: x + b.widthMm, y: toY },
        { x, y: toY }
      ].map(toPage),
      full: false,
      areaMm2: amount
    })
  }
  const lengthMm = strips.reduce((sum, s) => sum + s.cutLengthMm, 0)
  const overLength = strips.some((s) => s.overLength)
  const freeCut = b.layoutType === 'carpet' && b.rollCutMode === 'free'
  const plans = freeCut
    ? null
    : planRollCuts(
        strips.map((s) => s.cutLengthMm),
        b.heightMm
      )
  const packing = plans ? (b.reorderCuts ? plans.efficient : plans.regular) : null
  if (packing) strips.forEach((s, i) => Object.assign(s, packing.assignments[i]))
  return {
    tiles,
    full: 0,
    cut: strips.length,
    roomArea: area(local) / 1e6,
    laidArea: area(local) / 1e6,
    angle,
    anchor,
    roll: {
      strips,
      lengthM: lengthMm / 1000,
      requiredArea: strips.reduce((sum, s) => sum + s.cutWidthMm * s.cutLengthMm, 0) / 1e6,
      freeCut,
      maxWidthMm: b.maxWidthMm ?? b.widthMm,
      rollCount: packing?.rolls.length ?? null,
      packing,
      regularCount: plans?.regular.rolls.length ?? null,
      efficientCount: plans?.efficient.rolls.length ?? null,
      reorderCuts: b.reorderCuts,
      overLength
    }
  }
}
