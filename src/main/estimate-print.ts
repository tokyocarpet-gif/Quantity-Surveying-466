import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EstimateDocument } from '../shared/EstimateDocument'
import { estimateDocumentCss, estimateSheets } from '../shared/estimate-layout'
import { estimatePresentation, type EstimateDoc } from '../shared/estimate'
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )

export function estimatePdfName(doc: EstimateDoc): string {
  const title = doc.body.title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 60)
    .replace(/[. ]+$/, '')
  return `見積_${title || '無題'}_第${doc.revision}版.pdf`
}

export function estimatePrintHtml(
  doc: EstimateDoc,
  output?: { cover: boolean; detail: boolean }
): string {
  const p = estimatePresentation(doc.body)
  const selected = output ?? { cover: p.outputCover, detail: p.outputDetail }
  if (!selected.cover && !selected.detail) throw new Error('出力する帳票を選択してください。')
  const pages = estimateSheets(doc.body, selected)
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>${escapeHtml(doc.body.title)} 第${doc.revision}版</title><style>${estimateDocumentCss}</style></head><body>${pages.map((sheet, i) => renderToStaticMarkup(createElement(EstimateDocument, { body: doc.body, sheet, pageNumber: i + 1 }))).join('')}</body></html>`
}
