import { z } from 'zod'
import { idSchema, nameSchema } from './validation'

export const categories = ['ceiling', 'wall', 'baseboard', 'floor'] as const
export type Category = (typeof categories)[number]
export const categoryLabels: Record<Category, string> = {
  ceiling: '天井',
  wall: '壁',
  baseboard: '巾木',
  floor: '床'
}
export const categoryUnits: Record<Category, '㎡' | 'm'> = {
  ceiling: '㎡',
  wall: '㎡',
  baseboard: 'm',
  floor: '㎡'
}
const positive = z.number().finite().positive().max(1e7)
export const pointSchema = z
  .object({ x: z.number().finite().min(0).max(1e7), y: z.number().finite().min(0).max(1e7) })
  .strict()
export type Point = z.infer<typeof pointSchema>
export const countUnitSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .refine(
    (unit) =>
      !['㎡', 'm', 'm²', 'm2', 'mm', '㎜', 'cm', '㎝', 'm³', 'm3', '㎥'].includes(
        unit.normalize('NFKC')
      ),
    '個数用の単位を指定してください。'
  )
export const countInputSchema = z
  .object({
    roomId: idSchema.nullable(),
    name: nameSchema,
    category: nameSchema,
    specification: z.string().trim().max(400),
    unit: countUnitSchema,
    unitPrice: z.number().finite().min(0).max(1e9).nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    points: z.array(pointSchema).min(1, '図面上に1点以上指定してください。').max(10000)
  })
  .strict()
export type CountInput = z.infer<typeof countInputSchema>
export interface CountGroup extends CountInput {
  id: string
  drawingId: string
  pageNumber: number
}
export const polygonSchema = z.array(pointSchema).min(3, '部屋は3点以上で囲んでください。').max(500)
export const finishesSchema = z
  .object({
    ceiling: z
      .object({
        name: z.string().trim().max(120),
        specification: z.string().trim().max(400).optional(),
        unitPrice: z.number().finite().min(0).max(1e9).nullable()
      })
      .strict(),
    wall: z
      .object({
        name: z.string().trim().max(120),
        unit: z.enum(['㎡', 'm']).optional(),
        specification: z.string().trim().max(400).optional(),
        unitPrice: z.number().finite().min(0).max(1e9).nullable()
      })
      .strict(),
    baseboard: z
      .object({
        name: z.string().trim().max(120),
        specification: z.string().trim().max(400).optional(),
        unitPrice: z.number().finite().min(0).max(1e9).nullable()
      })
      .strict(),
    floor: z
      .object({
        name: z.string().trim().max(120),
        specification: z.string().trim().max(400).optional(),
        unitPrice: z.number().finite().min(0).max(1e9).nullable()
      })
      .strict()
  })
  .strict()
export type Finishes = z.infer<typeof finishesSchema>
export function takeoffUnit(category: Category, finishes: Finishes): '㎡' | 'm' {
  return category === 'wall' ? (finishes.wall.unit ?? '㎡') : categoryUnits[category]
}
export function takeoffMethod(category: Category, unit: '㎡' | 'm'): TakeoffItem['method'] {
  return unit === 'm' ? 'room-perimeter' : category === 'wall' ? 'room-wall' : 'room-area'
}
export const emptyFinishes = (): Finishes =>
  Object.fromEntries(categories.map((c) => [c, { name: '', unitPrice: null }])) as Finishes
export const sleeveWallSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    points: z
      .tuple([pointSchema, pointSchema])
      .refine((p) => distance(p[0], p[1]) >= 0.01, '袖壁の2点は離れた位置を指定してください。'),
    faces: z.union([z.literal(1), z.literal(2)]),
    heightMm: positive.nullable(),
    includeBaseboard: z.boolean()
  })
  .strict()
export type SleeveWall = z.infer<typeof sleeveWallSchema>
export const roomInputSchema = z
  .object({
    name: nameSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    heightMm: positive,
    polygon: polygonSchema,
    finishes: finishesSchema,
    sleeveWalls: z
      .array(sleeveWallSchema)
      .max(500)
      .refine((w) => new Set(w.map((s) => s.id)).size === w.length, '袖壁のIDが重複しています。')
      .default([]),
    enabledCategories: z
      .array(z.enum(categories))
      .min(1, '拾う部位を1つ以上選択してください。')
      .max(4)
      .refine((v) => new Set(v).size === v.length)
      .default([...categories])
  })
  .strict()
