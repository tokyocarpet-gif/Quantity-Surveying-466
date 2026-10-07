import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import {
  aggregateSummary,
  summaryRequestSchema,
  summaryViews,
  summaryXlsxExportSchema,
  type SummarySource,
  type SummaryReport
} from '../src/shared/summary'
import {
  renderSummaryXlsx,
  summaryWorkbookLayout,
  summaryTemplateBytes
} from '../src/main/summary-xlsx'
import { emptyCompany } from '../src/shared/business'
const projectId = randomUUID(),
  drawingId = randomUUID(),
  groupId = randomUUID()
function source(overrides: Partial<SummarySource> = {}): SummarySource {
  return {
    id: randomUUID(),
    roomId: randomUUID(),
    groupId,
    roomName: '会議室',
    roomOrdinal: 1,
    partNumber: 1,
    drawingId,
    drawingName: '平面図',
    pageNumber: 1,
    category: 'floor',
    unit: '㎡',
    finish: 'タイル',
    specification: '500×500×5 mm',
    unitPrice: 100,
    rawQuantity: 12.35,
    rawDeduction: 0,
    rawNet: 12.35,
    fixed: false,
    source: 'auto-room',
    ...overrides
  }
}
test('全表示形式から部屋別・部位順で転記し、採用数量は小数1位、空欄と0円を区別する', () => {
  const sources = [
    source(),
    source({ category: 'wall', rawNet: 0.01 }),
    source({ category: 'ceiling', unitPrice: 0 }),
    source({ category: 'baseboard', unit: 'm', unitPrice: null }),
    source({ rawNet: 0.1 }),
    source({ groupId: randomUUID(), rawNet: 1.05 })
  ]
  let expected: unknown
  for (const view of summaryViews) {
    const r = report(sources, view),
      before = JSON.stringify(r)
    const layout = summaryWorkbookLayout(r, '内装仕上工事')
    const values = layout.pages
      .flatMap((p) => p.entries)
      .filter((e) => e.quantity !== null)
      .map((e) => [e.part, e.quantity, e.price, e.amount])
    if (expected) assert.deepEqual(values, expected)
    else expected = values
    assert.deepEqual(values.slice(0, 4), [
      ['天井', 12.4, 0, 0],
      ['壁', 0, 100, 0],
      ['巾木', 12.4, null, null],
      ['床', 12.5, 100, 1250]
    ])
    assert.equal(values.length, 5)
    assert.equal(layout.total, null)
    assert.equal(layout.pages.length, 6)
    assert.equal(JSON.stringify(r), before)
  }
})

