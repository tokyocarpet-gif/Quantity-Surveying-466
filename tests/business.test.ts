import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { Storage } from '../src/main/storage'
import { BASE_SQL } from '../src/main/schema'
import { TAKEOFF_SQL } from '../src/main/takeoff-storage'
import { MASTER_SQL } from '../src/main/master-storage'
import { TAKEOFF_EXTRAS_SQL } from '../src/main/takeoff-extras-schema'
import { ESTIMATE_SQL } from '../src/main/estimate-storage'
import { emptyCompany } from '../src/shared/business'

test('自社情報・追加した部位と単位・材料の仕様を保存し、バックアップ復元と再起動で保持する', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-business-'))
  const root = join(folder, 'app'),
    s = new Storage(root)
  try {
    assert.deepEqual(s.readCompany(), emptyCompany())
    const company = {
      ...emptyCompany(),
      name: '試験会社',
      address: '東京都',
      phone: '03-0000-0000',
      estimateValidity: '発行日から30日間',
      paymentTerms: '月末締め・翌月末払い',
      otherConditions: '工事日程は別途協議'
    }
    s.saveCompany(company)
    s.addCatalogOption({ kind: 'part', name: '建具' })
    s.addCatalogOption({ kind: 'part', name: ' 建具 ' })
    s.addCatalogOption({ kind: 'part', name: '天井' })
    s.addCatalogOption({ kind: 'unit', name: '枚' })
    assert.deepEqual(s.readMaterials(null).parts, ['建具'])
    assert.deepEqual(s.readMaterials(null).units, ['枚'])
    assert.throws(() => s.addCatalogOption({ kind: 'unit', name: 'a'.repeat(21) }))
    assert.throws(() => s.saveCompany({ ...company, name: 'a'.repeat(121) }))
    const client = s.createClient('顧客'),
      project = s.createProject({
        clientId: client.id,
        name: '物件',
        memo: '',
        status: 'active',
        assignee: '山田 太郎'
      })
    assert.equal(project.assignee, '山田 太郎')
    assert.throws(() =>
      s.updateProject(project.id, {
        clientId: client.id,
        name: project.name,
        memo: '',
        status: 'active',
        assignee: '長'.repeat(101)
      })
    )
    const id = randomUUID(),
      input = {
        projectId: null,
        category: '建具',
        name: '木製建具',
        specification: 'W900×H2100',
        unit: '枚',
        unitPrice: 12000
      }
    s.changeMaterials({ kind: 'save', id, input })
    s.changeMaterials({ kind: 'import', projectId: project.id, ids: [id] })
    const material = s.readMaterials(project.id).project[0]
    assert.equal(material.specification, input.specification)
    assert.equal(material.unit, '枚')
    assert.equal(material.category, '建具')
    assert.equal(material.sourceId, id)
    const backup = join(folder, 'business.sekisan-backup')
    await s.createBackup(backup)
    s.saveCompany(emptyCompany())
    s.updateProject(project.id, {
      clientId: client.id,
      name: project.name,
      memo: '',
      status: 'active',
      assignee: '佐藤 次郎'
    })
    assert.equal(s.workspace().projects[0].assignee, '佐藤 次郎')
    s.changeMaterials({
      kind: 'save',
      id,
      input: { ...input, specification: '変更', unitPrice: 20000 }
    })
    assert.deepEqual(s.readMaterials(project.id).project[0], material)
    await s.restoreBackup(backup)
    assert.deepEqual(s.readCompany(), company)
    assert.equal(s.workspace().projects[0].assignee, '山田 太郎')
    assert.deepEqual(s.readMaterials(project.id).project[0], material)
    s.close()
    const reopened = new Storage(root)
    try {
      assert.deepEqual(reopened.readCompany(), company)
      assert.equal(reopened.workspace().projects[0].assignee, '山田 太郎')
      assert.deepEqual(reopened.readMaterials(null).parts, ['建具'])
      assert.deepEqual(reopened.readMaterials(null).units, ['枚'])
    } finally {
      reopened.close()
    }
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

test('v5の材料を退避して移行し、共通と物件の関連・単価を保持する', () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-business-migration-')),
    root = join(folder, 'app')
  mkdirSync(join(root, 'data/db'), { recursive: true })
  const db = new Database(join(root, 'data/db/sekisan-kanri.db'))
  db.pragma('foreign_keys = ON')
  db.exec(BASE_SQL + TAKEOFF_SQL + MASTER_SQL + TAKEOFF_EXTRAS_SQL + ESTIMATE_SQL)
  const client = randomUUID(),
    project = randomUUID(),
    copied = randomUUID(),
    source = 'a0000000-0000-4000-8000-000000000005',
    now = new Date().toISOString()
  db.prepare('INSERT INTO clients VALUES (?,?,?)').run(client, '顧客', now)
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(
    project,
    client,
    '物件',
    '',
    'active',
    now,
    now
  )
  db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?)').run(
    copied,
    project,
    'baseboard',
    '既存巾木',
    250,
    source
  )
  db.close()
  const s = new Storage(root)
  try {
    const m = s.readMaterials(project).project[0]
    assert.equal(m.sourceId, source)
    assert.equal(m.unit, 'm')
    assert.equal(m.specification, '')
    assert.equal(m.unitPrice, 250)
    s.changeMaterials({ kind: 'import', projectId: project, ids: [source] })
    assert.equal(s.readMaterials(project).project.length, 1)
    assert.ok(readdirSync(join(root, 'recovery')).some((n) => n.startsWith('before-schema-v15-')))
    s.changeMaterials({ kind: 'delete', id: source })
    assert.equal(s.readMaterials(project).project[0].sourceId, null)
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

test('v7の案件・自社情報は空の追加項目で移行し、旧バックアップも復元できる', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-project-v7-')),
    root = join(folder, 'app'),
    path = join(root, 'data/db/sekisan-kanri.db')
  let s = new Storage(root)
  try {
    const client = s.createClient('顧客'),
      project = s.createProject({
        clientId: client.id,
        name: '既存案件',
        memo: '現地調査済み',
        status: 'active'
      })
    s.close()
    const db = new Database(path)
    const { estimateValidity, paymentTerms, otherConditions, ...legacyCompany } = emptyCompany()
    legacyCompany.name = '既存会社'
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(
      'company',
      JSON.stringify(legacyCompany)
    )
    db.exec(
      'ALTER TABLE rooms DROP COLUMN geometryType; ALTER TABLE materials DROP COLUMN layoutType; ALTER TABLE materials DROP COLUMN tileThicknessMm; DROP TABLE room_layouts; ALTER TABLE materials DROP COLUMN tileWidthMm; ALTER TABLE materials DROP COLUMN tileHeightMm; ALTER TABLE materials DROP COLUMN tileGapMm; ALTER TABLE projects DROP COLUMN assignee; PRAGMA user_version=7'
    )
    db.close()
    const bytes = readFileSync(path),
      zip = new AdmZip(),
      backup = join(folder, 'v7.sekisan-backup')
    zip.addFile('db/sekisan-kanri.db', bytes)
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          application: 'sekisan-kanri',
          formatVersion: 1,
          schemaVersion: 7,
          createdAt: new Date().toISOString(),
          files: [
            {
              path: 'db/sekisan-kanri.db',
              size: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex')
            }
          ]
        })
      )
    )
    zip.writeZip(backup)
    s = new Storage(root)
    assert.deepEqual(s.workspace().projects[0], project)
    assert.deepEqual(s.readCompany(), { ...emptyCompany(), name: '既存会社' })
    const snapshots = readdirSync(join(root, 'recovery')).filter((n) =>
      n.startsWith('before-schema-v15-')
    )
    assert.equal(snapshots.length, 1)
    const snapshot = new Database(join(root, 'recovery', snapshots[0]), { readonly: true })
    assert.equal(snapshot.pragma('user_version', { simple: true }), 7)
    snapshot.close()
    s.updateProject(project.id, {
      clientId: client.id,
      name: project.name,
      memo: project.memo,
      status: project.status,
      assignee: '移行後担当'
    })
    await s.restoreBackup(backup)
    assert.deepEqual(s.workspace().projects[0], project)
    assert.deepEqual(s.readCompany(), { ...emptyCompany(), name: '既存会社' })
    assert.throws(() => s.saveCompany({ ...emptyCompany(), paymentTerms: '長'.repeat(501) }))
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
