import { coverExtraLinesFor } from '../src/shared/estimate'
import { coverSummariesFor, editCoverSummary } from '../src/shared/estimate-cover'
import { withDetailSheets } from '../src/shared/estimate-pages'
import { estimatePrintHtml } from '../src/main/estimate-print'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  estimateBodySchema,
  calculateEstimate,
  estimateSections,
  estimatePdfSchema
} from '../src/shared/estimate'
import { blankEstimateLine, pasteEstimate, parseEstimateTsv } from '../src/shared/estimate-edit'
import { estimateSheets } from '../src/shared/estimate-layout'

const fixture = () =>
  estimateBodySchema.parse({
    title: '改修工事',
    number: 'M1',
    date: '2026-09-21',
    recipient: '顧客',
    issuer: '会社',
    conditions: '',
    memo: '',
    taxRate: 10,
    amountRounding: 'round',
    taxRounding: 'truncate',
    lines: Array.from({ length: 30 }, (_, i) => ({
      ...blankEstimateLine(randomUUID(), '内装', String(i + 1)),
      name: `品名${i + 1}`,
      unitPrice: 100,
      quantity: '2.0'
    }))
  })
test('表紙の選択上限、参照明細の除外、諸経費と税、出力対象を検証する', () => {
  const b = fixture()
  b.lines[29].unitPrice = null
  b.expenses = 50
  b.presentation = {
    mode: 'cover',
    coverLineIds: b.lines.slice(0, 12).map((l) => l.id),
    outputCover: true,
    outputDetail: false
  }
  assert.equal(calculateEstimate(b).subtotal, '2450')
  assert.equal(calculateEstimate(b).total, '2695')
  assert.equal(calculateEstimate(b).missingPrices, 0)
  assert.equal(estimateSections(b)[0].amount, '2400')
  assert.equal(estimateSheets(b, { cover: true, detail: false }).length, 1)
  assert.equal(
    estimateBodySchema.safeParse({
      ...b,
      presentation: { ...b.presentation, coverLineIds: b.lines.slice(0, 13).map((l) => l.id) }
    }).success,
    false
  )
  assert.equal(
    estimateBodySchema.safeParse({
      ...b,
      presentation: { ...b.presentation, coverLineIds: [randomUUID()] }
    }).success,
    false
  )
  assert.equal(
    estimatePdfSchema.safeParse({
      id: randomUUID(),
      revision: 1,
      output: { cover: false, detail: false }
    }).success,
    false
  )
  b.presentation.mode = 'detail'
  assert.equal(calculateEstimate(b).subtotal, null)
})
test('内訳は工事名ごとに改ページし全行を一度だけ載せ、各内訳書に小計を置く', () => {
  const b = fixture()
  b.lines[25].section = '別工事'
  const pages = estimateSheets(b, { cover: false, detail: true })
  assert.deepEqual(
    pages.map((p) => p.indexes.length),
    [23, 6, 1]
  )
  assert.equal(new Set(pages.flatMap((p) => p.indexes)).size, 30)
  assert.deepEqual(
    pages.map((p) => p.last),
    [true, true, true]
  )
})
test('Excel貼り付けを一括検証し、引用改行・0円・未設定を保持、金額列は計算する', () => {
  const b = fixture()
  const id = b.lines[0].id
  const next = pasteEstimate(
    b,
    id,
    'itemNo',
    '1-1\t壁紙\t"仕様\n2行目"\t12.34\t㎡\t1,500\t999\t"備考"\n2\t床材\t500角\t1\t式\t0\t999\t',
    randomUUID
  )
  assert.equal(next.lines[0].quantity, '12.3')
  assert.equal(next.lines[0].specification, '仕様\n2行目')
  assert.equal(calculateEstimate(next).amounts[0], '18450')
  assert.equal(next.lines[1].unitPrice, 0)
  assert.equal(b.lines[0].itemNo, '1')
  assert.throws(() =>
    pasteEstimate(b, id, 'quantity', '2\t㎡\t100\n数値でない\t㎡\t200', randomUUID)
  )
  assert.equal(b.lines[0].quantity, '2.0')
  assert.equal(pasteEstimate(b, id, 'unitPrice', '\n0', randomUUID).lines[0].unitPrice, null)
  assert.deepEqual(parseEstimateTsv('"a""b"\tc\r\n'), [['a"b', 'c']])
})
test('表紙への複数行貼り付けで12行を超えず、不正な明細を作らない', () => {
  const b = fixture()
  b.presentation = {
    mode: 'cover',
    coverLineIds: b.lines.slice(0, 12).map((l) => l.id),
    outputCover: true,
    outputDetail: false
  }
  assert.throws(
    () => pasteEstimate(b, b.lines[11].id, 'name', '一行目\n二行目', randomUUID),
    /12行/
  )
  assert.equal(b.lines.length, 30)
})

