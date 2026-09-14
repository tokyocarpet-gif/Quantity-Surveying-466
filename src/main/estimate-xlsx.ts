import AdmZip from 'adm-zip'
import { calculateEstimate, estimateSections, type EstimateDoc } from '../shared/estimate'
import { partLabel } from '../shared/materials'
import { estimatePdfName } from './estimate-print'
import { styleIds, xlsxStyles } from './estimate-xlsx-styles'

// OOXML packaging runs locally on Windows and Mac, without Excel or a template path.
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const widths = [4, 22, 10, 22, 23, 10, 6, 12, 14, 23]
const pageHeight = 550
const escape = (v: string): string =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
    )
type Style = keyof typeof styleIds
type Cell = {
  col: number
  value: string | number | null
  style?: Style
  span?: number
  formula?: string
}
type Row = { cells: Cell[]; height: number }
type Sheet = { rows: Row[]; breaks: number[] }
const col = (n: number): string => String.fromCharCode(64 + n)
const cell = (
  c: number,
  value: Cell['value'],
  style: Style = 'text',
  span = 1,
  formula?: string
): Cell => ({ col: c, value, style, span, formula })
const row = (cells: Cell[], height = 22): Row => ({ cells, height })
const whole = (text: string, height = 24, style: Style = 'plain'): Row =>
  row([cell(1, text, style, 10)], height)

