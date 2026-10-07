import AdmZip from 'adm-zip'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  aggregateSummary,
  displayQuantity,
  lineAmount,
  quantityMilli,
  type SummaryReport
} from '../shared/summary'
import { partLabel } from '../shared/materials'
import type { Company } from '../shared/business'

const esc = (value: string): string =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
    )

// Only cell contents are changed. The original package retains its fonts,
// borders, row/column sizes, drawings, master lists and printer settings.
export function summaryTemplateBytes(): Buffer {
  const local = fileURLToPath(new URL('../../resources/templates/summary.xlsx', import.meta.url))
  const bundled = process.resourcesPath
    ? join(process.resourcesPath, 'templates', 'summary.xlsx')
    : local
  const path = existsSync(bundled) ? bundled : local
  if (!existsSync(path))
    throw new Error('Excelのひな形が見つかりません。アプリを再インストールしてください。')
  return readFileSync(path)
}

// The supplied October 2026 template contains six fixed 25-row detail pages.
const TEMPLATE_PAGES = 6
const PAGE_ROWS = 25

type Value = string | number | null
type Entry = {
  row: number
  room: string
  part: string
  finish: string
  unit: string
  note: string
  quantity: number | null
  price: number | null
  amount: number | null
}
type Page = {
  start: number
  end: number
  first: number
  last: number
  entries: Entry[]
  total: number | null
}

function number(value: string | number): number {
  const n = Number(value)
  if (
    !Number.isFinite(n) ||
    Number(n.toPrecision(15)) !== n ||
    String(value)
      .replace(/[-.]/g, '')
      .replace(/^0+|0+$/g, '').length > 15
  )
    throw new Error(
      '数量・単価・金額がExcelで正確に扱える桁数を超えています。出力対象を分けてください。'
    )
  return n
}
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '',
      used = 0
    for (const char of paragraph) {
      const size = /[\u0020-\u007e]/.test(char) ? 1 : 2
      if (used + size > width) {
        lines.push(line)
        line = ''
        used = 0
      }
      line += char
      used += size
    }
    lines.push(line)
  }
  return lines
}

export function summaryWorkbookLayout(report: SummaryReport, section: string) {
  const grouped = aggregateSummary(report.lines, { ...report.request, view: 'room-finish' }).rows
  if (!grouped.length) throw new Error('出力する数量がありません。')
  const order = ['ceiling', 'wall', 'baseboard', 'floor']
  const roomOrder = new Map<string, number>()
  for (const row of grouped)
    if (!roomOrder.has(row.sectionKey)) roomOrder.set(row.sectionKey, roomOrder.size)
  grouped.sort(
    (a, b) =>
      roomOrder.get(a.sectionKey)! - roomOrder.get(b.sectionKey)! ||
      (order.includes(a.category) ? order.indexOf(a.category) : 4) -
        (order.includes(b.category) ? order.indexOf(b.category) : 4) ||
      a.category.localeCompare(b.category, 'ja') ||
      a.finish.localeCompare(b.finish, 'ja') ||
      a.id.localeCompare(b.id)
  )

  const headings = wrap(section, 80)
  const pages: Page[] = []
  const makePage = (): Page => {
    const start = pages.length * PAGE_ROWS + 1
    const page: Page = {
      start,
      end: start + 24,
      first: start + 2,
      last: start + 23,
      entries: [],
      total: null
    }
    pages.push(page)
    return page
  }
  let page = makePage(),
    next = page.first + headings.length
  const roomKeys = new Map<string, Set<string>>()
  for (const row of grouped) {
    const keys = roomKeys.get(row.roomLabel) ?? new Set<string>()
    keys.add(row.sectionKey)
    roomKeys.set(row.roomLabel, keys)
  }
  for (const row of grouped) {
    const quantity = number(displayQuantity(row.quantity))
    const price = row.unitPrice === null ? null : number(row.unitPrice)
    const rawAmount = lineAmount(quantityMilli(quantity), price)
    const amount = rawAmount === null ? null : number(String(rawAmount))
    const names = wrap(row.roomLabel, 22),
      parts = wrap(partLabel(row.category), 8)
    const finishes = wrap([row.finish, row.specification].filter(Boolean).join('\n'), 32)
    const units = wrap(row.unit, 6),
      notes = wrap(roomKeys.get(row.roomLabel)!.size > 1 ? row.location : '', 16)
    const length = Math.max(names.length, parts.length, finishes.length, units.length, notes.length)
    // Keep a whole item on its page when it fits; long items use existing rows
    // on following pages with quantity and amount written only once.
    if (length <= 22 - headings.length && next + length - 1 > page.last) {
      page = makePage()
      next = page.first + headings.length
    }
    for (let i = 0; i < length; i++) {
      if (next > page.last) {
        page = makePage()
        next = page.first + headings.length
      }
      page.entries.push({
        row: next++,
        room: names[i] ?? '',
        part: parts[i] ?? '',
        finish: finishes[i] ?? '',
        unit: units[i] ?? '',
        note: notes[i] ?? '',
        quantity: i === 0 ? quantity : null,
        price: i === 0 ? price : null,
        amount: i === 0 ? amount : null
      })
    }
  }
  const usedPages = pages.length
  while (pages.length < TEMPLATE_PAGES) makePage()
  if (pages.length > 80)
    throw new Error('Excelの内訳が80ページを超えます。出力対象を分けてください。')
  for (const p of pages) {
    const items = p.entries.filter((e) => e.quantity !== null)
    p.total =
      !items.length || items.some((e) => e.amount === null)
        ? null
        : number(String(items.reduce((sum, e) => sum + BigInt(e.amount!), 0n)))
  }
  const entries = pages.flatMap((p) => p.entries).filter((e) => e.quantity !== null)
  const total = entries.some((e) => e.amount === null)
    ? null
    : number(String(entries.reduce((sum, e) => sum + BigInt(e.amount!), 0n)))
  return { pages, usedPages, headings, grouped, total }
}

