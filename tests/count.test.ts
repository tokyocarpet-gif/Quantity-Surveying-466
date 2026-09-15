import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { Storage } from '../src/main/storage'
import { countInputSchema, emptyFinishes, type CountInput } from '../src/shared/takeoff'
import { summaryCsv, summaryRequestSchema } from '../src/shared/summary'

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-count-')),
    s = new Storage(join(root, 'app'))
  const c = s.createClient('顧客'),
    project = s.createProject({ clientId: c.id, name: '柱型拾い', memo: '', status: 'active' })
  const pdf = await PDFDocument.create()
  pdf.addPage([842, 595])
  pdf.addPage([842, 595])
  const path = join(root, '図面.pdf')
  writeFileSync(path, await pdf.save())
  const drawing = (await s.importPdfs(project.id, [path])).imported[0],
    address = { drawingId: drawing.id, pageNumber: 1 }
  const input: CountInput = {
    roomId: null,
    name: '柱型',
    category: '柱型',
    specification: '300×300',
    unit: '個',
    unitPrice: 2500,
    color: '#a06532',
    points: [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 }
    ]
  }
  return {
    s,
    root,
    project,
    drawing,
    address,
    input,
    cleanup() {
      s.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
test('個数は縮尺なしで保存・追加・点削除でき、古い更新と別ページの書換えを拒否する', async () => {
  const f = await fixture()
  try {
    const id = randomUUID(),
      mutation = {
        ...f.address,
        expectedRevision: 0,
        change: { kind: 'count', id, input: f.input }
      }
    const preview = f.s.previewTakeoff(mutation)
    assert.equal(preview.rows[0].after, 3)
    assert.equal(f.s.readTakeoff(f.address).counts?.length, 0)
    const first = f.s.applyTakeoff(mutation)
    assert.equal(first.scaleRatio, null)
    assert.equal(first.counts?.[0].points.length, 3)
    assert.throws(() => f.s.applyTakeoff(mutation), /更新/)
    assert.throws(() => f.s.applyTakeoff({ ...mutation, pageNumber: 2 }), /別ページ/)
    assert.throws(
      () =>
        f.s.applyTakeoff({
          ...mutation,
          expectedRevision: 1,
          change: { kind: 'count', id, input: { ...f.input, roomId: randomUUID() } }
        }),
      /部屋/
    )
    f.s.applyTakeoff({
      ...mutation,
      expectedRevision: 1,
      change: {
        kind: 'count',
        id,
        input: { ...f.input, points: [...f.input.points, { x: 400, y: 100 }] }
      }
    })
    f.s.applyTakeoff({
      ...mutation,
      expectedRevision: 2,
      change: { kind: 'count', id, input: { ...f.input, points: f.input.points.slice(1) } }
    })
    assert.equal(f.s.readTakeoff(f.address).counts?.[0].points.length, 2)
    const del = { ...f.address, expectedRevision: 3, change: { kind: 'deleteCount', id } }
    assert.equal(f.s.previewTakeoff(del).rows[0].after, null)
    assert.equal(f.s.readTakeoff(f.address).counts?.length, 1)
    f.s.applyTakeoff(del)
    assert.equal(f.s.readTakeoff(f.address).counts?.length, 0)
    for (const patch of [
      { points: [] },
      { unit: '㎡' },
      { unit: 'm' },
      { unitPrice: -1 },
      { points: [{ x: -1, y: 10 }] }
    ])
      assert.equal(countInputSchema.safeParse({ ...f.input, ...patch }).success, false)
  } finally {
    f.cleanup()
  }
})
test('個数の部屋関連は縮尺変更後も保持し、部屋削除では個数を残して未指定に戻す', async () => {
  const f = await fixture()
  try {
    const roomId = randomUUID(),
      id = randomUUID(),
      polygon = [
        { x: 10, y: 10 },
        { x: 100, y: 10 },
        { x: 100, y: 100 },
        { x: 10, y: 100 }
      ]
    f.s.applyTakeoff({
      ...f.address,
      expectedRevision: 0,
      change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 900 }
    })
    f.s.applyTakeoff({
      ...f.address,
      expectedRevision: 1,
      change: {
        kind: 'room',
        id: roomId,
        input: {
          name: '会議室',
          color: '#327e6d',
          heightMm: 2400,
          polygon,
          finishes: emptyFinishes()
        }
      }
    })
    f.s.applyTakeoff({
      ...f.address,
      expectedRevision: 2,
      change: { kind: 'count', id, input: { ...f.input, roomId } }
    })
    const before = f.s.readTakeoff(f.address).counts
    f.s.applyTakeoff({
      ...f.address,
      expectedRevision: 3,
      change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 1800 }
    })
    assert.deepEqual(f.s.readTakeoff(f.address).counts, before)
    f.s.applyTakeoff({
      ...f.address,
      expectedRevision: 4,
      change: { kind: 'deleteRoom', id: roomId }
    })
    const count = f.s.readTakeoff(f.address).counts![0]
    assert.equal(count.roomId, null)
    assert.equal(count.points.length, 3)
  } finally {
    f.cleanup()
  }
})
test('個数の集計は単位を混ぜず、仕様・単価編集、CSVと独立した見積に引き継ぐ', async () => {
  const f = await fixture()
  try {
    for (const [i, unit] of ['個', '本'].entries())
      f.s.applyTakeoff({
        ...f.address,
        expectedRevision: i,
        change: { kind: 'count', id: randomUUID(), input: { ...f.input, unit } }
      })
    const request = summaryRequestSchema.parse({ projectId: f.project.id, category: '柱型' })
    let report = f.s.readSummary(request)
    assert.equal(report.rows.length, 2)
    assert.equal(
      report.totals.find((t) => t.category === '柱型' && t.unit === '個')?.quantity,
      '3.000'
    )
    assert.equal(
      report.totals.find((t) => t.category === '柱型' && t.unit === '本')?.quantity,
      '3.000'
    )
    assert.equal(report.amount, '15000')
    assert.ok(summaryCsv(report).includes('300×300'))
    const estimate = f.s.createEstimate({ request, fingerprint: report.fingerprint })
    assert.equal(estimate.body.lines[0].quantity, '3.0')
    assert.equal(estimate.body.lines[0].specification, '300×300')
    report = f.s.editSummary({
      request,
      fingerprint: report.fingerprint,
      rowId: report.rows[0].id,
      finish: { name: 'ルーバー', specification: 'W100', unitPrice: 4000 }
    })
    assert.equal(
      f.s
        .readTakeoff(f.address)
        .counts?.find((c) => c.id === report.lines.find((l) => l.finish === 'ルーバー')?.id)
        ?.specification,
      'W100'
    )
    assert.deepEqual(f.s.readEstimate({ id: estimate.id }), estimate)
  } finally {
    f.cleanup()
  }
})
test('個数と図面位置をバックアップ・復元・再起動で保持し、v6から退避付きで移行する', async () => {
  const f = await fixture()
  try {
    const id = randomUUID()
    f.s.applyTakeoff({
      ...f.address,
      expectedRevision: 0,
      change: { kind: 'count', id, input: f.input }
    })
    const before = f.s.readTakeoff(f.address),
      backup = join(f.root, 'counts.sekisan-backup')
    await f.s.createBackup(backup)
    f.s.applyTakeoff({ ...f.address, expectedRevision: 1, change: { kind: 'deleteCount', id } })
    await f.s.restoreBackup(backup)
    assert.deepEqual(f.s.readTakeoff(f.address), before)
    f.s.close()
    const reopened = new Storage(join(f.root, 'app'))
    assert.deepEqual(reopened.readTakeoff(f.address), before)
    reopened.close()
    const db = new Database(join(f.root, 'app/data/db/sekisan-kanri.db'))
    db.exec(
      'ALTER TABLE materials DROP COLUMN layoutType; ALTER TABLE materials DROP COLUMN tileThicknessMm; DROP TABLE room_layouts; ALTER TABLE materials DROP COLUMN tileWidthMm; ALTER TABLE materials DROP COLUMN tileHeightMm; ALTER TABLE materials DROP COLUMN tileGapMm; ALTER TABLE projects DROP COLUMN assignee; DROP TABLE count_groups; PRAGMA user_version=6;'
    )
    db.close()
    const migrated = new Storage(join(f.root, 'app'))
    assert.equal(migrated.readTakeoff(f.address).counts?.length, 0)
    migrated.close()
    const snapshots = readdirSync(join(f.root, 'app/recovery')).filter((n) =>
      n.startsWith('before-schema-v14-')
    )
    assert.equal(snapshots.length, 1)
    const old = new Database(join(f.root, 'app/recovery', snapshots[0]), { readonly: true })
    assert.equal(old.pragma('user_version', { simple: true }), 6)
    old.close()
  } finally {
    f.cleanup()
  }
})

