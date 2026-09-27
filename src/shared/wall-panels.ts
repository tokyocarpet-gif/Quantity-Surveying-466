import { z } from 'zod'
import type { WallBody } from './wall-layout'
import { distance } from './takeoff'
const dim = z.number().finite().positive().max(10000).nullable()
export const wallPanelSchema = z
  .object({
    widthMm: dim,
    heightMm: dim,
    thicknessMm: dim,
    gapMm: z.number().finite().min(0).max(100),
    pattern: z.enum(['straight', 'half', 'third', 'quarter']),
    rotate: z.boolean(),
    alignment: z.enum(['edge', 'joint', 'tile']),
    offsetX: z.number().finite().min(-100000).max(100000),
    offsetY: z.number().finite().min(-100000).max(100000),
    bottomMm: z.number().finite().min(0).max(100000),
    coverageHeightMm: z.number().finite().positive().max(100000).nullable()
  })
  .strict()
export type WallPanel = z.infer<typeof wallPanelSchema>
export const wallKinds = {
  wallpaper: 'クロス',
  tile: '壁タイル',
  protection: 'プラベニア・板材養生'
}
export const panelPatterns = {
  straight: '通し貼り',
  half: '馬貼り（1/2）',
  third: '1/3ずらし',
  quarter: '1/4ずらし'
}
export const panelAlignments = { edge: '左下から', joint: '中心を目地に', tile: '中心を材料に' }
export function defaultWallPanel(): WallPanel {
  return {
    widthMm: null,
    heightMm: null,
    thicknessMm: null,
    gapMm: 0,
    pattern: 'straight',
    rotate: false,
    alignment: 'edge',
    offsetX: 0,
    offsetY: 0,
    bottomMm: 0,
    coverageHeightMm: null
  }
}
export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
}
export interface WallPanelPiece {
  number: number
  row: number
  column: number
  full: boolean
  notched: boolean
  rect: PanelRect
  parts: PanelRect[]
  cutWidthMm: number
  cutHeightMm: number
  areaMm2: number
}
function intersection(a: PanelRect, b: PanelRect): PanelRect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    w = Math.min(a.x + a.w, b.x + b.w) - x,
    h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 1e-7 && h > 1e-7 ? { x, y, w, h } : null
}
/** Rectangular subtraction keeps disjoint pieces belonging to ONE source board. */
function subtract(a: PanelRect, b: PanelRect): PanelRect[] {
  const i = intersection(a, b)
  if (!i) return [a]
  return [
    { x: a.x, y: a.y, w: a.w, h: i.y - a.y },
    { x: a.x, y: i.y + i.h, w: a.w, h: a.y + a.h - i.y - i.h },
    { x: a.x, y: i.y, w: i.x - a.x, h: i.h },
    { x: i.x + i.w, y: i.y, w: a.x + a.w - i.x - i.w, h: i.h }
  ].filter((r) => r.w > 1e-7 && r.h > 1e-7)
}
export function computeWallPanels(b: WallBody) {
  const p = b.panel!
  if (!p?.widthMm || !p.heightMm)
    throw new Error('材料のW・Lを入力するか、規格のあるマスタを選んでください。')
  const widthMm = distance(...b.points) * b.scale * 1000,
    height = p.coverageHeightMm ?? b.heightMm - p.bottomMm
  const w = p.rotate ? p.heightMm : p.widthMm,
    h = p.rotate ? p.widthMm : p.heightMm
  const gap = b.kind === 'protection' ? 0 : p.gapMm,
    px = w + gap,
    py = h + gap
  const target = { x: 0, y: p.bottomMm, w: widthMm, h: height }
  if (height <= 0 || target.y + height > b.heightMm + 1e-7)
    throw new Error('施工範囲を壁の高さ内に設定してください。')
  const originX =
    (p.alignment === 'edge' ? 0 : widthMm / 2 - (p.alignment === 'tile' ? w / 2 : -gap / 2)) +
    p.offsetX
  const originY =
    target.y +
    (p.alignment === 'edge' ? 0 : height / 2 - (p.alignment === 'tile' ? h / 2 : -gap / 2)) +
    p.offsetY
  const ratio =
    b.kind === 'protection' ? 0 : { straight: 0, half: 0.5, third: 1 / 3, quarter: 0.25 }[p.pattern]
  const fromY = Math.floor((target.y - originY - h) / py) + 1,
    toY = Math.ceil((target.y + height - originY) / py) - 1
  const columns = Math.ceil(widthMm / px) + 2
  if ((toY - fromY + 1) * columns > 20000)
    throw new Error('割り付けが2万枚を超えます。材料寸法と縮尺を確認してください。')
  const openings = b.openings.map((o) => ({ x: o.xMm, y: o.bottomMm, w: o.widthMm, h: o.heightMm }))
  const pieces: WallPanelPiece[] = []
  let laid = 0
  for (let row = fromY; row <= toY; row++) {
    const ox = originX + row * ratio * px,
      y = originY + row * py
    const fromX = Math.floor((-ox - w) / px) + 1,
      toX = Math.ceil((widthMm - ox) / px) - 1
    for (let col = fromX; col <= toX; col++) {
      const rect = { x: ox + col * px, y, w, h },
        clip = intersection(rect, target)
      if (!clip) continue
      let parts = [clip],
        notched = false
      for (const opening of openings) {
        if (intersection(clip, opening)) notched = true
        parts = parts.flatMap((part) => subtract(part, opening))
      }
      const area = parts.reduce((sum, r) => sum + r.w * r.h, 0)
      if (area <= 1e-7) continue
      const minX = Math.min(...parts.map((r) => r.x)),
        maxX = Math.max(...parts.map((r) => r.x + r.w)),
        minY = Math.min(...parts.map((r) => r.y)),
        maxY = Math.max(...parts.map((r) => r.y + r.h))
      pieces.push({
        number: pieces.length + 1,
        row,
        column: col,
        full: Math.abs(area - w * h) <= Math.max(1e-5, w * h * 1e-10),
        notched,
        rect,
        parts,
        cutWidthMm: maxX - minX,
        cutHeightMm: maxY - minY,
        areaMm2: area
      })
      laid += area
    }
  }
  const full = pieces.filter((p) => p.full).length,
    count = pieces.length
  const openingArea = openings.reduce((s, o) => {
    const r = intersection(target, o)
    return s + (r ? r.w * r.h : 0)
  }, 0)
  return {
    widthMm,
    target,
    pieces,
    count,
    full,
    cut: count - full,
    netArea: (widthMm * height - openingArea) / 1e6,
    laidArea: laid / 1e6,
    sourceArea: (count * w * h) / 1e6,
    offcutArea: Math.max(0, (count * w * h - laid) / 1e6),
    orientedWidthMm: w,
    orientedHeightMm: h
  }
}
export type WallPanelResult = ReturnType<typeof computeWallPanels>