export type RoomInput = z.infer<typeof roomInputSchema>
export interface Room extends RoomInput {
  groupId: string
  id: string
  drawingId: string
  pageNumber: number
}
export interface TakeoffItem {
  id: string
  roomId: string | null
  drawingId: string
  pageNumber: number
  category: Category
  source: 'auto-room' | 'manual'
  method: 'room-area' | 'room-wall' | 'room-perimeter' | 'manual'
  quantity: number
  unit: '㎡' | 'm'
  finish: string
  specification?: string
  unitPrice: number | null
  fixedQuantity: number | null
  calculationVersion: number
}
export const deductionInputSchema = z
  .object({
    targetItemId: idSchema,
    name: nameSchema,
    widthMm: positive,
    heightMm: positive,
    count: z.number().int().min(1).max(10000)
  })
  .strict()
export type DeductionInput = z.infer<typeof deductionInputSchema>
export interface Deduction extends DeductionInput {
  id: string
  quantity: number
  unit: '㎡' | 'm'
}
export interface PageState {
  drawingId: string
  pageNumber: number
  revision: number
  scaleRatio: number | null
  calibration: { points: [Point, Point]; lengthMm: number } | null
  rooms: Room[]
  items: TakeoffItem[]
  deductions: Deduction[]
  counts?: CountGroup[]
}
export const pageAddressSchema = z
  .object({ drawingId: idSchema, pageNumber: z.number().int().min(1).max(100000) })
  .strict()
export const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count'), id: idSchema, input: countInputSchema }).strict(),
  z.object({ kind: z.literal('deleteCount'), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal('scale'),
      points: z.tuple([pointSchema, pointSchema]),
      lengthMm: positive
    })
    .strict(),
  z
    .object({
      kind: z.literal('room'),
      id: idSchema,
      input: roomInputSchema,
      duplicateChoice: z.literal('separate').optional(),
      mergeInto: idSchema.optional()
    })
    .strict(),
  z.object({ kind: z.literal('deleteRoom'), id: idSchema }).strict(),
  z.object({ kind: z.literal('deduction'), id: idSchema, input: deductionInputSchema }).strict(),
  z.object({ kind: z.literal('deleteDeduction'), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal('fixed'),
      itemId: idSchema,
      quantity: z.number().finite().min(0).max(1e12).nullable()
    })
    .strict()
])
export type TakeoffChange = z.infer<typeof changeSchema>
export const mutationSchema = pageAddressSchema
  .extend({ expectedRevision: z.number().int().nonnegative(), change: changeSchema })
  .strict()
export type TakeoffMutation = z.infer<typeof mutationSchema>
export interface QuantityChange {
  itemId: string
  roomName: string
  category: string
  beforeUnit?: string
  unit: string
  before: number | null
  after: number | null
  fixed: boolean
}
export interface TakeoffPreview {
  before: PageState
  after: PageState
  rows: QuantityChange[]
  warnings: string[]
  mergeSummary?: {
    name: string
    rows: { category: Category; before: number; after: number; unit: string }[]
  }
}

