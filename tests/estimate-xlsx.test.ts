import { test } from 'node:test'
import { emptyCompany, companyIdentity, companyIssuer } from '../src/shared/business'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateBodySchema, calculateEstimate, type EstimateDoc } from '../src/shared/estimate'
import { estimateWorkbookLayout, renderEstimateXlsx } from '../src/main/estimate-xlsx'
import { saveReportFile } from '../src/main/export-file'

export function fixture(count = 1): EstimateDoc {
  const body = estimateBodySchema.parse({
    title: 'マンションギャラリー新設工事',
    number: 'M-100',
    date: '2026-09-12',
    recipient: '発注会社',
    issuer: '施工会社\n〒100-0001\n東京都千代田区\nTEL 03-0000-0000',
    delivery: '別途打合せの上決定',
    conditions: '有効期限：3ヶ月間\n支払条件：別途相談',
    memo: '日中工事として',
    taxRate: 10,
    amountRounding: 'round',
    taxRounding: 'truncate',
    lines: Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      section: '販売センター内装仕上工事',
      room: 'エントランス',
      category: 'wall',
      name: `明細${String(i + 1).padStart(3, '0')}`,
      specification: 'TH32054',
      note: '新規ボード下地として',
      quantity: '12.3',
      unit: '㎡',
      unitPrice: 1500
    }))
  })
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    revision: 2,
    latestRevision: 2,
    createdAt: '',
    savedAt: '',
    body,
    totals: calculateEstimate(body),
    versions: [],
    source: { scope: '', view: '', generatedAt: '', fingerprint: '', lines: [] }
  }
}

test('大項目と部屋でまとめ、ページの量を均等にし、部屋の続きと大項目を繰り返す', () => {
  const doc = fixture(31),
    layout = estimateWorkbookLayout(doc)
  assert.ok(layout.detailPages.length >= 2)
  const counts = layout.detailPages.map((p) => p.indexes.length)
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts))
  assert.deepEqual(
    layout.detailPages.flatMap((p) => p.indexes),
    Array.from({ length: 31 }, (_, i) => i)
  )
  for (const page of layout.detailPages) {
    const rows = layout.detail.rows.slice(page.startRow - 1, page.endRow)
    assert.equal(
      rows.reduce((s, r) => s + r.height, 0),
      550
    )
    assert.ok(rows.some((r) => r.cells[0]?.value === '1. 販売センター内装仕上工事'))
    assert.ok(rows.some((r) => String(r.cells[0]?.value).startsWith('エントランス')))
    assert.ok(page.indexes.length)
  }
  assert.ok(layout.detail.rows.some((r) => r.cells[0]?.value === 'エントランス（続き）'))
  assert.equal(layout.detail.breaks.length, layout.detailPages.length - 1)
})

test('異なる部屋と同名の大項目を混ぜず、小計と表紙は丸め済みの合計を一度だけ参照する', () => {
  const doc = fixture(4)
  doc.body.lines[0].room = 'A室'
  doc.body.lines[1].room = 'B室'
  doc.body.lines[2].room = 'A室'
  doc.body.lines[3].section = '諸経費'
  doc.body.lines[3].room = ''
  doc.body.lines[3].unitPrice = 0
  const layout = estimateWorkbookLayout(doc)
  assert.deepEqual(
    layout.detailPages.flatMap((p) => p.indexes),
    [0, 2, 1, 3]
  )
  const sums = layout.detail.rows
    .flatMap((r) => r.cells)
    .filter((c) => c.formula?.startsWith('IF(COUNT(I'))
  assert.deepEqual(
    sums.map((c) => c.value),
    [55350, 0]
  )
  assert.equal(
    layout.cover.rows.flatMap((r) => r.cells).filter((c) => c.formula?.startsWith("'内訳明細'!"))
      .length,
    2
  )
  const grand = layout.cover.rows
    .flatMap((r) => r.cells)
    .find((c) => c.formula?.startsWith('IF(COUNT(I'))
  assert.equal(grand?.value, 55350)
})

test('単価未設定・0円・負数量と各端数処理をExcel数式とキャッシュに反映する', () => {
  for (const [mode, fn, expected] of [
    ['round', 'ROUND', -2],
    ['truncate', 'ROUNDDOWN', -1],
    ['away', 'ROUNDUP', -2]
  ] as const) {
    const doc = fixture(3)
    doc.body.amountRounding = mode
    doc.body.lines[0].quantity = '-0.1'
    doc.body.lines[0].unitPrice = 15
    doc.body.lines[1].unitPrice = null
    doc.body.lines[2].unitPrice = 0
    const layout = estimateWorkbookLayout(doc)
    const cells = layout.detail.rows
      .flatMap((r) => r.cells)
      .filter((c) => c.formula?.startsWith('IF(COUNT(F'))
    assert.deepEqual(
      cells.map((c) => c.value),
      [expected, '未確定', 0]
    )
    assert.ok(cells.every((c) => c.formula?.includes(`${fn}(`)))
    assert.equal(
      layout.cover.rows.flatMap((r) => r.cells).find((c) => c.formula?.startsWith('IF(COUNT(I'))
        ?.value,
      '未確定'
    )
  }
})

