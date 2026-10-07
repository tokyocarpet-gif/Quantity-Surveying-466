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
import {
  emptyCompany,
  companySchema,
  companyIdentity,
  companyIssuer,
  structuredIssuer
} from '../src/shared/business'

test('自社情報・追加した部位と単位・材料の仕様を保存し、バックアップ復元と再起動で保持する', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-business-'))
  const root = join(folder, 'app'),
    s = new Storage(root)
  try {
    assert.deepEqual(s.readCompany(), emptyCompany())
    const company = {
      ...emptyCompany(),
      name: '試験会社',
      constructionLicense: '東京都知事許可（般2）第12226号',
      fireCertification: '消防庁認定第12703号',
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
    assert.ok(readdirSync(join(root, 'recovery')).some((n) => n.startsWith('before-schema-v21-')))
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
      'DROP TABLE wall_layouts; ALTER TABLE materials DROP COLUMN wallpaper; ALTER TABLE rooms DROP COLUMN geometryType; ALTER TABLE materials DROP COLUMN layoutType; ALTER TABLE materials DROP COLUMN tileThicknessMm; DROP TABLE room_layouts; ALTER TABLE materials DROP COLUMN tileWidthMm; ALTER TABLE materials DROP COLUMN tileHeightMm; ALTER TABLE materials DROP COLUMN tileGapMm; ALTER TABLE projects DROP COLUMN assignee; PRAGMA user_version=7'
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
      n.startsWith('before-schema-v21-')
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

test('許可・認定のない旧自社情報を読め、帳票は許可・認定・会社・住所・同じ行のTEL/FAX順になる', () => {
  const { constructionLicense, fireCertification, ...legacy } = emptyCompany()
  assert.deepEqual(companySchema.parse(legacy), emptyCompany())
  const company = {
    ...emptyCompany(),
    constructionLicense: '東京都知事許可（般2）第12226号',
    fireCertification: '消防庁認定第12703号',
    name: '東京カーペット加工 株式会社',
    postalCode: '〒130-0012',
    address: '東京都墨田区太平4-6-6',
    phone: '03-3625-4169',
    fax: '03-3626-2669'
  }
  const identity = companyIdentity(company)
  assert.equal(
    companyIssuer(identity),
    '東京都知事許可（般2）第12226号\n消防庁認定第12703号\n東京カーペット加工 株式会社\n〒130-0012\n東京都墨田区太平4-6-6\nTEL 03-3625-4169　FAX 03-3626-2669'
  )
  assert.deepEqual(
    structuredIssuer({ issuer: companyIssuer(identity), issuerCompany: identity }),
    identity
  )
  assert.equal(
    structuredIssuer({ issuer: '手入力した既存の発行者', issuerCompany: identity }),
    undefined
  )
  assert.equal(companyIssuer(companyIdentity(emptyCompany())), '')
})

test('追加した部位・単位を全材料で改名し、重複・基本項目・競合を拒否してバックアップに保持する', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-catalog-rename-')),
    s = new Storage(join(folder, 'app'))
  try {
    const c = s.createClient('顧客'),
      project = s.createProject({ clientId: c.id, name: '物件', memo: '', status: 'active' })
    s.addCatalogOption({ kind: 'part', name: '建具' })
    s.addCatalogOption({ kind: 'unit', name: '枚' })
    const id = randomUUID()
    s.changeMaterials({
      kind: 'save',
      id,
      input: {
        projectId: null,
        category: '建具',
        name: '扉',
        specification: 'W900',
        unit: '枚',
        unitPrice: 1500
      }
    })
    s.changeMaterials({ kind: 'import', projectId: project.id, ids: [id] })
    const before = s.readMaterials(project.id)
    s.renameCatalogOption({ kind: 'part', oldName: '建具', name: '木製建具' })
    s.renameCatalogOption({ kind: 'unit', oldName: '枚', name: '面' })
    const renamed = s.readMaterials(project.id)
    assert.deepEqual(renamed.parts, ['木製建具'])
    assert.deepEqual(renamed.units, ['面'])
    for (const scope of ['global', 'project'] as const) {
      const old = before[scope].find((m) => m.name === '扉')!,
        now = renamed[scope].find((m) => m.name === '扉')!
      assert.deepEqual(now, { ...old, category: '木製建具', unit: '面' })
    }
    for (const data of [
      { kind: 'part', oldName: 'wall', name: '側壁' },
      { kind: 'part', oldName: '壁', name: '側壁' },
      { kind: 'unit', oldName: '㎡', name: '平米' },
      { kind: 'part', oldName: '木製建具', name: 'floor' },
      { kind: 'part', oldName: '木製建具', name: '床' },
      { kind: 'unit', oldName: '面', name: 'm' },
      { kind: 'part', oldName: '建具', name: '古い画面からの変更' },
      { kind: 'unit', oldName: '面', name: '長'.repeat(21) },
      { kind: 'part', oldName: '木製建具', name: ' ' }
    ])
      assert.throws(() => s.renameCatalogOption(data))
    assert.deepEqual(s.readMaterials(project.id), renamed)
    s.addCatalogOption({ kind: 'part', name: '金属建具' })
    assert.throws(
      () => s.renameCatalogOption({ kind: 'part', oldName: '木製建具', name: '金属建具' }),
      /同じ名前/
    )
    // Names used by legacy materials but absent from the options list can also be edited.
    s.changeMaterials({
      kind: 'save',
      id: randomUUID(),
      input: { projectId: null, category: '養生', name: 'プラベニア', unit: '枚', unitPrice: 100 }
    })
    s.renameCatalogOption({ kind: 'part', oldName: '養生', name: '壁養生' })
    const expected = s.readMaterials(project.id),
      backup = join(folder, 'catalog.sekisan-backup')
    await s.createBackup(backup)
    s.renameCatalogOption({ kind: 'unit', oldName: '面', name: '本' })
    await s.restoreBackup(backup)
    assert.deepEqual(s.readMaterials(project.id), expected)
    s.close()
    const reopened = new Storage(join(folder, 'app'))
    try {
      assert.deepEqual(reopened.readMaterials(project.id), expected)
    } finally {
      reopened.close()
    }
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

test('部位・単位の削除は基本項目と全物件の使用中項目を保護し、未使用項目だけを永続的に削除する', () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-catalog-delete-'))
  const s = new Storage(join(folder, 'app'))
  try {
    const client = s.createClient('削除テスト')
    const project = s.createProject({
      clientId: client.id,
      name: '別物件',
      memo: '',
      status: 'active'
    })
    for (const input of [
      { kind: 'part', name: '未使用部位' },
      { kind: 'part', name: '建具' },
      { kind: 'unit', name: '未使用単位' },
      { kind: 'unit', name: '枚' }
    ])
      s.addCatalogOption(input)
    const id = randomUUID()
    s.changeMaterials({
      kind: 'save',
      id,
      input: { projectId: project.id, category: '建具', name: '扉', unit: '枚', unitPrice: 1500 }
    })
    const before = s.readMaterials(project.id)
    for (const [kind, name] of [
      ['part', 'ceiling'],
      ['part', '天井'],
      ['part', 'wall'],
      ['part', '壁'],
      ['part', 'floor'],
      ['part', '床'],
      ['part', 'baseboard'],
      ['part', '巾木'],
      ['unit', '㎡'],
      ['unit', 'm'],
      ['unit', '式'],
      ['unit', '個']
    ])
      assert.throws(() => s.deleteCatalogOption({ kind, name }), /基本項目/)
    for (const [kind, name] of [
      ['part', '建具'],
      ['unit', '枚']
    ])
      assert.throws(() => s.deleteCatalogOption({ kind, name }), /使用中/)
    assert.throws(() => s.deleteCatalogOption({ kind: 'part', name: '不存在' }), /見つかりません/)
    assert.throws(() => s.deleteCatalogOption({ kind: 'unit', name: 'a'.repeat(21) }))
    assert.deepEqual(s.readMaterials(project.id), before)
    s.deleteCatalogOption({ kind: 'part', name: ' 未使用部位 ' })
    s.deleteCatalogOption({ kind: 'unit', name: '未使用単位' })
    const after = s.readMaterials(project.id)
    assert.deepEqual(after.parts, ['建具'])
    assert.deepEqual(after.units, ['枚'])
    assert.deepEqual(after.project, before.project)
    assert.deepEqual(after.global, before.global)
    // A label used only by a legacy/common material must also be protected.
    s.changeMaterials({
      kind: 'save',
      id: randomUUID(),
      input: { projectId: null, category: '養生', name: '養生材', unit: '本', unitPrice: null }
    })
    assert.throws(() => s.deleteCatalogOption({ kind: 'part', name: '養生' }), /使用中/)
    assert.throws(() => s.deleteCatalogOption({ kind: 'unit', name: '本' }), /使用中/)
    s.changeMaterials({
      kind: 'save',
      id,
      input: { projectId: project.id, category: 'wall', name: '扉', unit: '㎡', unitPrice: 1500 }
    })
    s.deleteCatalogOption({ kind: 'part', name: '建具' })
    s.deleteCatalogOption({ kind: 'unit', name: '枚' })
    const expected = s.readMaterials(project.id)
    assert.deepEqual(expected.parts, [])
    assert.deepEqual(expected.units, [])
    s.close()
    const reopened = new Storage(join(folder, 'app'))
    try {
      assert.deepEqual(reopened.readMaterials(project.id), expected)
    } finally {
      reopened.close()
    }
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
