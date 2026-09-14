import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { Storage } from '../src/main/storage'
import { categories, emptyFinishes, type TakeoffChange } from '../src/shared/takeoff'
import {
  aggregateSummary,
  summaryRequestSchema,
  summaryViews,
  quantityMilli,
  displayQuantity,
  lineAmount,
  summaryCsv,
  type SummarySource,
  type SummaryReport
} from '../src/shared/summary'
const projectId = randomUUID(),
  drawingId = randomUUID(),
  groupId = randomUUID()
const request = summaryRequestSchema.parse({ projectId })
function source(overrides: Partial<SummarySource> = {}): SummarySource {
  return {
    id: randomUUID(),
    roomId: randomUUID(),
    groupId,
    roomName: '会議室',
    roomOrdinal: 1,
    partNumber: 1,
    drawingId,
    drawingName: '平面図.pdf',
    pageNumber: 1,
    category: 'floor',
    unit: '㎡',
    finish: 'タイル',
    unitPrice: 100,
    rawQuantity: 12,
    rawDeduction: 0,
    rawNet: 12,
    fixed: false,
    source: 'auto-room',
    ...overrides
  }
}
test('集計は統合範囲を合算し、同名の別室・ページ・部位・仕様・単価を区別する', () => {
  for (const view of summaryViews) {
    const report = aggregateSummary(
      [
        source(),
        source({ specification: '' }),
        source({ specification: '500×500' }),
        source({ specification: '600×600' })
      ],
      { ...request, view }
    )
    assert.equal(report.rows.length, 3)
    assert.equal(report.rows.find((r) => r.specification === '')?.quantity, '24.000')
    assert.equal(report.rows.find((r) => r.specification === '500×500')?.quantity, '12.000')
  }
  const sources = [
    source(),
    source({ partNumber: 2 }),
    source({ groupId: randomUUID(), roomOrdinal: 2 }),
    source({ groupId: randomUUID(), pageNumber: 2 }),
    source({ unitPrice: 200 }),
    source({ category: 'baseboard', unit: 'm' })
  ]
  const byRoom = aggregateSummary(sources, request)
  assert.equal(byRoom.rows.length, 5)
  assert.equal(byRoom.rows.find((r) => r.sourceIds.length === 2)!.quantity, '24.000')
  assert.equal(byRoom.roomCount, 3)
  const finish = aggregateSummary(sources, { ...request, view: 'finish' })
  assert.equal(finish.rows.length, 3)
  assert.equal(finish.rows.find((r) => r.sourceIds.length === 4)!.quantity, '48.000')
  for (const view of summaryViews) {
    const r = aggregateSummary(sources, { ...request, view })
    assert.deepEqual(r.totals, byRoom.totals)
    assert.equal(r.amount, byRoom.amount)
  }
})
test('未設定単価と0円を区別し、合計が正でも負の元明細を検出する', () => {
  const sources = [
    source({ unitPrice: null }),
    source({ unitPrice: 0 }),
    source({ rawNet: -2, rawDeduction: 14 }),
    source({ finish: '' })
  ]
  const r = aggregateSummary(sources, request)
  assert.equal(r.amount, null)
  assert.equal(r.knownAmount, '1000')
  assert.equal(r.missingPriceCount, 1)
  assert.equal(r.negativeCount, 1)
  assert.equal(r.missingFinishCount, 1)
  assert.equal(r.rows.find((r) => r.unitPrice === 0)!.amount, '0')
  for (const issue of ['missing-price', 'negative', 'missing-finish'] as const)
    assert.equal(aggregateSummary(sources, { ...request, issue }).lines.length, 1)
})
test('図面・ページ・部屋・部位・全半角検索の条件を同時に適用する', () => {
  const other = randomUUID(),
    sources = [
      source({ finish: 'タイル ＡＢＣ' }),
      source({ pageNumber: 2 }),
      source({ drawingId: other }),
      source({ groupId: other })
    ]
  const r = aggregateSummary(sources, {
    ...request,
    drawingId,
    pageNumber: 1,
    groupId,
    category: 'floor',
    query: 'abc'
  })
  assert.equal(r.lines.length, 1)
  assert.equal(r.totalItemCount, 4)
  assert.equal(aggregateSummary(sources, { ...request, query: '該当なし' }).knownAmount, '0')
  assert.equal(summaryRequestSchema.safeParse({ projectId, pageNumber: 2 }).success, false)
})
test('数量3桁と円の四捨五入は負数・小数単価・大きい金額でも表示形式で変化しない', () => {
  assert.equal(quantityMilli(1.2345), 1235n)
  assert.equal(quantityMilli(-1.2345), -1235n)
  assert.equal(lineAmount(1000n, 1.5), 2n)
  assert.equal(lineAmount(-1000n, 1.5), -2n)
  assert.equal(lineAmount(100000n, 1.005), 101n)
  assert.equal(lineAmount(1000n, null), null)
  const r = aggregateSummary([source({ rawNet: 999999999.999, unitPrice: 999999999 })], request)
  assert.equal(r.amount, '999999998999000000')
  const halves = [source({ rawNet: 0.005 }), source({ rawNet: 0.005 })]
  for (const view of summaryViews)
    assert.equal(
      aggregateSummary(halves, { ...request, view }).amount,
      '2',
      'round each original item before summing'
    )
})
test('CSVはBOM・CRLF・引用符を保ち、文字列の式実行を防ぎ、数値と未設定を区別する', () => {
  const r: SummaryReport = {
    request,
    projectName: '=悪意,\"物件\"',
    clientName: '顧客',
    drawings: [],
    rooms: [],
    ...aggregateSummary(
      [source({ finish: '@式', unitPrice: null }), source({ unitPrice: 0, rawNet: -1 })],
      request
    ),
    fingerprint: '0'.repeat(64),
    generatedAt: '2026-09-10T00:00:00Z'
  }
  const csv = summaryCsv(r)
  assert.ok(csv.startsWith('\ufeff'))
  assert.ok(csv.endsWith('\r\n'))
  assert.ok(csv.includes('"\'=悪意,""物件"""'))
  assert.ok(csv.includes('"\'@式"'))
  assert.ok(csv.includes(',-1.0,"㎡",0,0,'))
  assert.ok(csv.includes(',12.0,"㎡",,,1,'))
  assert.ok(csv.includes('全図面 / 全ページ / 全部屋 / 全部位'))
  assert.ok(csv.includes(r.generatedAt))
})
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-summary-')),
    storage = new Storage(join(folder, 'app'))
  const client = storage.createClient('顧客'),
    project = storage.createProject({
      clientId: client.id,
      name: '集計物件',
      memo: '',
      status: 'active'
    })
  const pdf = await PDFDocument.create()
  pdf.addPage([842, 595])
  pdf.addPage([842, 595])
  const path = join(folder, '図面.pdf')
  writeFileSync(path, await pdf.save())
  const drawing = (await storage.importPdfs(project.id, [path])).imported[0]
  const read = (pageNumber = 1) => storage.readTakeoff({ drawingId: drawing.id, pageNumber })
  const apply = (change: TakeoffChange, pageNumber = 1) =>
    storage.applyTakeoff({
      drawingId: drawing.id,
      pageNumber,
      expectedRevision: read(pageNumber).revision,
      change
    })
  const polygon = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 }
  ]
  const finishes = emptyFinishes()
  finishes.floor = { name: '床材', unitPrice: 4500 }
  const input = {
    name: '会議室',
    heightMm: 2400,
    color: '#327e6d',
    polygon,
    finishes,
    enabledCategories: [...categories],
    sleeveWalls: [
      {
        id: randomUUID(),
        name: '袖壁',
        points: [
          { x: 100, y: 200 },
          { x: 300, y: 200 }
        ] as [{ x: number; y: number }, { x: number; y: number }],
        faces: 2 as const,
        heightMm: null,
        includeBaseboard: true
      }
    ]
  }
  for (const page of [1, 2]) {
    apply({ kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }, page)
    apply({ kind: 'room', id: randomUUID(), input, duplicateChoice: 'separate' }, page)
  }
  const req = summaryRequestSchema.parse({ projectId: project.id })
  return {
    folder,
    storage,
    drawing,
    read,
    apply,
    input,
    req,
    cleanup() {
      storage.close()
      rmSync(folder, { recursive: true, force: true })
    }
  }
}
test('保存データの集計は全ページ・袖壁・固定数量・控除を反映し、元データを変更しない', async () => {
  const f = await fixture()
  try {
    const floor = f.read().items.find((i) => i.category === 'floor')!,
      wall = f.read().items.find((i) => i.category === 'wall')!
    f.apply({ kind: 'fixed', itemId: floor.id, quantity: 15 })
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: '開口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    const before = f.read(),
      r = f.storage.readSummary(f.req)
    assert.equal(r.roomCount, 2)
    assert.equal(r.lines.length, 8)
    assert.equal(r.knownAmount, '121500')
    assert.equal(r.totals.find((t) => t.category === 'wall')!.quantity, '84.600')
    assert.equal(r.totals.find((t) => t.category === 'baseboard')!.quantity, '36.000')
    assert.equal(r.lines.find((l) => l.id === floor.id)!.fixed, true)
    assert.deepEqual(f.read(), before)
    assert.equal(f.storage.readSummary(f.req).fingerprint, r.fingerprint)
    const backup = join(f.folder, 'test.sekisan-backup')
    await f.storage.createBackup(backup)
    f.apply({ kind: 'deleteRoom', id: before.rooms[0].id })
    assert.notEqual(f.storage.readSummary(f.req).fingerprint, r.fingerprint)
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.storage.readSummary(f.req).rows, r.rows)
    for (const invalid of [
      { projectId: randomUUID() },
      { drawingId: randomUUID() },
      { drawingId: f.drawing.id, pageNumber: 3 },
      { groupId: randomUUID() }
    ])
      assert.throws(() => f.storage.readSummary({ ...f.req, ...invalid }))
  } finally {
    f.cleanup()
  }
})
test('集計CSVは表示条件で保存し、古い集計の上書きとアプリデータ内への保存を拒否する', async () => {
  const f = await fixture()
  try {
    const req = { ...f.req, category: 'floor' as const, pageNumber: 2, drawingId: f.drawing.id },
      report = f.storage.readSummary(req)
    const path = join(f.folder, '集計.csv')
    f.storage.exportSummary({ request: req, fingerprint: report.fingerprint }, path)
    const before = readFileSync(path, 'utf8')
    assert.equal(before.split('\r\n').length, 3)
    assert.ok(before.includes('12.0,"㎡",4500,54000'))
    const floor = f.read(2).items.find((i) => i.category === 'floor')!
    f.apply({ kind: 'fixed', itemId: floor.id, quantity: 20 }, 2)
    assert.throws(
      () => f.storage.exportSummary({ request: req, fingerprint: report.fingerprint }, path),
      /再集計/
    )
    assert.equal(readFileSync(path, 'utf8'), before)
    const updated = f.storage.readSummary(req),
      data = { request: req, fingerprint: updated.fingerprint }
    assert.throws(
      () => f.storage.exportSummary(data, join(f.folder, 'app', 'data', 'oops.csv')),
      /保存先以外/
    )
    assert.throws(() => f.storage.exportSummary(data, join(f.folder, '集計.db')), /csv/)
    f.storage.exportSummary(data, path)
    assert.ok(readFileSync(path, 'utf8').includes('90000'))
    assert.ok(!readdirSync(f.folder).some((n) => n.includes('.tmp-')))
  } finally {
    f.cleanup()
  }
})

