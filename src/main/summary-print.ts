import { companyIssuer, type Company } from '../shared/business'
import { partLabel } from '../shared/materials'
import {
  formatDecimal,
  formatQuantity,
  summaryScope,
  summaryViewLabels,
  type SummaryReport
} from '../shared/summary'
import { escapeHtml as text } from './estimate-print'

export function summaryPdfName(report: SummaryReport): string {
  const name = Array.from(report.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'))
    .slice(0, 60)
    .join('')
    .replace(/[. ]+$/, '')
  return `集計積算書_${name || '案件'}_${summaryViewLabels[report.request.view]}.pdf`
}

export function summaryPrintHtml(
  report: SummaryReport,
  company: Company,
  assignee: string
): string {
  const money = (value: string | null): string =>
    value === null ? '未確定' : text(formatDecimal(value))
  const rows = report.rows
    .map(
      (
        row,
        i
      ) => `${row.section && row.sectionKey !== report.rows[i - 1]?.sectionKey ? `<tr class="section"><th colspan="10">${text(row.section)}</th></tr>` : ''}
    <tr><td>${text(row.roomLabel)}<small>${text(row.location)}</small></td>
    <td>${text(partLabel(row.category))}</td><td>${text(row.finish || '仕上げ未設定')}</td><td>${text(row.specification ?? '')}</td>
    <td class="number">${formatQuantity(row.gross)}</td><td class="number">${formatQuantity(row.deduction)}</td>
    <td class="number net">${formatQuantity(row.quantity)}${row.fixedCount ? `<small>固定 ${row.fixedCount}件</small>` : ''}${row.negativeCount ? `<small>負数 ${row.negativeCount}件</small>` : ''}</td>
    <td>${text(row.unit)}</td><td class="number">${row.unitPrice === null ? '未設定' : text(formatDecimal(String(row.unitPrice)))}</td><td class="number">${money(row.amount)}</td></tr>`
    )
    .join('')
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
    <title>集計積算書 ${text(report.projectName)}</title><style>
    @page { size: A4 landscape; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #233c30; font-family: 'Yu Gothic','Meiryo','Hiragino Kaku Gothic ProN',sans-serif; font-size: 9pt; line-height: 1.45; }
    h1 { font-size: 18pt; line-height: 1.2; font-weight: 500; margin: 0 0 2mm; letter-spacing: .15em; }
    h2 { font-size: 11pt; margin: 0 0 1mm; }
    p { margin: 0 0 1mm; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; margin-bottom: 2mm; }
    .header > div { min-width: 0; flex: 1; }
    .header .company { flex: 0 0 30%; font-size: 8pt; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .scope { border-block: 1px solid #9bb1a3; padding: 1mm 0; font-size: 8pt; margin-bottom: 2mm; }
    .totals { display: flex; flex-wrap: wrap; gap: 2mm; margin-bottom: 2mm; }
    .metric { flex: 1 0 30mm; background: #eff4f0; padding: 1.5mm 3mm; border: .25mm solid #d2dfd5; break-inside: avoid; overflow-wrap: anywhere; }
    .metric span { display: block; font-size: 8pt; }
    .metric strong { font-size: 12pt; }
    .amount { padding: 1mm 0; text-align: right; font-size: 11pt; margin-bottom: 2mm; break-inside: avoid; }
    .notice { font-size: 8pt; color: #655631; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 8pt; }
    thead { display: table-header-group; }
    th, td { border: .25mm solid #b7c7bc; padding: 1.5mm 1.3mm; text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
    th { background: #eaf0eb; font-weight: 500; }
    tr { break-inside: avoid; }
    .section { break-after: avoid; }
    .section th { background: #dce9e0; font-weight: 600; }
    .number { text-align: right; font-variant-numeric: tabular-nums; }
    .net { font-weight: 600; }
    small { display: block; font-size: 7pt; font-weight: 400; color: #637369; margin-top: 1mm; }
    .footnote { font-size: 7.5pt; margin-top: 3mm; }
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>
    <div class="header"><div><h1>集計積算書</h1><h2 class="text">${text(report.projectName)}</h2>
    <p class="text">顧客：${text(report.clientName)}${assignee ? `　／　案件担当：${text(assignee)}` : ''}</p>
    <p>作成日時：${text(new Date(report.generatedAt).toLocaleString('ja-JP'))}</p></div>
    <div class="company text">${text(companyIssuer(company))}</div></div>
    <div class="scope text">表示形式：${text(summaryViewLabels[report.request.view])}　／　対象：${text(summaryScope(report))}<br>${report.roomCount}部屋・${report.lines.length}/${report.totalItemCount}明細・${report.rows.length}集計行</div>
    <div class="totals">${report.totals.map((total) => `<div class="metric"><span>${text(partLabel(total.category))}</span><strong>${formatQuantity(total.quantity)}</strong> ${text(total.unit)}</div>`).join('')}</div>
    <div class="amount">参考金額合計：<strong>${money(report.amount)}${report.amount === null ? '' : ' 円'}</strong>${report.missingPriceCount ? `<p class="notice">単価未設定 ${report.missingPriceCount}件を除く参考金額：${money(report.knownAmount)} 円</p>` : ''}</div>
    ${report.negativeCount || report.missingFinishCount ? `<p class="notice">${report.negativeCount ? `負の数量 ${report.negativeCount}件　` : ''}${report.missingFinishCount ? `仕上げ未設定 ${report.missingFinishCount}件` : ''}</p>` : ''}
    <table><colgroup>${[16, 7, 17, 17, 7, 6, 8, 5, 8, 9].map((width) => `<col style="width:${width}%">`).join('')}</colgroup>
    <thead><tr>${['部屋・図面', '部位', '仕上げ', '仕様・規格', '元数量', '控除', '正味数量', '単位', '単価（円）', '参考金額（円）'].map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <p class="footnote">数量は小数1桁で表示。参考金額は元明細の小数3桁の数量×単価を円単位に丸めて合算しています。表示数量×単価と端数差が生じることがあります。固定数量は「固定」と表示し、異なる単位の数量は合算しません。</p>
    </body></html>`
}