test('個数保存の途中失敗は巻き戻し、不正な点のバックアップ復元を拒否する', async () => {
  const f = await fixture()
  try {
    const id = randomUUID(),
      mutation = {
        ...f.address,
        expectedRevision: 0,
        change: { kind: 'count', id, input: f.input }
      }
    const db = (f.s as unknown as { db: Database.Database }).db
    db.exec(
      "CREATE TEMP TRIGGER count_failure BEFORE INSERT ON count_groups BEGIN SELECT RAISE(ABORT,'injected failure'); END"
    )
    assert.throws(() => f.s.applyTakeoff(mutation), /injected failure/)
    assert.equal(f.s.readTakeoff(f.address).revision, 0)
    assert.equal(f.s.readTakeoff(f.address).counts?.length, 0)
    db.exec('DROP TRIGGER count_failure')
    f.s.applyTakeoff(mutation)
    const before = f.s.readTakeoff(f.address),
      backup = join(f.root, 'valid.sekisan-backup')
    await f.s.createBackup(backup)
    const zip = new AdmZip(backup),
      path = join(f.root, 'invalid.db')
    writeFileSync(path, zip.readFile('db/sekisan-kanri.db')!)
    const invalid = new Database(path)
    invalid.prepare('UPDATE count_groups SET points=?').run('[{"x":-1,"y":0}]')
    invalid.close()
    const bytes = readFileSync(path),
      manifest = JSON.parse(zip.readAsText('manifest.json'))
    const entry = manifest.files.find((e: { path: string }) => e.path === 'db/sekisan-kanri.db')
    entry.size = bytes.length
    entry.sha256 = createHash('sha256').update(bytes).digest('hex')
    zip.updateFile('db/sekisan-kanri.db', bytes)
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    const bad = join(f.root, 'bad.sekisan-backup')
    zip.writeZip(bad)
    await assert.rejects(() => f.s.restoreBackup(bad))
    assert.deepEqual(f.s.readTakeoff(f.address), before)
    const old = new Database(path)
    old.exec(
      'ALTER TABLE materials DROP COLUMN layoutType; ALTER TABLE materials DROP COLUMN tileThicknessMm; DROP TABLE room_layouts; ALTER TABLE materials DROP COLUMN tileWidthMm; ALTER TABLE materials DROP COLUMN tileHeightMm; ALTER TABLE materials DROP COLUMN tileGapMm; ALTER TABLE projects DROP COLUMN assignee; DROP TABLE count_groups; PRAGMA user_version=6'
    )
    old.close()
    const oldBytes = readFileSync(path)
    manifest.schemaVersion = 6
    entry.size = oldBytes.length
    entry.sha256 = createHash('sha256').update(oldBytes).digest('hex')
    zip.updateFile('db/sekisan-kanri.db', oldBytes)
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    const oldBackup = join(f.root, 'v6.sekisan-backup')
    zip.writeZip(oldBackup)
    await f.s.restoreBackup(oldBackup)
    assert.equal(f.s.readTakeoff(f.address).counts?.length, 0)
    assert.equal(f.s.readTakeoff(f.address).revision, before.revision)
  } finally {
    f.cleanup()
  }
})
