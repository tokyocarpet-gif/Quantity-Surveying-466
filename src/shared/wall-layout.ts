import { wallPanelSchema, computeWallPanels, type WallPanelResult } from './wall-panels'
import { z } from 'zod'
import { idSchema, nameSchema } from './validation'
import { distance, pointSchema } from './takeoff'
const mm = z.number().finite().positive().max(1000000)
const nonnegative = z.number().finite().min(0).max(1000000)
const wallpaperFields = z
  .object({
    widthMm: nonnegative.max(10000),
    repeatMm: nonnegative.max(10000),
    horizontalRepeatMm: nonnegative.max(10000),
    match: z.enum(['none', 'straight', 'step']),
    stepMm: nonnegative.max(10000),
    rollLengthMm: mm.nullable()
  })
  .strict()
export const wallpaperSchema = wallpaperFields.superRefine((m, ctx) => {
  if (m.widthMm <= 0)
    ctx.addIssue({ code: 'custom', message: 'クロスの有効幅を入力してください。' })
  if (m.match !== 'none' && m.repeatMm <= 0)
    ctx.addIssue({ code: 'custom', message: '柄合わせには縦リピートを入力してください。' })
  if (m.match === 'step' && (m.stepMm <= 0 || m.stepMm >= m.repeatMm))
    ctx.addIssue({
      code: 'custom',
      message: 'ステップずれは0より大きく、縦リピート未満で入力してください。'
    })
})
export type Wallpaper = z.infer<typeof wallpaperSchema>
export const matchLabels = {
  none: '無地・柄合わせなし',
  straight: 'ストレート柄合わせ',
  step: 'ステップ柄合わせ'
}
export const wallAddressSchema = z
  .object({ drawingId: idSchema, pageNumber: z.number().int().min(1).max(100000) })
  .strict()
export type WallAddress = z.infer<typeof wallAddressSchema>
const openingSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    xMm: nonnegative,
    bottomMm: nonnegative,
    widthMm: mm,
    heightMm: mm
  })
  .strict()
export const wallBodySchema = z
  .object({
    name: nameSchema,
    kind: z.enum(['wallpaper', 'tile', 'protection']).optional(),
    startSide: z.enum(['left', 'right']).optional(),
    panel: wallPanelSchema.optional(),
    points: z.tuple([pointSchema, pointSchema]),
    roomId: idSchema.nullable(),
    edgeIndex: z.number().int().min(0).max(499).nullable(),
    scale: mm,
    heightMm: mm.max(100000),
    materialName: nameSchema,
    material: wallpaperFields,
    topTrimMm: nonnegative.max(10000),
    bottomTrimMm: nonnegative.max(10000),
    offsetMm: nonnegative.max(10000),
    openings: z.array(openingSchema).max(100)
  })
  .strict()
  .superRefine((b, ctx) => {
    const width = distance(...b.points) * b.scale * 1000
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (width < 1 || width > 1000000) fail('壁の長さは1〜1,000,000mmの範囲で指定してください。')
    if ((b.roomId === null) !== (b.edgeIndex === null)) fail('部屋と壁の参照が一致しません。')
    if (!b.kind || b.kind === 'wallpaper') {
      const parsed = wallpaperSchema.safeParse(b.material)
      if (!parsed.success) parsed.error.issues.forEach((i) => fail(i.message))
      if (b.offsetMm >= b.material.widthMm) fail('貼り始めのずらしは有効幅未満にしてください。')
    } else {
      if (!b.panel?.widthMm || !b.panel.heightMm)
        fail('材料のW・Lを入力するか、規格のあるマスタを選んでください。')
      if (
        b.panel &&
        (b.panel.bottomMm >= b.heightMm ||
          b.panel.bottomMm + (b.panel.coverageHeightMm ?? b.heightMm - b.panel.bottomMm) >
            b.heightMm)
      )
        fail('施工範囲を壁の高さ内に設定してください。')
      if (
        b.kind === 'protection' &&
        b.panel &&
        (b.panel.pattern !== 'straight' || b.panel.gapMm !== 0)
      )
        fail('養生板は通し貼り・目地なしで設定してください。')
    }
    if (new Set(b.openings.map((o) => o.id)).size !== b.openings.length)
      fail('開口のIDが重複しています。')
    b.openings.forEach((o, i) => {
      if (o.xMm + o.widthMm > width + 0.001 || o.bottomMm + o.heightMm > b.heightMm + 0.001)
        fail('窓・ドアは壁の範囲内に配置してください。')
      if (
        b.openings
          .slice(0, i)
          .some(
            (p) =>
              Math.min(o.xMm + o.widthMm, p.xMm + p.widthMm) > Math.max(o.xMm, p.xMm) &&
              Math.min(o.bottomMm + o.heightMm, p.bottomMm + p.heightMm) >
                Math.max(o.bottomMm, p.bottomMm)
          )
      )
        fail('窓・ドアが重なっています。')
    })
  })
export type WallBody = z.infer<typeof wallBodySchema>
export const wallSaveSchema = z
  .object({
    ...wallAddressSchema.shape,
    id: idSchema,
    expectedRevision: z.number().int().min(0),
    body: wallBodySchema
  })
  .strict()
export type WallSave = z.infer<typeof wallSaveSchema>
export const wallBatchPdfSchema = z
  .object({
    ...wallAddressSchema.shape,
    walls: z
      .array(
        z
          .object({
            id: idSchema,
            expectedRevision: z.number().int().positive()
          })
          .strict()
      )
      .min(1, '出力する壁を選択してください。')
      .max(100, '一度に出力できる壁は100面までです。')
  })
  .strict()
  .refine(
    (v) => new Set(v.walls.map((w) => w.id)).size === v.walls.length,
    '同じ壁が重複しています。'
  )
