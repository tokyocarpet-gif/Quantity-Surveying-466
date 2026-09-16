import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { PDFDocument } from 'pdf-lib'
import { emptyCompany } from '../src/shared/business'
import { Storage } from '../src/main/storage'
import { BASE_SQL } from '../src/main/schema'
import { TAKEOFF_SQL } from '../src/main/takeoff-storage'
import { MASTER_SQL } from '../src/main/master-storage'
import { TAKEOFF_EXTRAS_SQL } from '../src/main/takeoff-extras-schema'
import {
  estimateBodySchema,
  calculateEstimate,
  estimateSections,
  roundMoney
} from '../src/shared/estimate'
import { summaryRequestSchema } from '../src/shared/summary'
import { materialSpecification } from '../src/shared/materials'
import { summaryPrintHtml } from '../src/main/summary-print'
import { estimatePrintHtml } from '../src/main/estimate-print'
import { renderEstimateXlsx } from '../src/main/estimate-xlsx'
import { emptyFinishes } from '../src/shared/takeoff'
const body = () =>
  estimateBodySchema.parse({
    title: '工事',
    number: 'M-1',
    date: '2026-09-11',
    recipient: '顧客',
    issuer: '会社',
    conditions: '30日',
    memo: '',
    taxRate: 10,
    amountRounding: 'round',
    taxRounding: 'truncate',
    lines: [
      {
        id: randomUUID(),
        room: '会議室',
        category: 'floor',
        name: '床材',
        quantity: '12.3',
        unit: '㎡',
        unitPrice: 1000
      }
    ]
  })
