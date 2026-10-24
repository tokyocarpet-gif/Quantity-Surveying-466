import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { Storage } from '../src/main/storage'
import { hexagonHeight } from '../src/shared/layout'
import {
  materialInputSchema,
  materialSpecification,
  materialStandard
} from '../src/shared/materials'

const input = {
  projectId: null,
  category: 'floor',
  name: '六角タイル',
  specification: '品番HX',
  unitPrice: 5000,
  tileShape: 'hexagon',
  tileWidthMm: 300,
  tileThicknessMm: 5
}

test('正六角形は対辺寸法から対角寸法を算定し、仕様と形状・寸法をまとめる', () => {
  const m = materialInputSchema.parse({ ...input, tileHeightMm: 999 })
  assert.equal(m.tileHeightMm, hexagonHeight(300))
  assert.equal(
    materialSpecification(m),
    '品番HX ／ ヘキサゴン（正六角形） ／ 対辺W 300 mm × 対角L 346.41 mm ／ 厚みT 5 mm'
  )
  const blank = materialInputSchema.parse({ ...input, tileWidthMm: null, tileThicknessMm: null })
  assert.equal(blank.tileHeightMm, null)
  assert.equal(materialStandard(blank), 'ヘキサゴン（正六角形）')
  assert.equal(
    materialInputSchema.parse({ ...input, tileWidthMm: 10000 }).tileHeightMm,
    hexagonHeight(10000)
  )
  assert.equal(materialInputSchema.safeParse({ ...input, tileWidthMm: 0 }).success, false)
  assert.equal(materialInputSchema.safeParse({ ...input, tileShape: 'other' }).success, false)
  assert.equal(materialInputSchema.safeParse({ ...input, layoutType: 'carpet' }).success, false)
  const legacy = materialInputSchema.parse({
    projectId: null,
    category: 'floor',
    name: '既存',
    unitPrice: null
  })
  assert.equal(legacy.tileShape, 'rectangle')
})

test('六角形の共通・物件マスタ、編集、再起動、バックアップ復元を保持する', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-shape-'))
  let s = new Storage(join(root, 'app'))
  try {
    const client = s.createClient('顧客')
    const project = s.createProject({
      clientId: client.id,
      name: '物件',
      memo: '',
      status: 'active'
    })
    const id = randomUUID()
    s.changeMaterials({ kind: 'save', id, input })
    s.changeMaterials({ kind: 'import', projectId: project.id, ids: [id] })
    const imported = s.readMaterials(project.id).project[0]
    assert.equal(imported.tileShape, 'hexagon')
    assert.equal(imported.tileHeightMm, hexagonHeight(300))
    s.changeMaterials({ kind: 'save', id, input: { ...input, tileWidthMm: 200 } })
    assert.equal(
      s.readMaterials(project.id).project[0].tileWidthMm,
      300,
      '取り込み済み物件を自動変更しない'
    )
    const backup = join(root, 'shape.sekisan-backup')
    await s.createBackup(backup)
    s.changeMaterials({ kind: 'delete', id: imported.id })
    await s.restoreBackup(backup)
    assert.deepEqual(s.readMaterials(project.id).project[0], imported)
    s.close()
    s = new Storage(join(root, 'app'))
    assert.equal(
      s.readMaterials(null).global.find((m) => m.id === id)!.tileHeightMm,
      hexagonHeight(200)
    )
  } finally {
    s.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('v25の材料を四角形で引き継ぎ、旧バックアップの復元と移行前退避に対応する', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-shape-legacy-'))
  let s = new Storage(join(root, 'app'))
  try {
    const id = randomUUID()
    s.changeMaterials({
      kind: 'save',
      id,
      input: { ...input, tileShape: 'rectangle', tileHeightMm: 600 }
    })
    s.close()
    const path = join(root, 'app/data/db/sekisan-kanri.db')
    const db = new Database(path)
    db.exec('ALTER TABLE materials DROP COLUMN tileShape; PRAGMA user_version=25')
    db.close()
    const bytes = readFileSync(path)
    const zip = new AdmZip()
    zip.addFile('db/sekisan-kanri.db', bytes)
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          application: 'sekisan-kanri',
          formatVersion: 1,
          schemaVersion: 25,
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
    const backup = join(root, 'v25.sekisan-backup')
    zip.writeZip(backup)
    s = new Storage(join(root, 'app'))
    const m = s.readMaterials(null).global.find((m) => m.id === id)!
    assert.equal(m.tileShape, 'rectangle')
    assert.equal(m.tileHeightMm, 600)
    assert.ok(
      readdirSync(join(root, 'app/recovery')).some((n) => n.startsWith('before-schema-v26-'))
    )
    s.changeMaterials({ kind: 'delete', id })
    await s.restoreBackup(backup)
    assert.deepEqual(
      s.readMaterials(null).global.find((m) => m.id === id),
      m
    )
  } finally {
    s.close()
    rmSync(root, { recursive: true, force: true })
  }
})