function cell(xml: string, address: string, value: Value, formula?: string): string {
  const pattern = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`)
  let found = false
  const result = xml.replace(pattern, (original) => {
    found = true
    const attrs = original
      .match(/^<c\b([^>]*?)(?:\s*\/?>)/)![1]
      .replace(/\s+t="[^"]*"/g, '')
      .replace(/\/$/, '')
    const numeric = typeof value === 'number'
    const type = formula
      ? numeric
        ? ''
        : ' t="str"'
      : value === null || numeric
        ? ''
        : ' t="inlineStr"'
    const body = formula
      ? `<f>${esc(formula)}</f><v>${esc(String(value ?? ''))}</v>`
      : value === null
        ? ''
        : numeric
          ? `<v>${value}</v>`
          : `<is><t xml:space="preserve">${esc(value)}</t></is>`
    return `<c${attrs}${type}>${body}</c>`
  })
  if (!found) throw new Error(`Excelのひな形に転記先 ${address} がありません。`)
  return result
}
const amountFormula = (n: number): string => `IF(OR(F${n}="",H${n}=""),"",ROUND(F${n}*H${n},0))`
const sumFormula = (first: number, last: number): string =>
  `IF(COUNT(F${first}:F${last})=0,"",IF(COUNT(I${first}:I${last})=COUNT(F${first}:F${last}),SUM(I${first}:I${last}),""))`
const shiftRef = (ref: string, offset: number): string =>
  ref.replace(/([A-Z]+)(\d+)/g, (_, col, row) => `${col}${Number(row) + offset}`)

function extendDetail(original: string, count: number): string {
  const lastStart = (TEMPLATE_PAGES - 1) * PAGE_ROWS + 1
  const lastPage = Array.from(original.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g))
    .filter((m) => Number(m[1]) >= lastStart)
    .map((m) => m[0])
    .join('')
  const originalMerges = Array.from(original.matchAll(/<mergeCell ref="([^"]+)"\s*\/>/g)).filter(
    (m) => Number(m[1].match(/\d+/)![0]) >= lastStart
  )
  let rows = '',
    merges = ''
  for (let p = TEMPLATE_PAGES; p < count; p++) {
    const offset = (p - TEMPLATE_PAGES + 1) * PAGE_ROWS
    rows += lastPage.replace(/\br="([A-Z]*)(\d+)"/g, (_, c, r) => `r="${c}${Number(r) + offset}"`)
    merges += originalMerges.map((m) => `<mergeCell ref="${shiftRef(m[1], offset)}"/>`).join('')
  }
  let xml = original
  if (count > TEMPLATE_PAGES) {
    xml = xml
      .replace('</sheetData>', rows + '</sheetData>')
      .replace(/<dimension ref="A1:K\d+"\s*\/>/, `<dimension ref="A1:K${count * PAGE_ROWS}"/>`)
      .replace(
        /<mergeCells count="(\d+)">/,
        (_, n) =>
          `<mergeCells count="${Number(n) + originalMerges.length * (count - TEMPLATE_PAGES)}">`
      )
      .replace('</mergeCells>', merges + '</mergeCells>')
    // Extend the original dropdown ranges without changing their lists or IDs.
    const extendRanges = (ranges: string): string => {
      const tail = ranges.split(' ').filter((ref) => Number(ref.match(/\d+/)?.[0]) >= lastStart)
      return (
        ranges +
        Array.from({ length: count - TEMPLATE_PAGES }, (_, p) =>
          tail.map((ref) => ' ' + shiftRef(ref, (p + 1) * PAGE_ROWS)).join('')
        ).join('')
      )
    }
    xml = xml
      .replace(/\bsqref="([^"]+)"/g, (_, refs) => `sqref="${extendRanges(refs)}"`)
      .replace(
        /<xm:sqref>([^<]+)<\/xm:sqref>/g,
        (_, refs) => `<xm:sqref>${extendRanges(refs)}</xm:sqref>`
      )
  }
  // The reference only prints its first page. Include all retained pages and
  // keep each 25-row form together when Excel prints the exported workbook.
  const breaks = Array.from(
    { length: count - 1 },
    (_, p) => `<brk id="${(p + 1) * PAGE_ROWS}" max="10" man="1"/>`
  ).join('')
  const rowBreaks = `<rowBreaks count="${count - 1}" manualBreakCount="${count - 1}">${breaks}</rowBreaks>`
  return xml.replace(/(<headerFooter\b[^>]*(?:\/>|>[\s\S]*?<\/headerFooter>))/, '$1' + rowBreaks)
}

export function summaryXlsxName(report: SummaryReport): string {
  return `数量内訳_${Array.from(report.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'))
    .slice(0, 80)
    .join('')
    .replace(/[. ]+$/, '')}.xlsx`
}

export function renderSummaryXlsx(
  report: SummaryReport,
  section: string,
  company: Company
): Buffer {
  const layout = summaryWorkbookLayout(report, section)
  const zip = new AdmZip(summaryTemplateBytes())
  let detail = extendDetail(zip.readAsText('xl/worksheets/sheet2.xml'), layout.pages.length)
  for (const [index, page] of layout.pages.entries()) {
    detail = cell(detail, `C${page.start}`, report.projectName, "'表紙'!C15")
    if (company.name || index >= TEMPLATE_PAGES)
      detail = cell(
        detail,
        `J${page.start}`,
        `${company.name || '東京カーペット加工㈱'}　${index + 1}`
      )
    for (let r = page.first; r <= page.last; r++) {
      for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'K'])
        detail = cell(detail, `${col}${r}`, null)
      detail = cell(detail, `I${r}`, null, amountFormula(r))
    }
    if (index < layout.usedPages)
      for (const [i, heading] of layout.headings.entries())
        detail = cell(detail, `B${page.first + i}`, heading)
    for (const e of page.entries) {
      for (const [col, value] of Object.entries({
        B: e.room,
        C: e.part,
        D: e.finish,
        F: e.quantity,
        G: e.unit,
        H: e.price,
        K: e.note
      }))
        detail = cell(detail, `${col}${e.row}`, value === '' ? null : value)
      detail = cell(detail, `I${e.row}`, e.amount, amountFormula(e.row))
    }
    detail = cell(detail, `I${page.end}`, page.total, sumFormula(page.first, page.last))
  }
  let cover = zip.readAsText('xl/worksheets/sheet1.xml')
  const put = (address: string, value: Value, formula?: string): void => {
    cover = cell(cover, address, value, formula)
  }
  put('B7', report.clientName)
  put('C15', report.projectName)
  put('C17', section)
  const date = new Date(report.generatedAt)
  put(
    'I7',
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) /
      86400000
  )
  if (company.name) put('H14', company.name)
  if (company.postalCode) put('H15', `〒${company.postalCode}`)
  if (company.address) put('H16', company.address)
  if (company.phone || company.fax)
    put(
      'H17',
      [company.phone && `TEL ${company.phone}`, company.fax && `FAX ${company.fax}`]
        .filter(Boolean)
        .join('　')
    )
  if (company.estimateValidity) put('C18', company.estimateValidity)
  if (company.paymentTerms) put('C19', company.paymentTerms)
  for (let r = 22; r <= 32; r++) put(`I${r}`, r === 22 ? layout.total : null, amountFormula(r))
  put('B22', section)
  put('D22', '別紙内訳書通り')
  put('F22', 1)
  put('G22', '式')
  const refs = layout.pages.map((p) => `'内訳書'!I${p.end}`).join(',')
  // Include the retained blank pages as well, so subsequent Excel entry is
  // reflected in the cover and missing prices never yield a partial total.
  const complete = layout.pages
    .map((p) => `COUNT('内訳書'!F${p.first}:F${p.last})=COUNT('内訳書'!I${p.first}:I${p.last})`)
    .join(',')
  put('H22', layout.total, `IF(AND(${complete}),SUM(${refs}),"")`)
  put('B23', '諸経費')
  put('G23', '式')
  put('I33', layout.total, sumFormula(22, 32))
  put('C12', layout.total, 'IF(I33="","",I33)')
  const add = (path: string, value: string): void => {
    zip.updateFile(path, Buffer.from(value))
  }
  add('xl/worksheets/sheet1.xml', cover)
  add('xl/worksheets/sheet2.xml', detail)
  let workbook = zip
    .readAsText('xl/workbook.xml')
    .replace(/<calcPr\b[^>]*\/>/, '<calcPr fullCalcOnLoad="1" forceFullCalc="1"/>')
  workbook = workbook.replace(
    '内訳書!$A$1:$K$25',
    `内訳書!$A$1:$K$${layout.pages.length * PAGE_ROWS}`
  )
  add('xl/workbook.xml', workbook)
  zip.deleteFile('xl/calcChain.xml')
  add(
    'xl/_rels/workbook.xml.rels',
    zip
      .readAsText('xl/_rels/workbook.xml.rels')
      .replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, '')
  )
  add(
    '[Content_Types].xml',
    zip
      .readAsText('[Content_Types].xml')
      .replace(/<Override\b[^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/g, '')
  )
  return zip.toBuffer()
}