const EPS = 1e-8
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.abs(cross(a, b, p)) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  )
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const x1 = cross(a, b, c),
    x2 = cross(a, b, d),
    x3 = cross(c, d, a),
    x4 = cross(c, d, b)
  return (
    (((x1 > EPS && x2 < -EPS) || (x1 < -EPS && x2 > EPS)) &&
      ((x3 > EPS && x4 < -EPS) || (x3 < -EPS && x4 > EPS))) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  )
}
export function geometry(input: Point[]): { area: number; perimeter: number } {
  const points = polygonSchema.parse(input)
  let doubleArea = 0,
    perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length]
    if (distance(a, b) < EPS) throw new Error('重複した頂点を取り除いてください。')
    const previous = points[(i + points.length - 1) % points.length]
    if (
      Math.abs(cross(previous, a, b)) < EPS &&
      (previous.x - a.x) * (b.x - a.x) + (previous.y - a.y) * (b.y - a.y) > EPS
    )
      throw new Error('折り返して重なる辺は使用できません。')
    doubleArea += a.x * b.y - b.x * a.y
    perimeter += distance(a, b)
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      if (intersects(a, b, points[j], points[(j + 1) % points.length]))
        throw new Error('部屋の辺が交差しています。頂点を確認してください。')
    }
  }
  const area = Math.abs(doubleArea) / 2
  if (area < EPS) throw new Error('面積のある部屋を囲んでください。')
  return { area, perimeter }
}
export function scaleFromCalibration(points: [Point, Point], lengthMm: number): number {
  positive.parse(lengthMm)
  points.forEach((p) => pointSchema.parse(p))
  const length = distance(points[0], points[1])
  if (length < 0.01) throw new Error('縮尺の2点は離れた位置を指定してください。')
  const scale = lengthMm / 1000 / length
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1e4)
    throw new Error('縮尺の実寸を確認してください。')
  return scale
}
export function roomQuantities(
  polygon: Point[],
  scale: number | null,
  heightMm: number,
  sleeveWalls: SleeveWall[] = [],
  wallUnit: '㎡' | 'm' = '㎡'
): Record<Category, number> {
  if (scale === null || !Number.isFinite(scale) || scale <= 0)
    throw new Error('このページの縮尺を設定してください。')
  positive.parse(heightMm)
  const { area, perimeter } = geometry(polygon)
  const result = {
    ceiling: area * scale * scale,
    wall: perimeter * scale * (wallUnit === 'm' ? 1 : heightMm / 1000),
    baseboard: perimeter * scale,
    floor: area * scale * scale
  }
  for (const raw of sleeveWalls) {
    const wall = sleeveWallSchema.parse(raw)
    const length = distance(...wall.points) * scale * wall.faces
    result.wall += length * (wallUnit === 'm' ? 1 : (wall.heightMm ?? heightMm) / 1000)
    if (wall.includeBaseboard) result.baseboard += length
  }
  if (Object.values(result).some((n) => !Number.isFinite(n) || n > 1e12))
    throw new Error('数量が大きすぎます。縮尺と高さを確認してください。')
  return result
}
export function deductionQuantity(input: DeductionInput, unit: '㎡' | 'm'): number {
  deductionInputSchema.parse(input)
  return (input.widthMm / 1000) * (unit === '㎡' ? input.heightMm / 1000 : 1) * input.count
}
export function netFromTotals(
  item: Pick<TakeoffItem, 'quantity' | 'fixedQuantity'>,
  deductionTotal: number
): number {
  return (item.fixedQuantity ?? item.quantity) - deductionTotal
}
export function netQuantity(item: TakeoffItem, deductions: Deduction[]): number {
  return netFromTotals(
    item,
    deductions.filter((d) => d.targetItemId === item.id).reduce((sum, d) => sum + d.quantity, 0)
  )
}
export function quantityRows(before: PageState, after: PageState): QuantityChange[] {
  const ids = [...new Set([...before.items.map((i) => i.id), ...after.items.map((i) => i.id)])]
  return ids.map((id) => {
    const old = before.items.find((i) => i.id === id),
      next = after.items.find((i) => i.id === id),
      item = next ?? old!
    return {
      itemId: id,
      roomName:
        (
          after.rooms.find((r) => r.id === item.roomId) ??
          before.rooms.find((r) => r.id === item.roomId)
        )?.name ?? '部屋未指定',
      category: item.category,
      unit: item.unit,
      ...(old && next && old.unit !== next.unit ? { beforeUnit: old.unit } : {}),
      before: old ? netQuantity(old, before.deductions) : null,
      after: next ? netQuantity(next, after.deductions) : null,
      fixed: item.fixedQuantity !== null
    }
  })
}

/** Viewport(scale=1) uses physical PDF points, including the PDF UserUnit. */
export function scaleDenominator(scaleRatio: number | null): number | null {
  return scaleRatio === null ? null : (scaleRatio * 1000 * 72) / 25.4
}
export function roomInputOf(room: Room): RoomInput {
  return {
    name: room.name,
    color: room.color,
    heightMm: room.heightMm,
    polygon: room.polygon,
    finishes: room.finishes,
    enabledCategories: room.enabledCategories,
    sleeveWalls: room.sleeveWalls
  }
}

/** Assign a visible suffix only when the caller has confirmed a separate, colliding room. */
export function numberedRoomName(name: string, occupied: string[]): string {
  const names = new Set(occupied)
  if (!names.has(name)) return name
  const base = name.replace(/（[0-9]+）$/, '') || name
  let number = 2
  for (const existing of names) {
    if (existing.startsWith(base + '（')) {
      const suffix = existing.slice(base.length).match(/^（([0-9]+)）$/)
      if (suffix && Number.isSafeInteger(Number(suffix[1])) && Number(suffix[1]) < 1e9)
        number = Math.max(number, Number(suffix[1]) + 1)
    }
  }
  while (true) {
    const suffix = `（${number}）`
    const chars = Array.from(base)
    while (chars.join('').length + suffix.length > 120) chars.pop()
    const candidate = chars.join('') + suffix
    if (!names.has(candidate)) return candidate
    number++
  }
}
