import { companyBlockCss } from './CompanyBlock'
import { estimatePresentation, coverExtraLinesFor, type EstimateBody } from './estimate'
import { detailSheetsFor } from './estimate-pages'
import { coverSummariesFor } from './estimate-cover'

export type EstimateSheet = {
  id?: string
  kind: 'cover' | 'detail'
  indexes: number[]
  summaryIds?: string[]
  extraIds?: string[]
  section?: string
  continued?: boolean
  last?: boolean
}
// Tax display uses the footer area; the detail rows and page breaks remain unchanged.
export const ESTIMATE_COVER_ROWS = 13
// The same page plan and mm geometry are used by the editor, PDF and printer.
export function estimateSheets(
  body: EstimateBody,
  output = { cover: true, detail: true }
): EstimateSheet[] {
  const sheets: EstimateSheet[] = [],
    p = estimatePresentation(body)
  if (output.cover) {
    const entries: { summary?: string; index?: number; extra?: string }[] =
      p.mode === 'cover'
        ? body.lines.flatMap((l, i) => (p.coverLineIds.includes(l.id) ? [{ index: i }] : []))
        : coverSummariesFor(body).map((r) => ({ summary: r.sheetId }))
    entries.push(...coverExtraLinesFor(body).map((l) => ({ extra: l.id })))
    for (let i = 0; i < Math.max(1, entries.length);) {
      let end = Math.min(i + ESTIMATE_COVER_ROWS, entries.length)
      // Keep the first extra (normally expenses) with the last linked item.
      if (end < entries.length && entries[end].extra && !entries[end - 1]?.extra && end - i > 1)
        end--
      const chunk = entries.slice(i, end)
      sheets.push({
        kind: 'cover',
        indexes: chunk.flatMap((r) => (r.index === undefined ? [] : [r.index])),
        summaryIds:
          p.mode === 'cover' ? undefined : chunk.flatMap((r) => (r.summary ? [r.summary] : [])),
        extraIds: chunk.flatMap((r) => (r.extra ? [r.extra] : [])),
        continued: i > 0
      })
      i = Math.max(i + 1, end)
    }
  }
  if (output.detail) {
    const selected = new Set(p.coverLineIds)
    const indexes = new Map(body.lines.map((l, i) => [l.id, i]))
    for (const sheet of detailSheetsFor(body)) {
      const ids = sheet.lineIds.filter((id) => p.mode === 'detail' || selected.has(id))
      if (p.mode === 'cover' && !ids.length) continue
      sheets.push({
        kind: 'detail',
        id: sheet.id,
        section: sheet.section,
        indexes: ids.map((id) => indexes.get(id)!),
        last: true
      })
    }
  }
  return sheets
}

/** No closures: also executed in the isolated, network-blocked print window. */
export function estimatePaperOverflows(paper: Element): boolean {
  const rect = (selector: string) => paper.querySelector(selector)?.getBoundingClientRect()
  const content = rect('.paper-content'),
    footer = rect('.paper-footer')
  if (!content || !footer || content.bottom > footer.top - 3) return true
  for (const cell of paper.querySelectorAll<HTMLElement>('.paper-row-content'))
    if (cell.scrollHeight > cell.clientHeight + 1 || cell.scrollWidth > cell.clientWidth + 1)
      return true
  for (const selector of ['.paper-header', '.paper-issuer', '.paper-top', '.paper-amount']) {
    const element = paper.querySelector<HTMLElement>(selector)
    if (
      element &&
      (element.scrollHeight > element.clientHeight + 2 ||
        element.scrollWidth > element.clientWidth + 2)
    )
      return true
  }
  for (const [childSelector, parentSelector] of [
    ['.paper-issuer', '.paper-header'],
    ['.paper-project', '.paper-top'],
    ['.paper-recipient', '.paper-top'],
    ['.paper-amount strong', '.paper-amount']
  ]) {
    const child = rect(childSelector),
      parent = rect(parentSelector)
    if (
      child &&
      parent &&
      (child.bottom > parent.bottom + 1 ||
        child.top < parent.top - 1 ||
        child.right > parent.right + 1)
    )
      return true
  }
  return paper.querySelector('.paper-content')!.scrollWidth > paper.clientWidth
}

