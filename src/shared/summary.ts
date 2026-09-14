import { partLabel } from './materials'
import { z } from 'zod'
import { idSchema } from './validation'
import { categories, categoryLabels, finishesSchema, type Category } from './takeoff'
export const summaryViews = ['room-finish', 'finish', 'room', 'drawing'] as const
export const summaryViewLabels = {
  'room-finish': '部屋×仕上げ',
  finish: '仕上げ別',
  room: '部屋別',
  drawing: '図面別'
}
export const summaryRequestSchema = z
  .object({
    projectId: idSchema,
    view: z.enum(summaryViews).default('room-finish'),
    drawingId: idSchema.nullable().default(null),
    pageNumber: z.number().int().positive().nullable().default(null),
    groupId: idSchema.nullable().default(null),
    category: z.string().trim().min(1).max(120).nullable().default(null),
    query: z.string().trim().max(120).default(''),
    issue: z.enum(['all', 'missing-price', 'negative', 'missing-finish']).default('all')
  })
  .strict()
  .refine((r) => !r.pageNumber || !!r.drawingId, 'ページを指定する場合は図面を選んでください。')
export type SummaryRequest = z.infer<typeof summaryRequestSchema>
export const summaryExportSchema = z
  .object({ request: summaryRequestSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict()
export type SummaryExport = z.infer<typeof summaryExportSchema>
export const summaryEditSchema = summaryExportSchema
  .extend({
    rowId: z.string().min(1).max(2048),
    finish: finishesSchema.shape.floor
  })
  .strict()
export type SummaryEdit = z.infer<typeof summaryEditSchema>
export interface SummaryRoom {
  id: string
  name: string
  drawingId: string
  pageNumber: number
  ordinal: number
}
export interface SummaryDrawing {
  id: string
  name: string
  pageCount: number
}
export interface SummarySource {
  id: string
  roomId: string | null
  groupId: string | null
  roomName: string
  roomOrdinal: number
  partNumber: number
  drawingId: string
  drawingName: string
  pageNumber: number
  category: string
  unit: string
  finish: string
  specification?: string
  unitPrice: number | null
  rawQuantity: number
  rawDeduction: number
  rawNet: number
  fixed: boolean
  source: 'auto-room' | 'manual' | 'count'
}
export interface SummaryLine extends SummarySource {
  gross: string
  deduction: string
  quantity: string
  amount: string | null
}
export interface SummaryRow {
  id: string
  sectionKey: string
  section: string
  roomLabel: string
  location: string
  category: string
  unit: string
  finish: string
  specification?: string
  unitPrice: number | null
  gross: string
  deduction: string
  quantity: string
  amount: string | null
  sourceIds: string[]
  fixedCount: number
  negativeCount: number
  missingFinishCount: number
}
export interface SummaryReport {
  request: SummaryRequest
  projectName: string
  clientName: string
  drawings: SummaryDrawing[]
  rooms: SummaryRoom[]
  categoryOptions?: string[]
  rows: SummaryRow[]
  lines: SummaryLine[]
  totalItemCount: number
  roomCount: number
  totals: { category: string; unit: string; quantity: string }[]
  knownAmount: string
  amount: string | null
  missingPriceCount: number
  negativeCount: number
  missingFinishCount: number
  fingerprint: string
  generatedAt: string
}
export const summaryCalculationNote =
  '数量表示は小数1桁です。参考金額は元明細の小数3桁の数量×単価を円単位で四捨五入して合算します。内訳で計算数量を確認できます。税計算は含みません。'

// Decimal arithmetic prevents yen totals from losing digits or changing between grouping views.
function fraction(value: number): [bigint, bigint] {
  if (!Number.isFinite(value)) throw new Error('集計できない数値があります。')
  const [coefficient, exp = '0'] = String(value).toLowerCase().split('e')
  const places = coefficient.split('.')[1]?.length ?? 0
  const integer = BigInt(coefficient.replace('.', '')),
    power = Number(exp) - places
  return power >= 0 ? [integer * 10n ** BigInt(power), 1n] : [integer, 10n ** BigInt(-power)]
}
function rounded(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n
  const a = n * sign
  return sign * (a / d + ((a % d) * 2n >= d ? 1n : 0n))
}
export function quantityMilli(n: number): bigint {
  const [a, b] = fraction(n)
  return rounded(a * 1000n, b)
}
export function quantityString(n: bigint): string {
  const a = n < 0n ? -n : n
  return `${n < 0n ? '-' : ''}${a / 1000n}.${String(a % 1000n).padStart(3, '0')}`
}
export function lineAmount(quantity: bigint, price: number | null): bigint | null {
  if (price === null) return null
  const [a, b] = fraction(price)
  return rounded(quantity * a, b * 1000n)
}
// Presentation precision is independent of stored geometry and adopted calculation quantities.
export function displayQuantity(value: string): string {
  const negative = value.startsWith('-')
  const [integer, fraction = ''] = value.replace(/^-/, '').split('.')
  const scale = 10n ** BigInt(fraction.length)
  const units = rounded(BigInt(integer + fraction) * (negative ? -10n : 10n), scale)
  const abs = units < 0n ? -units : units
  return `${units < 0n ? '-' : ''}${abs / 10n}.${abs % 10n}`
}
export function formatQuantity(value: string): string {
  return formatDecimal(displayQuantity(value))
}
export function formatDecimal(value: string): string {
  const [integer, fraction] = value.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '')
}
const normalized = (s: string): string => s.normalize('NFKC').toLocaleLowerCase('ja-JP')
export function aggregateSummary(
  sources: SummarySource[],
  request: SummaryRequest
): Pick<
  SummaryReport,
  | 'rows'
  | 'lines'
  | 'totals'
  | 'knownAmount'
  | 'amount'
  | 'missingPriceCount'
  | 'negativeCount'
  | 'missingFinishCount'
  | 'totalItemCount'
  | 'roomCount'
> {
  const query = normalized(request.query)
  const filtered = sources
    .filter(
      (s) =>
        (!request.drawingId || s.drawingId === request.drawingId) &&
        (!request.pageNumber || s.pageNumber === request.pageNumber) &&
        (!request.groupId || s.groupId === request.groupId) &&
        (!request.category || s.category === request.category) &&
        (!query ||
          normalized(
            `${s.roomName} ${s.finish} ${s.specification ?? ''} ${s.drawingName}`
          ).includes(query))
    )
    .filter(
      (s) =>
        request.issue === 'all' ||
        (request.issue === 'missing-price' && s.unitPrice === null) ||
        (request.issue === 'negative' && s.rawNet < 0) ||
        (request.issue === 'missing-finish' && !s.finish)
    )
  const map = new Map<
    string,
    {
      row: SummaryRow
      gross: bigint
      deduction: bigint
      quantity: bigint
      amount: bigint
      locations: Set<string>
      rooms: Set<string>
    }
  >()
  const totals = new Map<string, { category: string; unit: string; quantity: bigint }>()
  for (const category of categories)
    totals.set(JSON.stringify([category, category === 'baseboard' ? 'm' : '㎡']), {
      category,
      unit: category === 'baseboard' ? 'm' : '㎡',
      quantity: 0n
    })
  let known = 0n
  const lines: SummaryLine[] = filtered.map((s) => {
    const q = quantityMilli(s.rawNet),
      a = lineAmount(q, s.unitPrice)
    const totalKey = JSON.stringify([s.category, s.unit])
    totals.set(totalKey, {
      category: s.category,
      unit: s.unit,
      quantity: (totals.get(totalKey)?.quantity ?? 0n) + q
    })
    known += a ?? 0n
    const roomLabel = s.groupId ? s.roomName : '部屋未指定'
    const location = `${s.drawingName} · ${s.pageNumber}ページ`
    const roomKey = s.groupId ?? `${s.drawingId}:${s.pageNumber}:unassigned`
    const scope =
      request.view === 'finish' ? 'all' : request.view === 'drawing' ? s.drawingId : roomKey
    const key = JSON.stringify([
      scope,
      s.category,
      s.finish,
      s.specification ?? '',
      s.unit,
      s.unitPrice
    ])
    let g = map.get(key)
    if (!g) {
      g = {
        row: {
          id: key,
          sectionKey: scope,
          section:
            request.view === 'room'
              ? `${roomLabel} — ${location}`
              : request.view === 'drawing'
                ? s.drawingName
                : '',
          roomLabel,
          location,
          category: s.category,
          unit: s.unit,
          finish: s.finish,
          specification: s.specification ?? '',
          unitPrice: s.unitPrice,
          gross: '',
          deduction: '',
          quantity: '',
          amount: null,
          sourceIds: [],
          fixedCount: 0,
          negativeCount: 0,
          missingFinishCount: 0
        },
        gross: 0n,
        deduction: 0n,
        quantity: 0n,
        amount: 0n,
        locations: new Set(),
        rooms: new Set()
      }
      map.set(key, g)
    }
    g.gross += quantityMilli(s.rawQuantity)
    g.deduction += quantityMilli(s.rawDeduction)
    g.quantity += q
    g.amount += a ?? 0n
    g.row.sourceIds.push(s.id)
    g.row.fixedCount += Number(s.fixed)
    g.row.negativeCount += Number(s.rawNet < 0)
    g.row.missingFinishCount += Number(!s.finish)
    g.locations.add(location)
    g.rooms.add(roomKey)
    return {
      ...s,
      gross: quantityString(quantityMilli(s.rawQuantity)),
      deduction: quantityString(quantityMilli(s.rawDeduction)),
      quantity: quantityString(q),
      amount: a === null ? null : String(a)
    }
  })
  const rows = [...map.values()].map((g) => ({
    ...g.row,
    gross: quantityString(g.gross),
    deduction: quantityString(g.deduction),
    quantity: quantityString(g.quantity),
    amount: g.row.unitPrice === null ? null : String(g.amount),
    roomLabel: g.rooms.size > 1 ? `${g.rooms.size}部屋` : g.row.roomLabel,
    location: g.locations.size > 1 ? `${g.locations.size}図面ページ` : g.row.location
  }))
  rows.sort(
    (a, b) =>
      a.section.localeCompare(b.section, 'ja') ||
      (request.view === 'room' || request.view === 'drawing'
        ? a.sectionKey.localeCompare(b.sectionKey)
        : 0) ||
      a.location.localeCompare(b.location, 'ja') ||
      a.roomLabel.localeCompare(b.roomLabel, 'ja') ||
      ((categories as readonly string[]).includes(a.category)
        ? (categories as readonly string[]).indexOf(a.category)
        : 4) -
        ((categories as readonly string[]).includes(b.category)
          ? (categories as readonly string[]).indexOf(b.category)
          : 4) ||
      a.category.localeCompare(b.category, 'ja') ||
      a.finish.localeCompare(b.finish, 'ja') ||
      (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity) ||
      a.id.localeCompare(b.id)
  )
  const missingPriceCount = lines.filter((s) => s.unitPrice === null).length
  return {
    rows,
    lines,
    totalItemCount: sources.length,
    roomCount: new Set(filtered.filter((s) => s.groupId).map((s) => s.groupId)).size,
    totals: [...totals.values()].map((t) => ({ ...t, quantity: quantityString(t.quantity) })),
    knownAmount: String(known),
    amount: missingPriceCount ? null : String(known),
    missingPriceCount,
    negativeCount: lines.filter((s) => s.rawNet < 0).length,
    missingFinishCount: lines.filter((s) => !s.finish).length
  }
}
export function summaryScope(
  report: Pick<SummaryReport, 'request' | 'drawings' | 'rooms'>
): string {
  const r = report.request
  const issueLabels = {
    all: '',
    'missing-price': '単価未設定',
    negative: '負の数量',
    'missing-finish': '仕上げ未設定'
  }
  return [
    r.drawingId ? report.drawings.find((d) => d.id === r.drawingId)?.name : '全図面',
    r.pageNumber ? `${r.pageNumber}ページ` : '全ページ',
    r.groupId ? report.rooms.find((g) => g.id === r.groupId)?.name : '全部屋',
    r.category ? partLabel(r.category) : '全部位',
    issueLabels[r.issue],
    r.query ? `検索「${r.query}」` : ''
  ]
    .filter(Boolean)
    .join(' / ')
}
function textCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}
function numberCell(value: string | null): string {
  return value === null ? '' : value
}
export function summaryCsv(report: SummaryReport): string {
  const header = [
    '物件',
    '表示',
    '区分',
    '図面・ページ',
    '部屋',
    '部位',
    '仕上げ',
    '仕様・規格',
    '元数量',
    '控除数量',
    '正味数量（集計）',
    '単位',
    '単価',
    '参考金額（税別）',
    '元明細数',
    '数量固定数',
    '確認事項',
    '絞込条件',
    '出力日時',
    '計算条件',
    '金額計算用数量（小数3桁）'
  ]
    .map(textCell)
    .join(',')
  const output = report.rows.map((r) =>
    [
      report.projectName,
      summaryViewLabels[report.request.view],
      r.section,
      r.location,
      r.roomLabel,
      partLabel(r.category),
      r.finish || '仕上げ未設定',
      r.specification ?? ''
    ]
      .map(textCell)
      .concat([
        numberCell(displayQuantity(r.gross)),
        numberCell(displayQuantity(r.deduction)),
        numberCell(displayQuantity(r.quantity)),
        textCell(r.unit),
        numberCell(r.unitPrice === null ? null : String(r.unitPrice)),
        numberCell(r.amount),
        String(r.sourceIds.length),
        String(r.fixedCount),
        textCell(
          [
            r.unitPrice === null ? '単価未設定' : '',
            r.negativeCount ? `負の数量 ${r.negativeCount}件` : '',
            r.missingFinishCount ? '仕上げ未設定' : ''
          ]
            .filter(Boolean)
            .join(' / ')
        ),
        textCell(summaryScope(report)),
        textCell(report.generatedAt),
        textCell(summaryCalculationNote),
        numberCell(r.quantity)
      ])
      .join(',')
  )
  return '\ufeff' + [header, ...output].join('\r\n') + '\r\n'
}