test('長文は明細直下に展開し、文字を欠落させず複数ページへ配置する', () => {
  const doc = fixture(2)
  doc.body.lines[0].specification = '長い仕様'.repeat(40)
  doc.body.lines[0].note = '備考\n'.repeat(100).trim()
  const layout = estimateWorkbookLayout(doc)
  assert.ok(layout.detailPages.length > 1)
  assert.deepEqual(
    layout.detailPages.flatMap((p) => p.indexes),
    [0, 1]
  )
  const text = layout.detail.rows.flatMap((r) => r.cells.map((c) => String(c.value))).join('')
  assert.equal(text.split('長い仕様').length - 1, 40)
  assert.equal(
    layout.detail.rows
      .flatMap((r) =>
        r.cells.filter((c) => c.col === 1).flatMap((c) => String(c.value).split('\n'))
      )
      .filter((v) => v === '備考').length,
    100
  )
  assert.ok(layout.detail.rows.every((r) => r.height <= 550))
})

test('出力はマクロ・外部参照を含まず、任意の入力文字は数式ではなく文字として保存する', () => {
  const doc = fixture()
  doc.body.lines[0].name = '=HYPERLINK("https://example.com","x")<>&'
  const zip = new AdmZip(renderEstimateXlsx(doc)),
    names = zip.getEntries().map((e) => e.entryName)
  assert.equal(
    names.some((n) => /vba|externalLinks|calcChain/i.test(n)),
    false
  )
  const xml = zip.readAsText('xl/worksheets/sheet2.xml')
  assert.match(xml, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/)
  assert.match(xml, /&lt;&gt;&amp;/)
  assert.match(xml, /orientation="landscape"/)
  assert.match(zip.readAsText('xl/workbook.xml'), /_xlnm.Print_Area/)
  assert.doesNotMatch(xml, /消費税|税込/)
  doc.body.lines[0].unitPrice = 123.12345678901234
  assert.throws(() => renderEstimateXlsx(doc), /桁数/)
})

test('Excel保存も拡張子と内部データを検証し、既存ファイルを保護する', () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-xlsx-'))
  try {
    const path = join(folder, '見積.xlsx'),
      bytes = renderEstimateXlsx(fixture())
    writeFileSync(path, 'old')
    assert.throws(() => saveReportFile(path, bytes, folder, '.xlsx'), /データ保存先/)
    assert.equal(readFileSync(path, 'utf8'), 'old')
    assert.throws(() => saveReportFile(join(folder, '見積.pdf'), bytes, folder, '.xlsx'), /拡張子/)
    mkdirSync(join(folder, 'app'))
    saveReportFile(path, bytes, join(folder, 'app'), '.xlsx')
    assert.deepEqual(readFileSync(path), bytes)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('会社の許可・認定・会社名・連絡先を表紙へ出力し、会社名を大きくTEL/FAXを同じ行にする', () => {
  const doc = fixture()
  const company = companyIdentity({
    ...emptyCompany(),
    constructionLicense: '東京都知事許可（般2）第12226号',
    fireCertification: '消防庁認定第12703号',
    name: '東京カーペット加工 株式会社',
    postalCode: '130-0012',
    address: '東京都墨田区太平4-6-6',
    phone: '03-3625-4169',
    fax: '03-3626-2669'
  })
  Object.assign(doc.body, { issuerCompany: company, issuer: companyIssuer(company) })
  const rows = estimateWorkbookLayout(doc).cover.rows
  const companyCells = rows.flatMap((row) => row.cells.filter((c) => c.col === 6 && c.span === 5))
  assert.deepEqual(
    companyCells.slice(0, 6).map((c) => String(c.value).trim()),
    companyIssuer(company).split('\n')
  )
  assert.equal(companyCells[2].style, 'heading')
  assert.equal(companyCells[0].style, 'plain')
  const xml = new AdmZip(renderEstimateXlsx(doc))
    .getEntry('xl/worksheets/sheet1.xml')!
    .getData()
    .toString('utf8')
  assert.match(xml, /消防庁認定第12703号/)
  assert.match(xml, /TEL 03-3625-4169　FAX 03-3626-2669/)
})

test('転記した部屋名を品名、材料と規格を仕様欄へ出力する', () => {
  const doc = fixture()
  Object.assign(doc.body.lines[0], {
    name: '会議室',
    room: '会議室',
    specification: 'タイルカーペット',
    specification2: '500×500 mm',
    specification3: '防炎',
    manufacturer: 'メーカーA'
  })
  const layout = estimateWorkbookLayout(doc)
  const row = layout.detail.rows.find((r) =>
    r.cells.some((c) => c.col === 4 && c.value === '会議室')
  )!
  assert.ok(row)
  assert.equal(
    row.cells.find((c) => c.col === 5)?.value,
    'メーカーA　タイルカーペット　500×500 mm　防炎'
  )
  assert.equal(doc.body.lines[0].quantity, '12.3')
  assert.equal(doc.body.lines[0].unitPrice, 1500)
})