test('集計行の編集は同じ行の統合範囲だけに反映し、数量・控除・別室・他ページと再計算を保つ', async () => {
  const f = await fixture()
  try {
    const room = f.read().rooms[0]
    f.apply({ kind: 'room', id: randomUUID(), input: f.input, mergeInto: room.id })
    const separate = randomUUID()
    f.apply({ kind: 'room', id: separate, input: f.input, duplicateChoice: 'separate' })
    const wall = f.read().items.find((i) => i.roomId === room.id && i.category === 'wall')!
    f.apply({ kind: 'fixed', itemId: wall.id, quantity: 50 })
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: 'ドア', widthMm: 900, heightMm: 2000, count: 1 }
    })
    const before = f.read(),
      otherPage = f.read(2),
      masters = f.storage.readMaterials(f.req.projectId)
    const report = f.storage.readSummary(f.req),
      row = report.rows.find((r) => r.category === 'wall' && r.sourceIds.length === 2)!
    assert.equal(row.roomLabel, '会議室')
    assert.equal(
      report.rows.filter((r) => r.category === 'wall').length,
      3,
      '同名でも別登録と別ページは区別'
    )
    const edit = {
      request: f.req,
      fingerprint: report.fingerprint,
      rowId: row.id,
      finish: { name: '変更したクロス', unitPrice: 2500 }
    }
    const updated = f.storage.editSummary(edit)
    assert.deepEqual(updated.totals, report.totals)
    const after = f.read()
    assert.equal(after.revision, before.revision + 1)
    assert.deepEqual(after.deductions, before.deductions)
    for (const item of after.items) {
      const previous = before.items.find((i) => i.id === item.id)!
      assert.deepEqual(
        item,
        row.sourceIds.includes(item.id)
          ? { ...previous, finish: edit.finish.name, unitPrice: 2500 }
          : previous
      )
    }
    for (const r of after.rooms) {
      const previous = before.rooms.find((a) => a.id === r.id)!
      assert.deepEqual(
        r,
        r.groupId === room.groupId
          ? { ...previous, finishes: { ...previous.finishes, wall: edit.finish } }
          : previous
      )
    }
    assert.deepEqual(f.read(2), otherPage)
    assert.deepEqual(f.storage.readMaterials(f.req.projectId), masters)
    assert.throws(() =>
      f.storage.applyTakeoff({
        drawingId: f.drawing.id,
        pageNumber: 1,
        expectedRevision: before.revision,
        change: { kind: 'fixed', itemId: wall.id, quantity: 55 }
      })
    )
    f.apply({ kind: 'scale', points: [f.input.polygon[0], f.input.polygon[1]], lengthMm: 8000 })
    assert.equal(f.read().items.find((i) => i.id === wall.id)!.finish, '変更したクロス')
    assert.equal(f.read().items.find((i) => i.id === wall.id)!.unitPrice, 2500)
    const backup = join(f.folder, 'edited.sekisan-backup')
    await f.storage.createBackup(backup)
    const saved = f.read()
    f.apply({ kind: 'deleteRoom', id: room.id })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.read(), saved)
  } finally {
    f.cleanup()
  }
})

