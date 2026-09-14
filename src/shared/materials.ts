import { dimensionLabel } from './roll-dimensions'
import { tileDimensions } from './layout'
import { z } from 'zod'
import { idSchema, nameSchema } from './validation'
import { categoryUnits, categoryLabels, type Category } from './takeoff'
export const materialInputSchema = z
  .object({
    ...tileDimensions,
    projectId: idSchema.nullable(),
    category: nameSchema,
    name: nameSchema,
    specification: z.string().trim().max(240).default(''),
    unit: z.string().trim().min(1).max(20).optional(),
    unitPrice: z.number().finite().min(0).max(1e9).nullable()
  })
  .strict()
  .refine(
    (m) => m.layoutType !== 'tile' || m.tileHeightMm === null || m.tileHeightMm <= 10000,
    'タイル・その他の長さは10,000mm以内で入力してください。'
  )
  .transform((m) => ({
    ...m,
    unit:
      m.unit ??
      (Object.hasOwn(categoryUnits, m.category) ? categoryUnits[m.category as Category] : '式')
  }))
export function partLabel(category: string): string {
  return Object.hasOwn(categoryLabels, category) ? categoryLabels[category as Category] : category
}
export type MaterialInput = z.infer<typeof materialInputSchema>
export interface Material extends MaterialInput {
  id: string
  sourceId: string | null
}
export interface MaterialContext {
  parts?: string[]
  units?: string[]
  global: Material[]
  project: Material[]
  roomNames: string[]
  heightHistory: number[]
}
export const materialChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('save'), id: idSchema, input: materialInputSchema }).strict(),
  z.object({ kind: z.literal('delete'), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal('import'),
      projectId: idSchema,
      ids: z.array(idSchema).min(1).max(500)
    })
    .strict()
])
export type MaterialChange = z.infer<typeof materialChangeSchema>

/** Each dimension is optional; explicit labels avoid ambiguity when one is missing. */
export function materialStandard(
  m: Pick<Material, 'tileWidthMm' | 'tileHeightMm' | 'tileThicknessMm'> & {
    layoutType?: Material['layoutType']
  }
): string {
  if (m.layoutType && m.layoutType !== 'tile')
    return (
      [
        ['W', m.tileWidthMm],
        ['L', m.tileHeightMm],
        ['T', m.tileThicknessMm]
      ] as const
    )
      .filter(([, value]) => value != null)
      .map(([axis, value]) => `${axis} ${dimensionLabel(value!, m.layoutType!, axis)}`)
      .join(' × ')
  return (
    [
      [m.layoutType && m.layoutType !== 'tile' ? 'ロール幅' : '幅', m.tileWidthMm],
      [m.layoutType && m.layoutType !== 'tile' ? '巻き長さ' : '長さ', m.tileHeightMm],
      ['厚み', m.tileThicknessMm]
    ] as const
  )
    .filter(([, value]) => value != null)
    .map(([label, value]) => `${label} ${value} mm`)
    .join(' × ')
}

/** Snapshot text shared by takeoff, summary and estimate, including their exports. */
export function materialSpecification(
  m: Pick<Material, 'specification' | 'tileWidthMm' | 'tileHeightMm' | 'tileThicknessMm'> & {
    layoutType?: Material['layoutType']
  }
): string {
  const standard =
    (!m.layoutType || m.layoutType === 'tile') && m.tileWidthMm != null && m.tileHeightMm != null
      ? [m.tileWidthMm, m.tileHeightMm, m.tileThicknessMm].filter((v) => v != null).join('×') +
        ' mm'
      : materialStandard(m)
  return [m.specification.trim(), standard].filter(Boolean).join(' ／ ')
}
