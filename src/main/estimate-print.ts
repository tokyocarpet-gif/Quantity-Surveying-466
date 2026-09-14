import { calculateEstimate, estimateSections, type EstimateDoc } from '../shared/estimate'
import { partLabel } from '../shared/materials'
import { formatDecimal } from '../shared/summary'

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

export function estimatePrintHtml(doc: EstimateDoc): string {
  const b = doc.body,
    totals = calculateEstimate(b)
  const text = escapeHtml
  const money = (value: string | null): string =>
    value === null ? '未確定' : text(formatDecimal(value))
  const sections = estimateSections(b)
  const columns = (widths: number[]): string =>
    `<colgroup>${widths.map((width) => `<col style="width:${width}%">`).join('')}</colgroup>`
  const coverRows = sections
    .map(
      (section, index) => `<tr>
    <td class="number">${index + 1}</td><td>${text(section.name)}</td>
    <td>別紙内訳書通り</td><td class="number">1.0</td><td>式</td>
    <td class="number">${money(section.amount)}</td>
    <td class="number">${money(section.amount)}</td>
  </tr>`
    )
    .join('')
  const detailTables = sections
    .map((section, sectionIndex) => {
      const rows = section.indexes
        .map((index) => {
          const line = b.lines[index]
          const wideNote = line.note.length > 120 || line.note.split('\n').length > 5
          return `<tr${wideNote ? ' class="with-note"' : ''}>
        <td>${text(line.room)}</td><td>${text(partLabel(line.category))}</td>
        <td>${text(line.name)}</td><td>${text(line.specification)}</td>
        <td class="number">${text(formatDecimal(line.quantity))}</td><td>${text(line.unit)}</td>
        <td class="number">${line.unitPrice === null ? '未設定' : text(formatDecimal(String(line.unitPrice)))}</td>
        <td class="number">${money(totals.amounts[index])}</td><td>${wideNote ? '備考は直下に記載' : text(line.note)}</td>
      </tr>${wideNote ? `<tr class="line-note"><td colspan="9"><strong>上記明細の備考</strong><p>${text(line.note)}</p></td></tr>` : ''}`
        })
        .join('')
      return `<table class="detail-table">
      ${columns([13, 7, 17, 17, 8, 5, 9, 10, 14])}
      <thead>
        <tr class="detail-heading"><th colspan="9"><div class="detail-title"><span>内訳明細書</span><span>第${doc.revision}版</span></div><p>工事名：${text(b.title)}</p><p>${sectionIndex + 1}. ${text(section.name)}</p></th></tr>
        <tr>${['部屋', '部位', '仕上げ・明細', '仕様・規格', '数量', '単位', '単価（円）', '金額（円）', '備考'].map((label) => `<th>${label}</th>`).join('')}</tr>
      </thead>
      <tbody>${rows}<tr class="section-total"><td colspan="7">${text(section.name)} 小計</td><td class="number">${money(section.amount)}</td><td></td></tr></tbody>
    </table>`
    })
    .join('')
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
  <title>${text(b.title)} 第${doc.revision}版</title>
  <style>
    @page { size: A4 landscape; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #202a25; font-family: 'Yu Gothic', 'Meiryo', 'Hiragino Kaku Gothic ProN', sans-serif; font-size: 10pt; line-height: 1.5; }
    h1 { font-size: 24pt; text-align: center; font-weight: 500; letter-spacing: .24em; margin: 0 0 3mm; }
    .metadata { text-align: right; font-size: 9pt; margin-bottom: 3mm; }
    .metadata p { margin: 0; }
    .parties { display: flex; align-items: flex-start; gap: 14mm; margin-bottom: 4mm; }
    .client { flex: 1.3; min-width: 0; }
    .recipient { font-size: 14pt; padding-bottom: 2mm; border-bottom: 1px solid #667c6e; margin-bottom: 3mm; }
    .issuer { flex: 1; min-width: 0; font-size: 10pt; padding-top: 1mm; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .total { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; border-bottom: 2px solid #365c49; padding: 2mm 0; margin: 2mm 0; break-inside: avoid; }
    .total strong { font-size: 21pt; overflow-wrap: anywhere; }
    .notice { font-size: 9pt; margin: 2mm 0; }
    .subject { margin: 0 0 3mm; font-weight: 600; }
    .delivery { margin: 0 0 3mm; font-size: 9pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; line-height: 1.5; }
    thead { display: table-header-group; }
    th, td { border: .25mm solid #b0bcb4; padding: 1.8mm 1.5mm; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
    th { background: #edf2ee; color: #364d3e; text-align: left; font-weight: 500; }
    tr { break-inside: avoid; }
    .with-note { break-after: avoid; }
    .line-note p { margin: 1mm 0 0; }
    .line-note strong { font-weight: 500; color: #506c5c; }
    .number { text-align: right; font-variant-numeric: tabular-nums; }
    .section-total td { background: #f4f6f4; font-weight: 600; }
    .section-total td:first-child { text-align: right; }
    .end-total { display: flex; justify-content: flex-end; gap: 8mm; align-items: baseline; margin: 3mm 0; break-inside: avoid; }
    .end-total strong { font-size: 15pt; }
    h2 { font-size: 10pt; border-bottom: 1px solid #c5cec8; margin: 3mm 0 1.5mm; break-after: avoid; }
    .notes { margin: 0; font-size: 9pt; orphans: 3; widows: 3; }
    .detail-table { break-before: page; }
    .detail-heading th { background: white; color: #202a25; border: none; padding: 0 0 3mm; }
    .detail-title { display: flex; justify-content: space-between; align-items: baseline; gap: 5mm; font-size: 17pt; margin-bottom: 2mm; }
    .detail-title span:last-child { font-size: 9pt; }
    .detail-heading p { margin: 0; font-size: 10pt; }
    .detail-heading p:last-child { margin-top: 1mm; font-weight: 600; }
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
  <section class="cover">
    <h1>御見積書</h1>
    <div class="metadata"><p class="text">見積番号：${text(b.number || '未設定')}</p><p>見積日：${text(b.date.replaceAll('-', '/'))}　／　第${doc.revision}版</p></div>
    <div class="parties"><div class="client">
      <div class="recipient text">${text(b.recipient ? (/(御中|様|殿)$/.test(b.recipient) ? b.recipient : `${b.recipient} 御中`) : '宛先未設定')}</div>
      <p class="notice">下記のとおり、お見積り申し上げます。</p>
      <div class="total"><span>御見積金額</span><strong>${money(totals.subtotal)}${totals.subtotal === null ? '' : ' 円'}</strong></div>
    </div><div class="issuer text">${text(b.issuer)}</div></div>
    <p class="subject text">工事名：${text(b.title)}</p>
    ${b.delivery ? `<p class="delivery text">納期：${text(b.delivery)}</p>` : ''}
    ${totals.missingPrices ? `<p class="notice">単価未設定 ${totals.missingPrices}件のため金額は未確定です。単価設定済み分：${money(totals.knownSubtotal)} 円</p>` : ''}
    <table class="cover-table">${columns([5, 32, 25, 7, 5, 13, 13])}
      <thead><tr>${['No.', '工事区分', '仕様・規格', '数量', '単位', '単価（円）', '金額（円）'].map((label) => `<th>${label}</th>`).join('')}</tr></thead>
      <tbody>${coverRows}</tbody>
    </table>
    <div class="end-total">合計<strong>${money(totals.subtotal)}${totals.subtotal === null ? '' : ' 円'}</strong></div>
    ${b.conditions ? `<h2>取引条件</h2><p class="notes text">${text(b.conditions)}</p>` : ''}
    ${b.memo ? `<h2>備考</h2><p class="notes text">${text(b.memo)}</p>` : ''}
  </section>
  ${detailTables}
  </body></html>`
}