test('見積は小数1桁の採用数量から金額と小計単位の税を計算し、丸め条件・負数を扱う', () => {
  const b = body()
  assert.deepEqual(calculateEstimate(b), {
    amounts: ['12300'],
    subtotal: '12300',
    knownSubtotal: '12300',
    tax: '1230',
    total: '13530',
    missingPrices: 0,
    negativeLines: 0
  })
  for (const [mode, pos, neg] of [
    ['round', 2n, -2n],
    ['truncate', 1n, -1n],
    ['away', 2n, -2n]
  ] as const) {
    assert.equal(roundMoney(15n, 10n, mode), pos)
    assert.equal(roundMoney(-15n, 10n, mode), neg)
  }
  b.lines[0].quantity = '0.1'
  b.lines[0].unitPrice = 15
  assert.equal(calculateEstimate(b).subtotal, '2')
  b.amountRounding = 'truncate'
  assert.equal(calculateEstimate(b).subtotal, '1')
  b.lines[0].quantity = '-0.1'
  assert.equal(calculateEstimate(b).subtotal, '-1')
  assert.equal(calculateEstimate(b).negativeLines, 1)
  b.lines[0].quantity = '1.0'
  b.lines[0].unitPrice = 105
  b.taxRounding = 'round'
  assert.equal(calculateEstimate(b).tax, '11')
  b.taxRounding = 'truncate'
  assert.equal(calculateEstimate(b).tax, '10')
  b.taxRate = 0
  assert.equal(calculateEstimate(b).total, '105')
  b.lines[0].quantity = '1000000000000.0'
  b.lines[0].unitPrice = 1000000000
  assert.equal(calculateEstimate(b).total, '1000000000000000000000')
})
test('単価未設定は0円と区別し、不正な日付・桁数・税率・重複IDを保存しない', () => {
  const b = body()
  b.lines[0].unitPrice = null
  assert.equal(calculateEstimate(b).total, null)
  assert.equal(calculateEstimate(b).tax, null)
  b.lines[0].unitPrice = 0
  assert.equal(calculateEstimate(b).total, '0')
  for (const patch of [
    { date: '2026-02-30' },
    { taxRate: -1 },
    { taxRate: 10.123 },
    { lines: [{ ...b.lines[0], quantity: '1.23' }] },
    { lines: [b.lines[0], b.lines[0]] },
    { lines: [] }
  ])
    assert.equal(estimateBodySchema.safeParse({ ...b, ...patch }).success, false)
})
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-estimate-')),
    storage = new Storage(join(folder, 'app'))
  const client = storage.createClient('顧客'),
    project = storage.createProject({
      clientId: client.id,
      name: '見積物件',
      memo: '',
      status: 'active'
    })
  const pdf = await PDFDocument.create()
  pdf.addPage([842, 595])
  const path = join(folder, '図面.pdf')
  writeFileSync(path, await pdf.save())
  const drawing = (await storage.importPdfs(project.id, [path])).imported[0],
    address = { drawingId: drawing.id, pageNumber: 1 }
  const polygon = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 }
  ]
  storage.applyTakeoff({
    ...address,
    expectedRevision: 0,
    change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }
  })
  const finishes = emptyFinishes()
  finishes.floor = { name: '床材', unitPrice: 1000 }
  storage.applyTakeoff({
    ...address,
    expectedRevision: 1,
    change: {
      kind: 'room',
      id: randomUUID(),
      input: {
        name: '会議室',
        polygon,
        color: '#327e6d',
        heightMm: 2400,
        finishes,
        sleeveWalls: [],
        enabledCategories: ['floor']
      }
    }
  })
  const request = summaryRequestSchema.parse({ projectId: project.id }),
    report = () => storage.readSummary(request)
  const create = () => {
    const r = report()
    return storage.createEstimate({ request, fingerprint: r.fingerprint })
  }
  return {
    folder,
    storage,
    client,
    project,
    drawing,
    address,
    report,
    create,
    cleanup() {
      storage.close()
      rmSync(folder, { recursive: true, force: true })
    }
  }
}
test('集計から小数1桁の見積を作り、保存ごとの版・元拾い独立・再生成・古い保存拒否を保持する', async () => {
  const f = await fixture()
  try {
    const state = f.storage.readTakeoff(f.address),
      floor = state.items[0]
    f.storage.applyTakeoff({
      ...f.address,
      expectedRevision: state.revision,
      change: { kind: 'fixed', itemId: floor.id, quantity: 12.349 }
    })
    const snapshot = f.storage.readTakeoff(f.address),
      first = f.create()
    assert.equal(first.body.lines[0].quantity, '12.3')
    assert.equal(first.totals.total, '12300')
    assert.equal(first.source.lines[0].quantity, '12.349')
    const second = f.storage.saveEstimate({
      id: first.id,
      expectedRevision: 1,
      body: {
        ...first.body,
        title: '編集した見積',
        taxRate: 0,
        lines: [{ ...first.body.lines[0], unitPrice: 2000 }]
      }
    })
    assert.equal(second.revision, 2)
    assert.equal(second.totals.total, '24600')
    assert.deepEqual(f.storage.readTakeoff(f.address), snapshot)
    assert.equal(f.storage.readEstimate({ id: first.id, revision: 1 }).body.title, first.body.title)
    assert.throws(
      () => f.storage.saveEstimate({ id: first.id, expectedRevision: 1, body: first.body }),
      /更新/
    )
    assert.equal(
      f.storage.saveEstimate({ id: first.id, expectedRevision: 2, body: second.body }).revision,
      2
    )
    const source = f.report()
    f.storage.editSummary({
      request: source.request,
      fingerprint: source.fingerprint,
      rowId: source.rows[0].id,
      finish: { name: '変更した拾い', unitPrice: 3000 }
    })
    assert.deepEqual(f.storage.readEstimate({ id: first.id }).body, second.body)
    const another = f.create()
    assert.notEqual(another.id, first.id)
    assert.equal(another.body.lines[0].unitPrice, 3000)
    assert.equal(f.storage.listEstimates(f.project.id).length, 2)
    f.storage.delete('drawings', f.drawing.id)
    assert.deepEqual(f.storage.readEstimate({ id: first.id }).body, second.body)
  } finally {
    f.cleanup()
  }
})
test('見積・過去の版・作成元をバックアップ復元と再起動で保持し、無効な版の復元を拒否する', async () => {
  const f = await fixture()
  try {
    const first = f.create(),
      second = f.storage.saveEstimate({
        id: first.id,
        expectedRevision: 1,
        body: {
          ...first.body,
          memo: '第2版',
          delivery: '9月末',
          lines: [{ ...first.body.lines[0], section: '販売センター', note: '新規ボード下地として' }]
        }
      })
    const backup = join(f.folder, 'estimates.sekisan-backup')
    await f.storage.createBackup(backup)
    f.storage.saveEstimate({
      id: first.id,
      expectedRevision: 2,
      body: { ...second.body, memo: '破棄' }
    })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.storage.readEstimate({ id: first.id }), second)
    f.storage.close()
    const reopened = new Storage(join(f.folder, 'app'))
    try {
      assert.deepEqual(reopened.readEstimate({ id: first.id }), second)
    } finally {
      reopened.close()
    }
    // Change a stored revision to an invalid quantity and recompute archive hashes, so validation must inspect data.
    const zip = new AdmZip(backup),
      dbPath = join(f.folder, 'bad.db')
    writeFileSync(dbPath, zip.readFile('db/sekisan-kanri.db')!)
    const db = new Database(dbPath)
    const invalid = { ...first.body, lines: [{ ...first.body.lines[0], quantity: '12.34' }] }
    db.prepare('UPDATE estimate_revisions SET body=? WHERE revision=1').run(JSON.stringify(invalid))
    db.close()
    const data = readFileSync(dbPath),
      manifest = JSON.parse(zip.readAsText('manifest.json'))
    const entry = manifest.files.find((e: { path: string }) => e.path === 'db/sekisan-kanri.db')
    entry.size = data.length
    entry.sha256 = createHash('sha256').update(data).digest('hex')
    zip.updateFile('db/sekisan-kanri.db', data)
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    const bad = join(f.folder, 'bad.sekisan-backup')
    zip.writeZip(bad)
    const safe = new Storage(join(f.folder, 'app'))
    try {
      await assert.rejects(() => safe.restoreBackup(bad))
      assert.deepEqual(safe.readEstimate({ id: first.id }), second)
    } finally {
      safe.close()
    }
  } finally {
    f.cleanup()
  }
})
test('v4からv8へ退避して移行し、旧バックアップを復元する', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-v5-')),
    root = join(folder, 'app')
  mkdirSync(join(root, 'data/db'), { recursive: true })
  const path = join(root, 'data/db/sekisan-kanri.db'),
    old = new Database(path)
  old.exec(BASE_SQL)
  old.exec(TAKEOFF_SQL)
  old.exec(MASTER_SQL)
  old.exec(TAKEOFF_EXTRAS_SQL)
  const id = randomUUID()
  old.prepare('INSERT INTO clients VALUES (?,?,?)').run(id, '旧顧客', new Date().toISOString())
  old.close()
  const data = readFileSync(path),
    zip = new AdmZip()
  zip.addFile('db/sekisan-kanri.db', data)
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        application: 'sekisan-kanri',
        formatVersion: 1,
        schemaVersion: 4,
        createdAt: new Date().toISOString(),
        files: [
          {
            path: 'db/sekisan-kanri.db',
            size: data.length,
            sha256: createHash('sha256').update(data).digest('hex')
          }
        ]
      })
    )
  )
  const backup = join(folder, 'v4.sekisan-backup')
  zip.writeZip(backup)
  const storage = new Storage(root)
  try {
    assert.equal(storage.workspace().clients[0].name, '旧顧客')
    assert.ok(readdirSync(join(root, 'recovery')).some((n) => n.startsWith('before-schema-v16-')))
    await storage.restoreBackup(backup)
    assert.equal(storage.workspace().clients[0].id, id)
    const db = new Database(path, { readonly: true })
    assert.equal(db.pragma('user_version', { simple: true }), 16)
    db.close()
  } finally {
    storage.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
test('見積作成・保存の途中失敗は書きかけを残さず、古い集計と範囲外の要求を拒否する', async () => {
  const f = await fixture()
  try {
    const report = f.report(),
      db = (f.storage as unknown as { db: Database.Database }).db
    db.exec(
      "CREATE TEMP TRIGGER fail_estimate BEFORE INSERT ON estimate_revisions BEGIN SELECT RAISE(ABORT,'injected failure'); END"
    )
    assert.throws(() => f.create(), /injected failure/)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM estimates').get() as { n: number }).n, 0)
    db.exec('DROP TRIGGER fail_estimate')
    const first = f.create()
    db.exec(
      "CREATE TEMP TRIGGER fail_save BEFORE INSERT ON estimate_revisions BEGIN SELECT RAISE(ABORT,'injected failure'); END"
    )
    assert.throws(
      () =>
        f.storage.saveEstimate({
          id: first.id,
          expectedRevision: 1,
          body: { ...first.body, memo: '失敗' }
        }),
      /injected failure/
    )
    assert.equal(f.storage.readEstimate({ id: first.id }).revision, 1)
    db.exec('DROP TRIGGER fail_save')
    const row = report.rows[0]
    f.storage.editSummary({
      request: report.request,
      fingerprint: report.fingerprint,
      rowId: row.id,
      finish: { name: '更新', unitPrice: 1 }
    })
    assert.throws(
      () => f.storage.createEstimate({ request: report.request, fingerprint: report.fingerprint }),
      /再集計/
    )
    assert.throws(() => f.storage.readEstimate({ id: randomUUID() }))
    assert.throws(() => f.storage.listEstimates(randomUUID()))
    f.storage.delete('projects', f.project.id)
    assert.throws(() => f.storage.readEstimate({ id: first.id }))
  } finally {
    f.cleanup()
  }
})

test('自社情報と仕様を見積に引き継ぎ、その後の変更から保存済み見積を保護する', async () => {
  const f = await fixture()
  try {
    f.storage.saveCompany({
      ...emptyCompany(),
      name: '施工会社',
      postalCode: '100-0001',
      address: '東京都',
      phone: '03-0000-0000',
      estimateValidity: '発行日から30日間',
      paymentTerms: '月末締め・翌月末払い',
      otherConditions: '工事日程は別途協議'
    })
    const specification = materialSpecification({
      specification: '仕'.repeat(240),
      tileWidthMm: 450,
      tileHeightMm: 900,
      tileThicknessMm: 2.5
    })
    let report = f.report()
    f.storage.editSummary({
      request: report.request,
      fingerprint: report.fingerprint,
      rowId: report.rows[0].id,
      finish: { name: '床材', specification, unitPrice: 1000 }
    })
    const state = f.storage.readTakeoff(f.address)
    assert.equal(state.rooms[0].finishes.floor.specification, specification)
    assert.equal(state.items[0].specification, specification)
    const first = f.create()
    assert.match(first.body.issuer, /施工会社\n〒100-0001\n東京都\nTEL 03-0000-0000/)
    assert.equal(first.body.lines[0].specification, specification)
    assert.equal(first.source.lines[0].specification, specification)
    assert.equal(f.report().rows[0].specification, specification)
    assert.ok(estimatePrintHtml(first).includes(specification))
    assert.ok(summaryPrintHtml(f.report(), emptyCompany(), '').includes(specification))
    const xml = new AdmZip(renderEstimateXlsx(first))
      .getEntry('xl/worksheets/sheet2.xml')!
      .getData()
      .toString('utf8')
    assert.ok(xml.includes('450×900×2.5 mm'))
    const backup = join(f.folder, 'combined.sekisan-backup')
    await f.storage.createBackup(backup)
    await f.storage.restoreBackup(backup)
    assert.equal(
      f.storage.readEstimate({ id: first.id }).body.lines[0].specification,
      specification
    )
    assert.equal(first.body.taxRate, 0)
    assert.equal(
      first.body.conditions,
      '有効期限：発行日から30日間\n支払条件：月末締め・翌月末払い\n工事日程は別途協議'
    )
    f.storage.saveCompany({ ...emptyCompany(), name: '新会社' })
    report = f.report()
    f.storage.editSummary({
      request: report.request,
      fingerprint: report.fingerprint,
      rowId: report.rows[0].id,
      finish: { name: '床材', specification: '別規格', unitPrice: 1000 }
    })
    assert.deepEqual(f.storage.readEstimate({ id: first.id }), first)
    const next = f.create()
    assert.equal(next.body.issuer, '新会社')
    assert.equal(next.body.conditions, '')
    assert.equal(next.body.lines[0].specification, '別規格')
    const legacy = f.storage.saveEstimate({
      id: first.id,
      expectedRevision: 1,
      body: { ...first.body, taxRate: 10 }
    })
    assert.equal(legacy.body.taxRate, 10)
    assert.equal(
      f.storage.listEstimates(f.project.id).find((e) => e.id === first.id)?.total,
      legacy.totals.subtotal
    )
  } finally {
    f.cleanup()
  }
})

test('工事区分の表紙金額は丸め済み明細から合算し、未設定・0円・控除を保つ', () => {
  const b = body(),
    line = b.lines[0]
  b.lines = [
    { ...line, section: '販売センター', quantity: '0.1', unitPrice: 15 },
    { ...line, id: randomUUID(), section: 'モデルルーム', unitPrice: null },
    { ...line, id: randomUUID(), section: '販売センター', quantity: '-0.1', unitPrice: 5 },
    { ...line, id: randomUUID(), section: '諸経費', quantity: '1.0', unitPrice: 0 },
    { ...line, id: randomUUID(), section: '', unitPrice: 1000 },
    { ...line, id: randomUUID(), section: '内装仕上工事', unitPrice: 1000 }
  ]
  assert.deepEqual(estimateSections(b), [
    { name: '販売センター', indexes: [0, 2], amount: '1' },
    { name: 'モデルルーム', indexes: [1], amount: null },
    { name: '諸経費', indexes: [3], amount: '0' },
    { name: '内装仕上工事', indexes: [4, 5], amount: '24600' }
  ])
  b.lines[1].unitPrice = 1000
  assert.equal(
    estimateSections(b)
      .reduce((sum, s) => sum + BigInt(s.amount!), 0n)
      .toString(),
    calculateEstimate(b).subtotal
  )
})

test('旧見積の追加項目は空欄で読み、無変更保存で版を増やさず元のJSONも保持する', async () => {
  const f = await fixture()
  try {
    const first = f.create()
    const legacy = JSON.parse(JSON.stringify(first.body))
    delete legacy.delivery
    for (const l of legacy.lines) {
      delete l.section
      delete l.note
    }
    const db = (f.storage as unknown as { db: Database.Database }).db
    const raw = JSON.stringify(legacy)
    db.prepare('UPDATE estimate_revisions SET body=? WHERE estimateId=?').run(raw, first.id)
    const loaded = f.storage.readEstimate({ id: first.id })
    assert.equal(loaded.body.delivery, '')
    assert.equal(loaded.body.lines[0].section, '')
    assert.equal(loaded.body.lines[0].note, '')
    assert.equal(
      f.storage.saveEstimate({ id: first.id, expectedRevision: 1, body: loaded.body }).revision,
      1
    )
    assert.equal(
      (
        db.prepare('SELECT body FROM estimate_revisions WHERE estimateId=?').get(first.id) as {
          body: string
        }
      ).body,
      raw
    )
    for (const patch of [
      { delivery: '長'.repeat(201) },
      { lines: [{ ...loaded.body.lines[0], section: '長'.repeat(121) }] },
      { lines: [{ ...loaded.body.lines[0], note: '長'.repeat(501) }] }
    ])
      assert.equal(estimateBodySchema.safeParse({ ...loaded.body, ...patch }).success, false)
  } finally {
    f.cleanup()
  }
})