/** Conservative CJK wrapping also accounts for explicit newlines and narrow ASCII columns. */
function wrap(text: string, capacity: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let current = '',
      used = 0
    for (const char of paragraph) {
      const size = /[\u0020-\u007e]/.test(char) ? 1 : 2
      if (used + size > capacity) {
        lines.push(current)
        current = ''
        used = 0
      }
      current += char
      used += size
    }
    lines.push(current)
  }
  return lines
}
const textHeight = (text: string, capacity: number): number => 8 + wrap(text, capacity).length * 15
function wideRows(label: string, text: string, style: Style = 'plain'): Row[] {
  const lines = wrap(text, 136),
    rows: Row[] = []
  for (let i = 0; i < lines.length; i += 6)
    rows.push(
      whole(
        `${wrap(label + (i ? '（続き）' : ''), 136).join('\n')}\n${lines.slice(i, i + 6).join('\n')}`,
        9 + (Math.min(6, lines.length - i) + wrap(label + (i ? '（続き）' : ''), 136).length) * 15,
        style
      )
    )
  return rows
}
function safeNumber(value: string | number, label: string): number {
  const number = Number(value)
  // Excel numbers have 15 significant digits. Reject precision loss instead of changing an estimate.
  if (
    !Number.isFinite(number) ||
    Number(number.toPrecision(15)) !== number ||
    String(value)
      .replace(/[-.]/g, '')
      .replace(/^0+|0+$/g, '').length > 15
  )
    throw new Error(`${label}がExcelで正確に扱える桁数を超えています。PDFで出力してください。`)
  return number
}
function xmlSheet(sheet: Sheet): string {
  const merges: string[] = []
  const rows = sheet.rows
    .map((r, i) => {
      const n = i + 1
      const cells = r.cells
        .flatMap((c) => {
          const address = `${col(c.col)}${n}`,
            span = c.span ?? 1
          if (span > 1) merges.push(`${address}:${col(c.col + span - 1)}${n}`)
          const style =
            styleIds[
              c.style === 'money' && typeof c.value === 'number' && !Number.isInteger(c.value)
                ? 'price'
                : (c.style ?? 'plain')
            ]
          const numeric = typeof c.value === 'number'
          const contents = c.formula
            ? `<f>${escape(c.formula)}</f><v>${escape(String(c.value ?? ''))}</v>`
            : numeric
              ? `<v>${c.value}</v>`
              : c.value === null
                ? ''
                : `<is><t xml:space="preserve">${escape(String(c.value))}</t></is>`
          const type = c.formula
            ? numeric
              ? ''
              : ' t="str"'
            : numeric || c.value === null
              ? ''
              : ' t="inlineStr"'
          return [
            `<c r="${address}" s="${style}"${type}>${contents}</c>`,
            ...Array.from(
              { length: span - 1 },
              (_, j) => `<c r="${col(c.col + j + 1)}${n}" s="${style}"/>`
            )
          ]
        })
        .join('')
      return `<row r="${n}" ht="${r.height}" customHeight="1">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="0"/></sheetPr><dimension ref="A1:J${sheet.rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.3" bottom="0.4" header="0.1" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" scale="95" useFirstPageNumber="0"/><headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter>${sheet.breaks.length ? `<rowBreaks count="${sheet.breaks.length}" manualBreakCount="${sheet.breaks.length}">${sheet.breaks.map((n) => `<brk id="${n}" max="16383" man="1"/>`).join('')}</rowBreaks>` : ''}</worksheet>`
}

type Block = { row: Row; room: string; lineIndex: number; amount?: boolean; extra?: boolean }
export interface EstimateWorkbookLayout {
  cover: Sheet
  detail: Sheet
  detailPages: {
    section: string
    rooms: string[]
    indexes: number[]
    startRow: number
    endRow: number
    height: number
  }[]
}

export function estimateWorkbookLayout(doc: EstimateDoc): EstimateWorkbookLayout {
  const b = doc.body,
    totals = calculateEstimate(b),
    sections = estimateSections(b)
  const detail: Sheet = { rows: [], breaks: [] },
    cover: Sheet = { rows: [], breaks: [] }
  const detailPages: EstimateWorkbookLayout['detailPages'] = []
  const subtotalAddresses: string[] = []
  const number = (v: string | null): number | string =>
    v === null ? '未確定' : safeNumber(v, '金額')
  const header = (section: string, index: number): Row[] => [
    whole('内訳明細書', 28, 'heading'),
    whole(`工事名：${b.title}`, textHeight(b.title, 130)),
    whole(`${index + 1}. ${section}`, 12 + wrap(section, 100).length * 19, 'heading'),
    row(
      [
        'No.',
        '部屋',
        '部位',
        '仕上げ・明細',
        '仕様・規格',
        '数量',
        '単位',
        '単価（円）',
        '金額（円）',
        '備考'
      ].map((s, i) => cell(i + 1, s, 'column')),
      24
    )
  ]
  let serial = 0
  sections.forEach((section, sectionIndex) => {
    const rooms = new Map<string, number[]>()
    section.indexes.forEach((i) => {
      const room = b.lines[i].room || '共通・その他'
      rooms.set(room, [...(rooms.get(room) ?? []), i])
    })
    const blocks: Block[] = []
    for (const [room, indexes] of rooms)
      for (const i of indexes) {
        const l = b.lines[i],
          extras: Row[] = []
        const part = partLabel(l.category)
        const shorten = (label: string, value: string, limit: number): string => {
          if (value.length <= limit && value.split('\n').length <= 5) return value
          extras.push(...wideRows(`${l.name || '明細'} / ${label}`, value, 'text'))
          return '詳細は下段に記載'
        }
        const values: (string | number | null)[] = [
          ++serial,
          '',
          shorten('部位', part, 40),
          l.name,
          shorten('仕様・規格', l.specification, 120),
          safeNumber(l.quantity, '数量'),
          l.unit,
          l.unitPrice === null ? null : safeNumber(l.unitPrice, '単価'),
          number(totals.amounts[i]),
          shorten('備考', l.note, 100)
        ]
        const height = Math.max(
          23,
          ...values.map((v, j) => textHeight(v == null ? '' : String(v), widths[j] - 2))
        )
        blocks.push({
          room,
          lineIndex: i,
          amount: true,
          row: row(
            values.map((v, j) =>
              cell(j + 1, v, j === 5 ? 'quantity' : j === 7 || j === 8 ? 'money' : 'text')
            ),
            height
          )
        })
        extras.forEach((r) => blocks.push({ room, lineIndex: i, extra: true, row: r }))
      }
    const pageHeader = header(section.name, sectionIndex),
      headerHeight = pageHeader.reduce((s, r) => s + r.height, 0)
    const capacity = pageHeight - headerHeight
    // Minimize page count first, then balance unused space. Prefer breaks between rooms.
    const cost = Array(blocks.length + 1).fill(Infinity),
      next = Array(blocks.length).fill(-1)
    cost[blocks.length] = 0
    for (let start = blocks.length - 1; start >= 0; start--) {
      let height = 0,
        previousRoom = ''
      for (let end = start; end < blocks.length; end++) {
        const block = blocks[end]
        if (block.room !== previousRoom) {
          height += textHeight(block.room + '（続き）', 125)
          previousRoom = block.room
        }
        height += block.row.height
        const used = height + (end === blocks.length - 1 ? 26 : 0)
        if (used > capacity) break
        const penalty =
          end + 1 < blocks.length && blocks[end + 1].room === block.room
            ? blocks[end + 1].extra
              ? 40000
              : 8000
            : 0
        const score = 1e8 + (capacity - used) ** 2 + penalty + cost[end + 1]
        if (score < cost[start]) {
          cost[start] = score
          next[start] = end + 1
        }
      }
    }
    if (!Number.isFinite(cost[0]))
      throw new Error('1行の文字量が多いためExcel帳票に収まりません。明細を分けてください。')
    const firstRow = detail.rows.length + 1
    for (let start = 0; start < blocks.length;) {
      const end = next[start],
        startRow = detail.rows.length + 1
      if (detail.rows.length) detail.breaks.push(detail.rows.length)
      detail.rows.push(...pageHeader)
      let previousRoom = '',
        used = headerHeight
      const pageRooms: string[] = [],
        pageIndexes: number[] = []
      for (let i = start; i < end; i++) {
        const block = blocks[i]
        if (previousRoom !== block.room) {
          const continued = i === start && start > 0 && blocks[start - 1].room === block.room
          const r = whole(
            `${block.room}${continued ? '（続き）' : ''}`,
            textHeight(block.room + '（続き）', 125),
            'room'
          )
          detail.rows.push(r)
          used += r.height
          previousRoom = block.room
          pageRooms.push(block.room)
        }
        const r = { ...block.row, cells: block.row.cells.map((c) => ({ ...c })) }
        if (block.amount) {
          const n = detail.rows.length + 1,
            amountCell = r.cells[8]
          const fn = { round: 'ROUND', truncate: 'ROUNDDOWN', away: 'ROUNDUP' }[b.amountRounding]
          amountCell.formula = `IF(COUNT(F${n},H${n})=2,${fn}(ROUND(F${n},1)*H${n},0),"未確定")`
          pageIndexes.push(block.lineIndex)
        }
        detail.rows.push(r)
        used += r.height
      }
      if (end === blocks.length) {
        const last = detail.rows.length,
          n = last + 1
        const formula = `IF(COUNT(I${firstRow}:I${last})=COUNT(F${firstRow}:F${last}),SUM(I${firstRow}:I${last}),"未確定")`
        detail.rows.push(
          row(
            [
              cell(1, `${section.name} 小計`, 'subtotal', 8),
              cell(9, number(section.amount), 'subtotal', 1, formula),
              cell(10, '', 'subtotal')
            ],
            26
          )
        )
        used += 26
        subtotalAddresses.push(`'内訳明細'!I${n}`)
      }
      if (pageHeight - used > 0) detail.rows.push(whole('', pageHeight - used))
      detailPages.push({
        section: section.name,
        rooms: pageRooms,
        indexes: pageIndexes,
        startRow,
        endRow: detail.rows.length,
        height: pageHeight
      })
      start = end
    }
  })

  let coverHeight = 0
  const coverHeader = (): void => {
    if (cover.rows.length) cover.breaks.push(cover.rows.length)
    const title = whole(cover.rows.length ? '御見積書（続き）' : '御見積書', 38, 'title')
    cover.rows.push(
      title,
      whole(`見積番号：${b.number}　見積日：${b.date}　第${doc.revision}版`, 20, 'meta')
    )
    coverHeight = 58
  }
  const pushCover = (r: Row): number => {
    if (coverHeight + r.height > pageHeight) {
      if (coverHeight < pageHeight) cover.rows.push(whole('', pageHeight - coverHeight))
      coverHeader()
    }
    cover.rows.push(r)
    coverHeight += r.height
    return cover.rows.length
  }
  coverHeader()
  const recipient = b.recipient
    ? /(?:御中|様|殿)$/.test(b.recipient)
      ? b.recipient
      : `${b.recipient} 御中`
    : '宛先未設定'
  const left = wrap(recipient, 68),
    right = wrap(b.issuer, 66)
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    pushCover(
      row([cell(1, left[i] ?? '', 'recipient', 5), cell(6, right[i] ?? '', 'plain', 5)], 22)
    )
  const totalRow = pushCover(
    row(
      [
        cell(1, '御見積金額', 'heading', 3),
        cell(4, number(totals.subtotal), 'total', 4),
        cell(8, '円', 'plain')
      ],
      36
    )
  )
  pushCover(whole('下記のとおり、お見積り申し上げます。', 22))
  for (const r of wideRows('工事名', b.title)) pushCover(r)
  if (b.delivery) for (const r of wideRows('納期', b.delivery)) pushCover(r)
  const columnRow = row(
    [
      cell(1, 'No.', 'column'),
      cell(2, '品名・大項目', 'column', 3),
      cell(5, '仕様・規格', 'column'),
      cell(6, '数量', 'column'),
      cell(7, '単位', 'column'),
      cell(8, '単価（円）', 'column'),
      cell(9, '金額（円）', 'column'),
      cell(10, '備考', 'column')
    ],
    24
  )
  pushCover(columnRow)
  const amountRows: number[] = []
  sections.forEach((s, i) => {
    const height = Math.max(24, textHeight(s.name, 50))
    if (coverHeight + height + 26 > pageHeight) {
      cover.rows.push(whole('', pageHeight - coverHeight))
      coverHeader()
      pushCover(columnRow)
    }
    const n = cover.rows.length + 1
    amountRows.push(
      pushCover(
        row(
          [
            cell(1, i + 1),
            cell(2, s.name, 'text', 3),
            cell(5, '別紙内訳書通り'),
            cell(6, 1, 'quantity'),
            cell(7, '式'),
            cell(8, number(s.amount), 'money', 1, subtotalAddresses[i]),
            cell(9, number(s.amount), 'money', 1, `IF(ISNUMBER(H${n}),F${n}*H${n},"未確定")`),
            cell(10, '')
          ],
          height
        )
      )
    )
  })
  // Link the headline to this total, and this total only to cover amounts (never to both detail and subtotals).
  const first = amountRows[0],
    last = amountRows.at(-1)!
  const grand = pushCover(
    row(
      [
        cell(1, '合計', 'subtotal', 8),
        cell(
          9,
          number(totals.subtotal),
          'subtotal',
          2,
          `IF(COUNT(I${first}:I${last})=COUNT(F${first}:F${last}),SUM(I${first}:I${last}),"未確定")`
        )
      ],
      26
    )
  )
  cover.rows[totalRow - 1].cells[1].formula = `I${grand}`
  if (b.conditions) for (const r of wideRows('取引条件', b.conditions)) pushCover(r)
  if (b.memo) for (const r of wideRows('備考', b.memo)) pushCover(r)
  return { cover, detail, detailPages }
}

export function estimateXlsxName(doc: EstimateDoc): string {
  return estimatePdfName(doc).replace(/\.pdf$/, '.xlsx')
}
export function renderEstimateXlsx(doc: EstimateDoc): Buffer {
  const layout = estimateWorkbookLayout(doc),
    zip = new AdmZip()
  const add = (path: string, value: string): void => {
    zip.addFile(path, Buffer.from(value))
  }
  add(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  )
  add(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  )
  add(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  )
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="表紙" sheetId="1" r:id="rId1"/><sheet name="内訳明細" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'表紙'!$A$1:$J$${layout.cover.rows.length}</definedName><definedName name="_xlnm.Print_Area" localSheetId="1">'内訳明細'!$A$1:$J$${layout.detail.rows.length}</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
  )
  add('xl/styles.xml', xlsxStyles)
  add('xl/worksheets/sheet1.xml', xmlSheet(layout.cover))
  add('xl/worksheets/sheet2.xml', xmlSheet(layout.detail))
  return zip.toBuffer()
}