test('古い集計・範囲外の行・無効単価を拒否し、途中失敗を全明細と部屋の設定ごと巻き戻す', async () => {
  const f = await fixture()
  try {
    f.apply({ kind: 'room', id: randomUUID(), input: f.input, mergeInto: f.read().rooms[0].id })
    const request = { ...f.req, drawingId: f.drawing.id, pageNumber: 1, category: 'floor' as const }
    const r = f.storage.readSummary(request),
      row = r.rows[0]
    const input = {
      request,
      fingerprint: r.fingerprint,
      rowId: row.id,
      finish: { name: '新しい床', unitPrice: 0 }
    }
    const before = f.read()
    const other = f.storage.readSummary({ ...request, pageNumber: 2 }).rows[0]
    assert.throws(() => f.storage.editSummary({ ...input, rowId: other.id }), /見つかりません/)
    assert.throws(() => f.storage.editSummary({ ...input, finish: { name: '床', unitPrice: -1 } }))
    assert.throws(
      () => f.storage.editSummary({ ...input, request: { ...request, view: 'finish' } }),
      /部屋×仕上げ/
    )
    const db = (f.storage as unknown as { db: import('better-sqlite3').Database }).db
    db.exec(
      "CREATE TEMP TRIGGER fail_summary BEFORE UPDATE OF finishes ON rooms BEGIN SELECT RAISE(ABORT,'injected failure'); END"
    )
    assert.throws(() => f.storage.editSummary(input), /injected failure/)
    assert.deepEqual(f.read(), before)
    db.exec('DROP TRIGGER fail_summary')
    const zero = f.storage.editSummary(input)
    assert.equal(zero.rows[0].amount, '0')
    assert.equal(zero.missingPriceCount, 0)
    assert.throws(() => f.storage.editSummary(input), /再集計/)
    const unset = f.storage.editSummary({
      ...input,
      fingerprint: zero.fingerprint,
      rowId: zero.rows[0].id,
      finish: { name: '新しい床', unitPrice: null }
    })
    assert.equal(unset.rows[0].amount, null)
    assert.equal(unset.missingPriceCount, 2)
  } finally {
    f.cleanup()
  }
})

test('数量表示は小数1桁に四捨五入し、内部の計算数量・金額を変えない', () => {
  for (const [value, expected] of [
    ['12.349', '12.3'],
    ['12.350', '12.4'],
    ['-12.350', '-12.4'],
    ['0.049', '0.0'],
    ['-0.049', '0.0'],
    ['15.000', '15.0'],
    ['999999999999999.950', '1000000000000000.0']
  ])
    assert.equal(displayQuantity(value), expected)
  const r = aggregateSummary([source({ rawNet: 12.349, unitPrice: 1000 })], request)
  assert.equal(r.lines[0].quantity, '12.349')
  assert.equal(r.amount, '12349')
})
