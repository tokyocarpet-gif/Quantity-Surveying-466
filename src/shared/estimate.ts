import { z } from 'zod'
import { idSchema, nameSchema } from './validation'
import { summaryExportSchema, displayQuantity, type SummaryReport } from './summary'
export const roundingSchema = z.enum(['round', 'truncate', 'away'])
export type Rounding = z.infer<typeof roundingSchema>
export const roundingLabels: Record<Rounding, string> = {
  round: '四捨五入',
  truncate: '切り捨て（0方向）',
  away: '切り上げ（0から離す）'
}
const quantitySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,12})\.\d$/, '数量は小数1桁で入力してください。')
  .refine((s) => Math.abs(Number(s)) <= 1e12)
export const estimateLineSchema = z
  .object({
    id: idSchema,
    room: z.string().trim().max(120),
    category: z.string().trim().min(1).max(120),
    name: z.string().trim().max(120),
    specification: z.string().trim().max(400).default(''),
    section: z.string().trim().max(120).default(''),
    note: z.string().trim().max(500).default(''),
    quantity: quantitySchema,
    unit: z.string().trim().min(1).max(20),
    unitPrice: z.number().finite().min(0).max(1e9).nullable()
  })
  .strict()
export type EstimateLine = z.infer<typeof estimateLineSchema>
export const estimateBodySchema = z
  .object({
    calculationVersion: z.literal(1).default(1),
    title: nameSchema,
    number: z.string().trim().max(80),
    date: z.iso.date(),
    recipient: z.string().trim().max(160),
    issuer: z.string().trim().max(1000),
    delivery: z.string().trim().max(200).default(''),
    conditions: z.string().trim().max(2000),
    memo: z.string().trim().max(4000),
    taxRate: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .refine(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8,
        '税率は小数2桁以内で入力してください。'
      ),
    amountRounding: roundingSchema,
    taxRounding: roundingSchema,
    lines: z
      .array(estimateLineSchema)
      .min(1, '明細を1件以上登録してください。')
      .max(2000)
      .refine(
        (lines) => new Set(lines.map((l) => l.id)).size === lines.length,
        '明細IDが重複しています。'
      )
  })
  .strict()
export type EstimateBody = z.infer<typeof estimateBodySchema>
export const estimateSourceSchema = z
  .object({
    scope: z.string().max(2000),
    view: z.string().max(40),
    generatedAt: z.iso.datetime(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    lines: z
      .array(
        z
          .object({
            lineId: idSchema,
            itemIds: z.array(idSchema).min(1).max(100000),
            room: z.string().max(160),
            name: z.string().max(120),
            specification: z.string().max(400).default(''),
            quantity: z.string().regex(/^-?\d+\.\d{3}$/),
            unitPrice: z.number().finite().min(0).max(1e9).nullable()
          })
          .strict()
      )
      .min(1)
      .max(2000)
  })
  .strict()
export type EstimateSource = z.infer<typeof estimateSourceSchema>
export const estimateCreateSchema = summaryExportSchema
export const estimateReadSchema = z
  .object({ id: idSchema, revision: z.number().int().positive().optional() })
  .strict()
export const estimateSaveSchema = z
  .object({ id: idSchema, expectedRevision: z.number().int().positive(), body: estimateBodySchema })
  .strict()
export const estimatePdfSchema = z
  .object({ id: idSchema, revision: z.number().int().positive() })
  .strict()
export type EstimatePdfRequest = z.infer<typeof estimatePdfSchema>
export type EstimateRead = z.infer<typeof estimateReadSchema>
export type EstimateSave = z.infer<typeof estimateSaveSchema>
export interface EstimateTotals {
  amounts: (string | null)[]
  subtotal: string | null
  tax: string | null
  total: string | null
  knownSubtotal: string
  missingPrices: number
  negativeLines: number
}
export interface EstimateDoc {
  id: string
  projectId: string
  revision: number
  latestRevision: number
  createdAt: string
  savedAt: string
  body: EstimateBody
  source: EstimateSource
  totals: EstimateTotals
  versions: { revision: number; savedAt: string }[]
}
export interface EstimateListItem {
  id: string
  title: string
  number: string
  revision: number
  updatedAt: string
  total: string | null
}
function decimal(value: number): [bigint, bigint] {
  const [s, e = '0'] = String(value).split('e')
  const places = s.split('.')[1]?.length ?? 0
  const power = Number(e) - places
  const n = BigInt(s.replace('.', ''))
  return power >= 0 ? [n * 10n ** BigInt(power), 1n] : [n, 10n ** BigInt(-power)]
}
export function roundMoney(n: bigint, d: bigint, mode: Rounding): bigint {
  const sign = n < 0n ? -1n : 1n
  const abs = n * sign,
    rem = abs % d
  const increment = mode === 'round' ? rem * 2n >= d : mode === 'away' ? rem !== 0n : false
  return sign * (abs / d + (increment ? 1n : 0n))
}
export function calculateEstimate(body: EstimateBody): EstimateTotals {
  const amounts = body.lines.map((l) => {
    if (l.unitPrice === null) return null
    const [n, d] = decimal(l.unitPrice)
    return String(roundMoney(BigInt(l.quantity.replace('.', '')) * n, d * 10n, body.amountRounding))
  })
  const known = amounts.reduce<bigint>((n, a) => n + (a === null ? 0n : BigInt(a)), 0n),
    missingPrices = amounts.filter((a) => a === null).length
  const rate = Math.round(body.taxRate * 100),
    tax = roundMoney(known * BigInt(rate), 10000n, body.taxRounding)
  return {
    amounts,
    knownSubtotal: String(known),
    subtotal: missingPrices ? null : String(known),
    tax: missingPrices ? null : String(tax),
    total: missingPrices ? null : String(known + tax),
    missingPrices,
    negativeLines: body.lines.filter((l) => Number(l.quantity) < 0).length
  }
}
export function estimateLinesFromSummary(report: SummaryReport, ids: string[]): EstimateLine[] {
  return report.rows.map((r, i) => ({
    id: ids[i],
    room: r.roomLabel,
    category: r.category,
    name: r.finish,
    specification: r.specification ?? '',
    section: '',
    note: '',
    quantity: displayQuantity(r.quantity),
    unit: r.unit,
    unitPrice: r.unitPrice
  }))
}

/** Group already-rounded line amounts, keeping first appearance and each section's line order. */
export function estimateSections(body: EstimateBody) {
  const totals = calculateEstimate(body)
  const groups = new Map<
    string,
    { name: string; indexes: number[]; known: bigint; missing: boolean }
  >()
  body.lines.forEach((line, index) => {
    const name = line.section.trim() || '内装仕上工事'
    let group = groups.get(name)
    if (!group) {
      group = { name, indexes: [], known: 0n, missing: false }
      groups.set(name, group)
    }
    group.indexes.push(index)
    const amount = totals.amounts[index]
    if (amount === null) group.missing = true
    else group.known += BigInt(amount)
  })
  return Array.from(groups.values(), (g) => ({
    name: g.name,
    indexes: g.indexes,
    amount: g.missing ? null : String(g.known)
  }))
}
