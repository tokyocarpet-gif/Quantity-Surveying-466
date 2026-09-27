import { calculateEstimate, estimateBodySchema, type EstimateBody } from './estimate'
import { detailSheetsFor } from './estimate-pages'

export type CoverSummary = {
  sheetId: string
  section: string
  name: string
  specification: string
  note: string
  amount: string | null
}
/** Group continued detail sheets by their section, and sum the rounded line amounts once. */
export function coverSummariesFor(body: EstimateBody): CoverSummary[] {
  const amounts = calculateEstimate(body).amounts
  const indexes = new Map(body.lines.map((line, i) => [line.id, i]))
  const groups = new Map<string, CoverSummary>()
  for (const sheet of detailSheetsFor(body)) {
    if (!sheet.lineIds.length) continue
    const section = sheet.section.trim() || '内装仕上工事'
    let row = groups.get(section)
    if (!row) {
      const saved = body.coverSummaries?.find((r) => r.sheetId === sheet.id)
      row = {
        sheetId: sheet.id,
        section,
        name: saved?.name ?? section,
        specification: saved?.specification ?? '別紙内訳書通り',
        note: saved?.note ?? '',
        amount: '0'
      }
      groups.set(section, row)
    }
    for (const id of sheet.lineIds) {
      const value = amounts[indexes.get(id)!]
      row.amount =
        row.amount === null || value === null ? null : String(BigInt(row.amount) + BigInt(value))
    }
  }
  return [...groups.values()]
}
export function editCoverSummary(
  body: EstimateBody,
  sheetId: string,
  key: string,
  value: string
): EstimateBody {
  if (!['name', 'specification', 'note'].includes(key))
    throw new Error('表紙の金額は内訳から自動計算します。')
  const row = coverSummariesFor(body).find((r) => r.sheetId === sheetId)
  if (!row) throw new Error('対応する内訳がありません。')
  const entry = {
    sheetId,
    name: row.name,
    specification: row.specification,
    note: row.note,
    [key]: value
  }
  return estimateBodySchema.parse({
    ...body,
    coverSummaries: [...(body.coverSummaries ?? []).filter((r) => r.sheetId !== sheetId), entry]
  })
}