const tag = (xml: string, name: string): string | undefined =>
  xml.match(new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`))?.[0]
const geometry = (xml: string) => ({
  rows: Array.from(xml.matchAll(/<row\b[^>]*>/g), (m) => m[0]),
  styles: Array.from(xml.matchAll(/<c\b[^>]*\br="([^"]+)"[^>]*\bs="([^"]+)"/g), (m) => [
    m[1],
    m[2]
  ]),
  tags: [
    'cols',
    'mergeCells',
    'pageMargins',
    'pageSetup',
    'printOptions',
    'drawing',
    'dataValidations',
    'extLst'
  ].map((n) => tag(xml, n))
})
test('元Excelの全6ページ・3シートを残し、行高・列幅・書式・結合・用紙設定・マスタ・図形を維持する', () => {
  const template = summaryTemplateBytes(),
    zip = new AdmZip(template)
  const output = new AdmZip(renderSummaryXlsx(report([source()]), '内装仕上工事', emptyCompany()))
  for (const n of [1, 2])
    assert.deepEqual(
      geometry(output.readAsText(`xl/worksheets/sheet${n}.xml`)),
      geometry(zip.readAsText(`xl/worksheets/sheet${n}.xml`))
    )
  const changed = new Set([
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
    'xl/workbook.xml',
    'xl/calcChain.xml',
    'xl/_rels/workbook.xml.rels',
    '[Content_Types].xml'
  ])
  for (const entry of zip.getEntries())
    if (!changed.has(entry.entryName))
      assert.deepEqual(output.readFile(entry.entryName), entry.getData(), entry.entryName)
  assert.deepEqual(summaryTemplateBytes(), template, '元ファイルを更新しない')
  assert.ok(!output.getEntry('xl/calcChain.xml'))
  assert.ok(!output.readAsText('xl/_rels/workbook.xml.rels').includes('/calcChain'))
  assert.ok(!output.readAsText('[Content_Types].xml').includes('/calcChain.xml'))
  assert.match(output.readAsText('xl/workbook.xml'), /内訳書!\$A\$1:\$K\$150/)
  assert.match(output.readAsText('xl/worksheets/sheet2.xml'), /<row r="150"/)
  assert.match(
    output.readAsText('xl/worksheets/sheet1.xml'),
    /COUNT\(&apos;内訳書&apos;!F128:F149\)/,
    '空欄ページに後から入力しても表紙に含める'
  )
})
test('更新したひな形の列位置に転記し、表紙の文言・日付・自社情報・合計を合わせる', () => {
  const company = {
    ...emptyCompany(),
    name: '見本内装',
    postalCode: '100-0001',
    address: '東京都',
    phone: '03-1234-5678'
  }
  const zip = new AdmZip(renderSummaryXlsx(report([source()]), '内装工事', company))
  const cover = zip.readAsText('xl/worksheets/sheet1.xml')
  const detail = zip.readAsText('xl/worksheets/sheet2.xml')
  const at = (xml: string, address: string) =>
    xml.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?</c>`))?.[0] ?? ''
  for (const [address, text] of Object.entries({
    D22: '別紙内訳書通り',
    G22: '式',
    H14: '見本内装',
    H15: '〒100-0001',
    H16: '東京都',
    H17: 'TEL 03-1234-5678'
  }))
    assert.ok(at(cover, address).includes(text), address)
  assert.match(at(cover, 'I7'), /<v>46289<\/v>/)
  assert.match(at(cover, 'F22'), /<v>1<\/v>/)
  assert.match(at(cover, 'I22'), /ROUND\(F22\*H22,0\)/)
  assert.match(at(cover, 'C12'), /I33/)
  assert.ok(!cover.includes('内訳書による'))
  for (const [address, text] of Object.entries({
    B4: '会議室',
    C4: '床',
    D4: 'タイル',
    G4: '㎡',
    J1: '見本内装'
  }))
    assert.ok(at(detail, address).includes(text), address)
  assert.match(at(detail, 'F4'), /<v>12.4<\/v>/)
  assert.match(at(detail, 'H4'), /<v>100<\/v>/)
  assert.match(at(detail, 'I4'), /<v>1240<\/v>/)
  assert.match(at(detail, 'I25'), /SUM\(I3:I24\)/)
  for (const row of [1, 26, 51, 76, 101, 126])
    assert.match(at(detail, `C${row}`), /&apos;表紙&apos;!C15/)
  assert.ok(detail.indexOf('</headerFooter>') < detail.indexOf('<rowBreaks'))
  assert.match(detail, /<rowBreaks count="5" manualBreakCount="5">/)
  assert.match(detail, /<brk id="125" max="10" man="1"/)
})
test('長文は元の空欄行を使い、6ページを超えたときだけ同じ25行のページを追加する', () => {
  const input = report(
    Array.from({ length: 215 }, (_, i) =>
      source({ finish: `材料${i}`, specification: '', rawNet: 1.04 })
    )
  )
  const layout = summaryWorkbookLayout(input, '床仕上工事')
  assert.equal(layout.pages.length, 11)
  assert.equal(layout.total, 21500)
  const zip = new AdmZip(renderSummaryXlsx(input, '床仕上工事', emptyCompany()))
  const xml = zip.readAsText('xl/worksheets/sheet2.xml')
  assert.equal(Array.from(xml.matchAll(/<row\b/g)).length, 275)
  const rows = Array.from(xml.matchAll(/<row\b[^>]*\br="(\d+)"/g), (m) => Number(m[1]))
  assert.equal(new Set(rows).size, rows.length)
  assert.deepEqual(
    rows,
    [...rows].sort((a, b) => a - b)
  )
  const cells = Array.from(xml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"/g), (m) => m[1])
  assert.equal(new Set(cells).size, cells.length)
  assert.match(xml, /<mergeCell ref="I275:J275"/)
  assert.match(xml, /<brk id="250" max="10" man="1"/)
  assert.match(xml, /C253:C274/)
  assert.match(xml, /G253:G275/)
  assert.match(xml, /SUM\(I253:I274\)/)
  assert.match(zip.readAsText('xl/workbook.xml'), /内訳書!\$A\$1:\$K\$275/)
  assert.ok(!xml.includes('t="shared"'), 'コピー元の共有式を残さない')
  const before = geometry(new AdmZip(summaryTemplateBytes()).readAsText('xl/worksheets/sheet2.xml'))
  assert.deepEqual(geometry(xml).rows.slice(0, 150), before.rows.slice(0, 150))
  assert.deepEqual(
    geometry(xml).styles.filter((s) => Number(s[0].match(/\d+/)![0]) <= 150),
    before.styles.filter((s) => Number(s[0].match(/\d+/)![0]) <= 150)
  )
  const long = '長い仕様の確認。'.repeat(60)
  const longLayout = summaryWorkbookLayout(report([source({ specification: long })]), '工事')
  const entries = longLayout.pages.flatMap((p) => p.entries)
  assert.equal(entries.filter((e) => e.quantity !== null).length, 1)
  assert.ok(
    entries
      .map((e) => e.finish)
      .join('')
      .includes(long)
  )
  assert.equal(longLayout.pages.length, 6)
})
test('数式文字列を安全に転記し、負数量・0円・未設定単価を扱い、Excel精度の上限を検証する', () => {
  const r = report([
    source({ finish: '=HYPERLINK("bad") & <材料>', rawNet: -1.25 }),
    source({ category: 'wall', unitPrice: null }),
    source({ category: 'ceiling', unitPrice: 0 })
  ])
  const zip = new AdmZip(renderSummaryXlsx(r, '内装 <床>', emptyCompany()))
  const xml = zip.readAsText('xl/worksheets/sheet2.xml')
  assert.match(xml, /<v>-1.3<\/v>/)
  assert.match(xml, /<v>-130<\/v>/)
  assert.match(xml, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/)
  assert.match(xml, /&lt;材料&gt;/)
  assert.match(xml, /ROUND\(F\d+\*H\d+,0\)/)
  assert.throws(() =>
    summaryXlsxExportSchema.parse({ request: r.request, fingerprint: r.fingerprint, section: ' ' })
  )
  assert.throws(
    () => renderSummaryXlsx(report([source({ rawNet: 1234567890123456 })]), '工事', emptyCompany()),
    /桁数/
  )
  assert.throws(() => renderSummaryXlsx(report([]), '工事', emptyCompany()), /数量がありません/)
})
function report(
  sources: SummarySource[],
  view: (typeof summaryViews)[number] = 'room-finish'
): SummaryReport {
  const request = summaryRequestSchema.parse({ projectId, view })
  return {
    request,
    projectName: 'サンプル内装工事',
    clientName: '見本建設',
    drawings: [],
    rooms: [],
    ...aggregateSummary(sources, request),
    fingerprint: 'a'.repeat(64),
    generatedAt: '2026-09-24T00:00:00.000Z'
  }
}
