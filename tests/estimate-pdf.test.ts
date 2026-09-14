import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { calculateEstimate, estimateBodySchema, type EstimateDoc } from '../src/shared/estimate'
import { estimatePrintHtml, estimatePdfName } from '../src/main/estimate-print'
import { savePdfFile } from '../src/main/export-file'

function document(): EstimateDoc {
  const body = estimateBodySchema.parse({
    title: '会議室改修',
    number: 'M-001',
    date: '2026-09-12',
    recipient: '発注会社',
    issuer: '施工会社',
    conditions: '発行から30日',
    memo: '',
    taxRate: 10,
    amountRounding: 'round',
    taxRounding: 'round',
    lines: [
      {
        id: randomUUID(),
        room: '会議室',
        category: 'floor',
        name: '床材',
        specification: '500×500',
        quantity: '12.3',
        unit: '㎡',
        unitPrice: 1000
      }
    ]
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

test('PDFのHTMLは見積の採用数量と明細合計を使い、税を加算せず未設定単価を区別する', () => {
  const doc = document()
  let html = estimatePrintHtml(doc)
  assert.match(html, /12,300/)
  assert.doesNotMatch(html, /13,530|消費税|税込/)
  assert.match(html, /12\.3/)
  assert.match(html, /500×500/)
  assert.match(html, /第2版/)
  assert.match(html, /A4 landscape/)
  assert.match(html, /内訳明細書/)
  assert.match(html, /別紙内訳書通り/)
  assert.match(html, /内装仕上工事 小計/)
  doc.body.lines[0].unitPrice = null
  html = estimatePrintHtml(doc)
  assert.match(html, /単価未設定 1件/)
  assert.match(html, /未確定/)
  doc.body.lines[0].unitPrice = 0
  assert.doesNotMatch(estimatePrintHtml(doc), /未確定/)
  doc.body.lines[0].unitPrice = 1000
  doc.body.lines[0].quantity = '-1.2'
  assert.match(estimatePrintHtml(doc), /-1,200/)
})

test('PDFの入力文字はHTMLとして実行せず、Windowsで使えるファイル名を作る', () => {
  const doc = document()
  doc.body.title = 'a/b:c*?"<>|'
  doc.body.lines[0].name = '<script>alert("x")</script>'
  doc.body.delivery = '<b>納期</b>'
  doc.body.lines[0].section = '<script>区分</script>'
  doc.body.lines[0].note = '<img src=note>下地条件'
  doc.body.issuer = '<img src="https://example.com/x">'
  const html = estimatePrintHtml(doc)
  assert.doesNotMatch(html, /<script>|<img /)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(estimatePdfName(doc), /[<>:"/\\|?*]/)
  assert.match(estimatePdfName(doc), /第2版\.pdf$/)
})

test('PDFの保存は内部データやシンボリックリンク先のデータを保護し、失敗時も既存ファイルを保持する', () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-export-')),
    root = join(folder, 'app')
  mkdirSync(root)
  const path = join(folder, '見積書.pdf'),
    bytes = Buffer.from('%PDF-1.7\npreview')
  try {
    writeFileSync(path, 'old')
    savePdfFile(path, bytes, root)
    assert.deepEqual(readFileSync(path), bytes)
    assert.throws(() => savePdfFile(join(root, 'data.pdf'), bytes, root), /データ保存先/)
    if (process.platform !== 'win32') {
      symlinkSync(root, join(folder, 'alias'), 'dir')
      assert.throws(() => savePdfFile(join(folder, 'alias/data.pdf'), bytes, root), /データ保存先/)
    }
    assert.throws(() => savePdfFile(join(folder, '見積.db'), bytes, root), /拡張子/)
    mkdirSync(join(folder, 'directory.pdf'))
    assert.throws(() => savePdfFile(join(folder, 'directory.pdf'), bytes, root))
    assert.ok(!readdirSync(folder).some((name) => name.includes('.tmp-')))
    assert.deepEqual(readFileSync(path), bytes)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