export type WallBatchPdfRequest = z.infer<typeof wallBatchPdfSchema>
export interface WallDoc extends WallAddress {
  id: string
  revision: number
  body: WallBody
}
export const wallDeleteSchema = z
  .object({ id: idSchema, expectedRevision: z.number().int().positive() })
  .strict()
export interface WallDrop {
  number: number
  xMm: number
  widthMm: number
  cutMm: number
  phaseMm: number
  wasteMm: number
  roll: number
  skipped: boolean
}
/** Conservative full-height drops: openings only omit a strip covered from floor to ceiling.
 * Cut lengths are whole vertical repeats. Each roll reserves one repeat for unknown initial phase.
 * Step phase is tied to the horizontal strip index, including strips hidden by openings.
 */
export function computeWall(raw: WallBody) {
  const b = wallBodySchema.parse(raw),
    m = b.material
  const widthMm = distance(...b.points) * b.scale * 1000
  if (b.kind === 'tile' || b.kind === 'protection') {
    // Work from the chosen edge, but return geometry in the unchanged elevation coordinates.
    const fromRight = b.startSide === 'right'
    const panel = computeWallPanels(
      fromRight
        ? {
            ...b,
            panel: { ...b.panel!, offsetX: -b.panel!.offsetX },
            openings: b.openings.map((o) => ({ ...o, xMm: widthMm - o.xMm - o.widthMm }))
          }
        : b
    )
    if (fromRight) {
      const mirror = (r: typeof panel.target) => ({ ...r, x: widthMm - r.x - r.w })
      panel.pieces = panel.pieces.map((p) => ({
        ...p,
        rect: mirror(p.rect),
        parts: p.parts.map(mirror)
      }))
    }
    return {
      widthMm,
      grossArea: (widthMm * b.heightMm) / 1e6,
      netArea: panel.netArea,
      drops: [] as WallDrop[],
      rolls: [] as { usedMm: number; drops: number[] }[],
      cutMm: 0,
      wasteMm: 0,
      usedMm: 0,
      rollCount: null,
      panel: panel as WallPanelResult | null
    }
  }
  const count = Math.ceil((widthMm + b.offsetMm - 1e-7) / m.widthMm)
  if (count > 2000) throw new Error('巾数が2,000を超えます。有効幅と縮尺を確認してください。')
  const repeat = m.match === 'none' ? 0 : m.repeatMm
  const base = b.heightMm + b.topTrimMm + b.bottomTrimMm
  const cut = repeat ? Math.ceil((base - 1e-7) / repeat) * repeat : base
  const drops: WallDrop[] = [],
    rolls: { usedMm: number; drops: number[] }[] = []
  const modulo = (v: number) => (repeat ? ((v % repeat) + repeat) % repeat : 0)
  for (let i = 0; i < count; i++) {
    const near = Math.max(0, i * m.widthMm - b.offsetMm),
      far = Math.min(widthMm, (i + 1) * m.widthMm - b.offsetMm),
      left = b.startSide === 'right' ? widthMm - far : near,
      right = b.startSide === 'right' ? widthMm - near : far
    const covered = b.openings
      .filter((o) => o.xMm <= left + 1e-7 && o.xMm + o.widthMm >= right - 1e-7)
      .sort((a, b) => a.bottomMm - b.bottomMm)
    let top = 0
    for (const o of covered) {
      if (o.bottomMm > top + 1e-7) break
      top = Math.max(top, o.bottomMm + o.heightMm)
    }
    const skipped = top >= b.heightMm - 1e-7
    const phaseMm = m.match === 'step' ? modulo(i * m.stepMm) : 0
    let wasteMm = 0
    if (!skipped) {
      let roll = rolls.at(-1)
      wasteMm = roll ? modulo(phaseMm - modulo(roll.usedMm)) : repeat + phaseMm
      if (!roll || (m.rollLengthMm && roll.usedMm + wasteMm + cut > m.rollLengthMm + 1e-7)) {
        wasteMm = repeat + phaseMm
        if (m.rollLengthMm && wasteMm + cut > m.rollLengthMm + 1e-7)
          throw new Error(`第${i + 1}巾の裁断長さと柄出し余裕が巻き長さを超えます。`)
        roll = { usedMm: 0, drops: [] }
        rolls.push(roll)
      }
      roll.usedMm += wasteMm + cut
      roll.drops.push(i + 1)
    }
    drops.push({
      number: i + 1,
      xMm: left,
      widthMm: right - left,
      cutMm: skipped ? 0 : cut,
      phaseMm,
      wasteMm,
      roll: skipped ? 0 : rolls.length,
      skipped
    })
  }
  const cutMm = drops.reduce((sum, d) => sum + d.cutMm, 0),
    wasteMm = drops.reduce((sum, d) => sum + d.wasteMm, 0)
  return {
    panel: null as WallPanelResult | null,
    widthMm,
    grossArea: (widthMm * b.heightMm) / 1e6,
    netArea:
      (widthMm * b.heightMm - b.openings.reduce((sum, o) => sum + o.widthMm * o.heightMm, 0)) / 1e6,
    drops,
    rolls,
    cutMm,
    wasteMm,
    usedMm: cutMm + wasteMm,
    rollCount: m.rollLengthMm ? rolls.length : null
  }
}
export type WallResult = ReturnType<typeof computeWall>