test('手動の内訳書を空のまま保持し、23行上限・所属・削除後の配置を守る', async () => {
  const { withDetailSheets, appendDetailSheet, putEstimateLine, removeEstimateLine } =
    await import('../src/shared/estimate-pages')
  const b = withDetailSheets(fixture()),
    first = b.detailSheets![0]
  assert.equal(first.lineIds.length, 23)
  assert.throws(() => putEstimateLine(b, blankEstimateLine(randomUUID()), first.id), /23行/)
  assert.throws(
    () => pasteEstimate(b, first.lineIds[22], 'name', '変更\nはみ出し', randomUUID),
    /23行/
  )
  const added = appendDetailSheet(b, randomUUID()),
    last = added.detailSheets!.at(-1)!
  assert.equal(estimateSheets(added).at(-1)!.indexes.length, 0)
  const line = blankEstimateLine(randomUUID(), '追加工事')
  const edited = putEstimateLine(added, line, last.id)
  assert.equal(edited.detailSheets!.length, 3)
  assert.deepEqual(edited.detailSheets!.at(-1)!.lineIds, [line.id])
  const deleted = removeEstimateLine(edited, line.id, () => blankEstimateLine(randomUUID()))
  assert.equal(deleted.detailSheets!.length, 3)
  assert.equal(deleted.detailSheets!.at(-1)!.lineIds.length, 0)
  assert.equal(deleted.lines.length, b.lines.length)
  const invalid = structuredClone(edited)
  invalid.detailSheets![0].lineIds[0] = line.id
  assert.equal(estimateBodySchema.safeParse(invalid).success, false)
})

test('長い仕様を入力しても明細の所属と固定23行の構成は変わらない', async () => {
  const { withDetailSheets } = await import('../src/shared/estimate-pages')
  const b = withDetailSheets(fixture())
  b.lines[0].specification = '長い仕様'.repeat(50)
  assert.deepEqual(
    estimateSheets(b, { cover: false, detail: true }).map((s) => s.indexes.length),
    [23, 7]
  )
})

test('表紙の大項目は続きの内訳を合算し、表示名・仕様・備考だけを編集する', () => {
  const original = withDetailSheets(fixture())
  original.expenses = 300
  assert.equal(original.detailSheets!.length, 2)
  assert.deepEqual(
    coverSummariesFor(original).map((r) => r.amount),
    ['6000']
  )
  const id = original.detailSheets![0].id
  let edited = editCoverSummary(original, id, 'name', '表紙用の工事名')
  edited = editCoverSummary(edited, id, 'specification', '下地処理を含む')
  edited = editCoverSummary(edited, id, 'note', '夜間施工')
  assert.deepEqual(edited.lines, original.lines)
  assert.deepEqual(edited.detailSheets, original.detailSheets)
  assert.deepEqual(calculateEstimate(edited), calculateEstimate(original))
  assert.equal(
    coverSummariesFor(estimateBodySchema.parse(JSON.parse(JSON.stringify(edited))))[0].name,
    '表紙用の工事名'
  )
  edited.lines[0].quantity = '-1.0'
  assert.equal(coverSummariesFor(edited)[0].amount, '5700')
  edited.lines[0].unitPrice = null
  assert.equal(coverSummariesFor(edited)[0].amount, null)
  assert.throws(() => editCoverSummary(edited, id, 'amount', '1'), /自動計算/)
  assert.throws(() => editCoverSummary(edited, randomUUID(), 'name', 'なし'), /内訳がありません/)
  assert.equal(original.coverSummaries, undefined)
  assert.equal(coverSummariesFor(original)[0].name, '内装')
})
test('表紙の大項目が12行を超えても欠落なく改ページし、明細転記モードを維持する', () => {
  const b = fixture()
  b.lines.forEach((l, i) => (l.section = `工事${i + 1}`))
  const body = withDetailSheets(b)
  const pages = estimateSheets(body, { cover: true, detail: false })
  assert.deepEqual(
    pages.map((s) => s.summaryIds!.length),
    [13, 13, 4]
  )
  assert.equal(new Set(pages.flatMap((s) => s.summaryIds!)).size, 30)
  const html = estimatePrintHtml({ body, revision: 1 } as any, { cover: true, detail: false })
  assert.equal((html.match(/data-testid="estimate-cover-summary"/g) ?? []).length, 30)
  assert.match(html, /御見積書（続き）/)
  body.presentation = {
    mode: 'cover',
    coverLineIds: [body.lines[0].id],
    outputCover: true,
    outputDetail: true
  }
  assert.equal(estimateSheets(body, { cover: true, detail: false }).length, 1)
  assert.equal(estimateSheets(body)[0].summaryIds, undefined)
})