export const estimateDocumentCss = `
${companyBlockCss}
.estimate-paper{box-sizing:border-box!important;width:297mm;min-width:297mm;height:210mm;padding:9mm 11mm 10mm;position:relative;background:#fff!important;color:#20303e!important;color-scheme:light;font:12px/1.35 'Yu Gothic','Meiryo','Hiragino Kaku Gothic ProN',sans-serif;break-after:page;}
.estimate-paper:last-child{break-after:auto}.estimate-paper *{box-sizing:border-box;color:inherit;-webkit-text-fill-color:currentColor}
.estimate-paper .paper-header{height:28mm;border-top:2mm solid #284f60;padding-top:4mm;display:flex;justify-content:space-between;gap:8mm}
.estimate-paper h1{font:500 30px/1.2 inherit;font-size:30px;letter-spacing:2px;margin:0}
.estimate-paper .paper-issuer{width:120mm;font-size:11px;text-align:right;white-space:pre-wrap;line-height:1.3}
.estimate-paper .paper-top{height:29mm;display:grid;grid-template-columns:1.45fr 1fr;gap:13mm;align-items:center}.estimate-paper .paper-top>div{min-width:0}
.estimate-paper .paper-recipient{font-size:19px;line-height:1.2;margin-bottom:2mm;overflow-wrap:anywhere}.estimate-paper .paper-recipient .paper-field{display:inline;white-space:pre-wrap}.estimate-paper .paper-honorific{white-space:nowrap;margin-left:2mm}
.estimate-paper .paper-project-label{font-size:10px;margin-bottom:1mm}.estimate-paper .paper-project{font-size:14px}
.estimate-paper .paper-amount{height:23mm;background:#eef3f5;border-right:1.3mm solid #284f60;padding:3mm 5mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;gap:2mm}.estimate-paper .paper-amount span{font-size:13px}.estimate-paper .paper-amount strong{font-size:30px;line-height:1.1;font-weight:600;font-variant-numeric:tabular-nums}
.estimate-paper .paper-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));min-height:13mm;margin-top:1mm;border-block:1px solid #d7dfe3}.estimate-paper .paper-meta>div{padding:1.5mm 2mm;border-right:1px solid #d7dfe3}.estimate-paper .paper-meta>div:last-child{border-right:0}.estimate-paper .paper-meta label{display:block;font-size:10px;margin-bottom:1mm;color:#20303e}
.estimate-paper .paper-items{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:2mm;font-size:12px}.estimate-paper .paper-items th{background:#284f60!important;color:#fff!important;height:7mm;font-weight:400;border:0;padding:0 1mm;text-align:center}.estimate-paper .paper-items td{height:6.2mm;border:0;border-bottom:1px solid #d7dfe3;padding:0 1.3mm;vertical-align:middle;white-space:pre-wrap;overflow-wrap:anywhere}.estimate-paper .paper-items tbody tr:nth-child(even) td{background:#f7f9fa}.estimate-paper .paper-number{text-align:right;font-variant-numeric:tabular-nums}.estimate-paper .paper-center{text-align:center}.estimate-paper .paper-name{display:flex;gap:2mm;align-items:center}.estimate-paper .paper-name>div:first-child{flex:1;min-width:0}.estimate-paper .paper-part{width:10mm;text-align:right;flex:none}.estimate-paper .paper-room{font-size:10px}.estimate-paper .paper-spec{display:flex;flex-wrap:wrap;gap:0 2mm}.estimate-paper .paper-spec>div{min-width:0}.estimate-paper .paper-sum td{border-top:1.5px solid #284f60;height:8mm!important;background:#fff!important}.estimate-paper .paper-sum strong{font-size:18px}.estimate-paper .paper-tax td{height:4mm!important;background:#fff!important;font-size:11px}.estimate-paper .paper-expenses td{height:7mm!important;background:#fff!important}
.estimate-paper .paper-notes{display:flex;gap:8mm;justify-content:space-between;margin-top:2mm;font-size:11px}.estimate-paper .paper-notes>div{flex:1;min-width:0}.estimate-paper .paper-notes p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.estimate-paper .paper-footer{position:absolute;bottom:6mm;right:11mm;font-size:11px}
.estimate-paper .paper-detail-header{height:22mm;display:flex;align-items:center;justify-content:space-between;gap:8mm;border-top:2mm solid #284f60}.estimate-paper .paper-detail-header h1{font-size:24px;white-space:nowrap}.estimate-paper .paper-detail-project{max-width:160mm}.estimate-paper .paper-group td{background:#eef3f5!important;height:8mm!important}.estimate-paper .paper-name>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 1mm}.estimate-paper .paper-name>div:first-child>.paper-field{width:auto}.estimate-paper .paper-room{display:inline}.estimate-paper .paper-spec>.is-empty{width:4mm}.estimate-paper .paper-field{display:block;min-height:1.35em;white-space:pre-wrap;overflow-wrap:anywhere}.estimate-paper .paper-empty{color:transparent!important}
.estimate-paper .paper-data-row td,.estimate-paper .paper-blank-row td{height:6.2mm;padding-top:0;padding-bottom:0}
.estimate-paper[data-sheet-kind=detail] .paper-data-row td,.estimate-paper[data-sheet-kind=detail] .paper-blank-row td{height:5.8mm}
.estimate-paper .paper-row-content{height:6mm;max-height:6mm;overflow:hidden;display:flex;flex-direction:column;justify-content:center;font-size:11px;line-height:1;}
.estimate-paper[data-sheet-kind=detail] .paper-row-content{height:5.6mm;max-height:5.6mm}
.estimate-paper .paper-row-content .paper-field{min-height:1em}
.estimate-paper .paper-row-content .paper-spec{gap:0 1mm}
.estimate-paper .paper-row-content .paper-spec>.is-empty{display:none}

.estimate-paper[data-sheet-kind=cover] .paper-header{height:31mm;border-top:1.2mm solid #284f60;padding-top:3mm;gap:10mm}
.estimate-paper[data-sheet-kind=cover] h1{font-size:28px;letter-spacing:3px;margin-top:1mm}
.estimate-paper .paper-heading-right{width:126mm;min-width:0;text-align:right;display:flex;flex-direction:column;gap:2mm}
.estimate-paper .paper-estimate-number{display:flex;justify-content:flex-end;align-items:baseline;gap:3mm;font-size:13px;font-variant-numeric:tabular-nums}
.estimate-paper .paper-estimate-number>span{font-size:10px;letter-spacing:1px;color:#526b79}
.estimate-paper .paper-estimate-number .paper-field,.estimate-paper .paper-estimate-number .paper-cell{width:auto;max-width:94mm;text-align:right}
.estimate-paper[data-sheet-kind=cover] .paper-issuer{width:auto;font-size:10px;line-height:1.4}
.estimate-paper[data-sheet-kind=cover] .paper-top{height:28mm;grid-template-columns:1.3fr 1fr;gap:10mm}
.estimate-paper[data-sheet-kind=cover] .paper-amount{height:22mm;border-right:0;border-left:1mm solid #284f60;background:#eef3f5;padding:3mm 5mm}
.estimate-paper[data-sheet-kind=cover] .paper-amount strong{font-size:28px;letter-spacing:.3px}
.estimate-paper[data-sheet-kind=cover] .paper-meta{margin-top:1mm;min-height:12mm}
.estimate-paper[data-sheet-kind=cover].has-company-block .paper-header{height:42mm}
.estimate-paper[data-sheet-kind=cover].has-company-block .paper-top{height:21mm}
.estimate-paper[data-sheet-kind=cover].has-company-block .paper-amount{height:20mm}
.estimate-paper.has-company-block .paper-issuer{align-self:flex-end;width:max-content;max-width:100%}
.estimate-paper.has-company-block .paper-issuer .paper-cell{padding:0;text-align:left;white-space:normal;line-height:inherit}
.estimate-paper.has-company-block:has(.company-line-extra) .paper-header{height:45mm}
.estimate-paper.has-company-block:has(.company-line-extra) .paper-heading-right{gap:1mm}
.estimate-paper.has-company-block:has(.company-line-extra) .company-block{font-size:11px;line-height:1.2}
.estimate-paper.has-company-block:has(.company-line-extra) .company-line-name{font-size:18px}
.estimate-paper.has-company-block:has(.company-line-extra) .company-line-extra{font-size:9px}
.estimate-paper .paper-cover-bottom{display:grid;grid-template-columns:minmax(0,1fr) 96mm;gap:8mm;margin-top:1mm;padding-top:.5mm;border-top:1.5px solid #284f60;min-height:16mm;align-items:start}
.estimate-paper .paper-cover-bottom .paper-notes{margin:0;display:block;min-width:0}
.estimate-paper .paper-cover-totals{width:100%;table-layout:fixed;border-collapse:collapse;font-size:11px;text-align:right;font-variant-numeric:tabular-nums}
.estimate-paper .paper-cover-totals td{padding:0 1.3mm;white-space:nowrap}
.estimate-paper .paper-cover-totals .paper-tax td{height:4mm}
.estimate-paper .paper-cover-totals .paper-sum td{height:8mm;border-top:1px solid #d7dfe3}
.estimate-paper .paper-cover-totals .paper-sum:first-child td{border-top:0}
.estimate-paper .paper-cover-totals strong{font-size:18px;font-weight:600}
.estimate-paper .paper-cover-tax-note{margin:1mm 0 0;text-align:right;font-size:10px}
@media print{@page{size:A4 landscape;margin:0}html,body{margin:0!important;padding:0!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.estimate-paper{margin:0!important;box-shadow:none!important}.estimate-paper .paper-editor-only{display:none!important}}
`
