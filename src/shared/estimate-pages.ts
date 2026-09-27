import {
  estimateBodySchema,
  estimatePresentation,
  type EstimateBody,
  type EstimateLine
} from './estimate'

export const DETAIL_ROWS = 23
export const COVER_ROWS = 12
/** Older estimates are assigned once, without changing their saved source quantities. */
export function detailSheetsFor(body: EstimateBody): NonNullable<EstimateBody['detailSheets']> {
  if (body.detailSheets) return body.detailSheets
  const groups = new Map<string, string[]>()
  for (const l of body.lines) {
    const section = l.section.trim() || '内装仕上工事'
    if (!groups.has(section)) groups.set(section, [])
    groups.get(section)!.push(l.id)
  }
  return [...groups].flatMap(([section, ids]) => {
    const sheets: NonNullable<EstimateBody['detailSheets']> = []
    for (let i = 0; i < ids.length; i += DETAIL_ROWS)
      sheets.push({ id: ids[i], section, lineIds: ids.slice(i, i + DETAIL_ROWS) })
    return sheets
  })
}
export function withDetailSheets(body: EstimateBody): EstimateBody {
  return { ...body, detailSheets: detailSheetsFor(body) }
}
export function appendDetailSheet(body: EstimateBody, id: string): EstimateBody {
  return estimateBodySchema.parse({
    ...body,
    detailSheets: [...detailSheetsFor(body), { id, section: '', lineIds: [] }]
  })
}
export function putEstimateLine(
  body: EstimateBody,
  line: EstimateLine,
  sheetId: string
): EstimateBody {
  const next = structuredClone(withDetailSheets(body))
  const index = next.lines.findIndex((l) => l.id === line.id)
  if (index >= 0) next.lines[index] = line
  else {
    const sheet = next.detailSheets!.find((s) => s.id === sheetId)
    if (!sheet) throw new Error('入力先の内訳明細書がありません。')
    if (sheet.lineIds.length >= DETAIL_ROWS)
      throw new Error('この内訳明細書は23行までです。「内訳明細書を追加」から追加してください。')
    if (estimatePresentation(next).mode === 'cover') {
      const p = estimatePresentation(next)
      if (p.coverLineIds.length >= COVER_ROWS) throw new Error('表紙は12行までです。')
      next.presentation = { ...p, coverLineIds: [...p.coverLineIds, line.id] }
    }
    next.lines.push(line)
    sheet.lineIds.push(line.id)
  }
  return estimateBodySchema.parse(next)
}
export function removeEstimateLine(
  body: EstimateBody,
  id: string,
  blank: () => EstimateLine
): EstimateBody {
  const next = structuredClone(withDetailSheets(body)),
    p = estimatePresentation(next)
  const sheet = next.detailSheets!.find((s) => s.lineIds.includes(id))!
  next.lines = next.lines.filter((l) => l.id !== id)
  sheet.lineIds = sheet.lineIds.filter((key) => key !== id)
  p.coverLineIds = p.coverLineIds.filter((key) => key !== id)
  if (!next.lines.length || (p.mode === 'cover' && !p.coverLineIds.length)) {
    const line = blank()
    next.lines.push(line)
    sheet.lineIds.push(line.id)
    if (p.mode === 'cover') p.coverLineIds.push(line.id)
  }
  next.presentation = p
  return estimateBodySchema.parse(next)
}