test('自由行は旧諸経費を引き継ぎ、名称・数量・単価を編集しても二重加算しない', () => {
  const b = fixture()
  b.expenses = 500
  const extras = coverExtraLinesFor(b)
  assert.equal(extras[0].name, '諸経費')
  assert.equal(extras[0].unitPrice, 500)
  assert.equal(calculateEstimate(b).subtotal, '6500')
  b.coverExtras = [{ ...extras[0], name: '現場管理費', quantity: '2.0', unitPrice: 300 }]
  assert.equal(calculateEstimate(b).subtotal, '6600')
  b.coverExtras.push({
    ...extras[0],
    id: randomUUID(),
    name: '調整',
    quantity: '-1.0',
    unitPrice: 100
  })
  assert.equal(calculateEstimate(b).subtotal, '6500')
  assert.equal(calculateEstimate(b).negativeLines, 1)
  b.coverExtras[1].unitPrice = null
  assert.equal(calculateEstimate(b).subtotal, null)
  assert.equal(calculateEstimate(b).missingPrices, 1)
  b.coverExtras = []
  assert.equal(calculateEstimate(b).subtotal, '6000')
  const html = estimatePrintHtml({ body: b, revision: 1 } as any, { cover: true, detail: false })
  assert.doesNotMatch(html, />諸経費</)
  const restored = estimateBodySchema.parse(JSON.parse(JSON.stringify(b)))
  assert.deepEqual(restored.coverExtras, [])
})

test('税込・税抜の切替でも表紙13行とページ分けを保持し、税額は備考横に置く', () => {
  const b = fixture()
  b.lines.forEach((l, i) => (l.section = `工事${i + 1}`))
  const body = withDetailSheets(b)
  const before = calculateEstimate(body)
  const beforePages = estimateSheets(body, { cover: true, detail: false })
  body.taxDisplay = 'inclusive'
  let pages = estimateSheets(body, { cover: true, detail: false })
  assert.deepEqual(
    pages.map((p) => p.summaryIds!.length),
    [13, 13, 4]
  )
  assert.equal(new Set(pages.flatMap((p) => p.summaryIds!)).size, 30)
  assert.equal(pages.flatMap((p) => p.extraIds!).length, 1)
  assert.deepEqual(calculateEstimate(body), before)
  assert.deepEqual(pages, beforePages)
  body.presentation = {
    mode: 'cover',
    coverLineIds: body.lines.slice(0, 12).map((l) => l.id),
    outputCover: true,
    outputDetail: false
  }
  pages = estimateSheets(body, { cover: true, detail: false })
  assert.deepEqual(
    pages.map((p) => p.indexes.length),
    [12]
  )
  assert.deepEqual(
    pages.flatMap((p) => p.indexes),
    Array.from({ length: 12 }, (_, i) => i)
  )
  assert.equal(pages.flatMap((p) => p.extraIds!).length, 1)
  body.taxDisplay = 'exclusive'
  assert.equal(estimateSheets(body, { cover: true, detail: false }).length, 1)
})

test('表紙のみの自由行で計算・改ページし、内訳を再利用できる', () => {
  const original = fixture()
  const body = estimateBodySchema.parse({
    ...original,
    coverExtras: Array.from({ length: 14 }, (_, i) => ({
      ...blankEstimateLine(randomUUID()),
      name: `表紙${i + 1}`,
      quantity: '2.5',
      unitPrice: 100
    })),
    presentation: { mode: 'cover', coverLineIds: [], outputCover: true, outputDetail: false }
  })
  assert.equal(calculateEstimate(body).subtotal, '3500')
  assert.equal(calculateEstimate(body).total, '3850')
  assert.equal(estimateSections(body).length, 0)
  const sheets = estimateSheets(body)
  assert.equal(sheets.length, 2)
  assert.ok(sheets.every((s) => s.kind === 'cover'))
  assert.deepEqual(
    sheets.map((s) => s.extraIds?.length),
    [13, 1]
  )
  assert.deepEqual(body.lines, original.lines)
  const restored = estimateBodySchema.parse(JSON.parse(JSON.stringify(body)))
  restored.presentation!.mode = 'detail'
  assert.equal(calculateEstimate(restored).subtotal, '9500')
  body.coverExtras = []
  assert.equal(calculateEstimate(estimateBodySchema.parse(body)).subtotal, '0')
  assert.equal(estimateSheets(body).length, 1)
})
