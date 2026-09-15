import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PDFDocument } from 'pdf-lib'
import { computeLayout, defaultLayout, layoutSourceKey } from '../src/shared/layout'
import {
  materialInputSchema,
  materialStandard,
  materialSpecification
} from '../src/shared/materials'
import { emptyFinishes } from '../src/shared/takeoff'
import { Storage } from '../src/main/storage'
import { initializeSchema } from '../src/main/schema'
const rect = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h }
]
const base = () => ({ ...defaultLayout(), widthMm: 500, heightMm: 500 })
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
test('芯割り・芯跨ぎ・横縦の個別設定と目地が面積・真物・切り物に反映する', () => {
  const p = rect(1000, 1000)
  const joint = computeLayout(p, 0.001, base())
  assert.equal(joint.full, 4)
  assert.equal(joint.cut, 0)
  close(joint.laidArea, 1)
  const tile = computeLayout(p, 0.001, { ...base(), axisX: 'tile', axisY: 'tile' })
  assert.equal(tile.full, 1)
  assert.equal(tile.cut, 8)
  close(tile.laidArea, 1)
  const mixed = computeLayout(p, 0.001, { ...base(), axisX: 'tile' })
  assert.equal(mixed.full, 2)
  assert.equal(mixed.cut, 4)
  const gap = computeLayout(p, 0.001, { ...base(), gapMm: 10 })
  close(gap.laidArea, 0.9801)
  assert.equal(gap.full, 0)
  assert.equal(gap.cut, 4)
})
test('壁寄せは壁の方向・ポリゴンの回り方に依存せず、回転・微調整で再計算する', () => {
  for (const p of [rect(1000, 1500), rect(1000, 1500).reverse()])
    for (let wallIndex = 0; wallIndex < 4; wallIndex++) {
      const result = computeLayout(p, 0.001, { ...base(), mode: 'wall', wallIndex })
      assert.equal(result.full, 6)
      assert.equal(result.cut, 0)
      close(result.laidArea, 1.5)
    }
  const shifted = computeLayout(rect(1000, 1000), 0.001, { ...base(), offsetX: 1 })
  assert.equal(shifted.full, 2)
  assert.equal(shifted.cut, 4)
  close(shifted.laidArea, 1)
  const rotated = computeLayout(rect(1000, 1000), 0.001, { ...base(), angle: 45 })
  assert.ok(rotated.cut > 0)
  close(rotated.laidArea, 1)
})
test('凹形状・逆回り・接するだけの境界で欠落や余分な枚数を出さない', () => {
  const p = [
    { x: 0, y: 0 },
    { x: 1500, y: 0 },
    { x: 1500, y: 500 },
    { x: 500, y: 500 },
    { x: 500, y: 1500 },
    { x: 0, y: 1500 }
  ]
  for (const poly of [p, [...p].reverse()]) {
    const r = computeLayout(poly, 0.001, { ...base(), mode: 'wall', wallIndex: 0 })
    close(r.laidArea, 1.25)
    assert.equal(r.full, 5)
    assert.equal(r.cut, 0)
  }
  const u = [
    { x: 0, y: 0 },
    { x: 1200, y: 0 },
    { x: 1200, y: 1500 },
    { x: 800, y: 1500 },
    { x: 800, y: 400 },
    { x: 400, y: 400 },
    { x: 400, y: 1500 },
    { x: 0, y: 1500 }
  ]
  close(computeLayout(u, 0.001, { ...base(), widthMm: 1500, heightMm: 1000 }).laidArea, 1.36)
})
test('不正寸法・縮尺・過密な割付を拒否し、旧材料は寸法未設定として扱う', () => {
  assert.throws(() => computeLayout(rect(1000, 1000), 0, base()))
  assert.throws(() => computeLayout(rect(1000, 1000), 0.001, { ...base(), widthMm: 0 }))
  assert.throws(
    () => computeLayout(rect(10000, 10000), 0.001, { ...base(), widthMm: 10, heightMm: 10 }),
    /2万枚/
  )
  const m = materialInputSchema.parse({
    projectId: null,
    category: 'floor',
    name: '材料',
    unitPrice: null
  })
  assert.equal(m.tileWidthMm, null)
  assert.equal(m.tileGapMm, 0)
  assert.equal(materialInputSchema.safeParse({ ...m, tileWidthMm: 500 }).success, true)
  assert.equal(materialInputSchema.safeParse({ ...m, tileThicknessMm: -1 }).success, false)
  assert.equal(
    materialStandard({ ...m, tileWidthMm: 450, tileHeightMm: 900, tileThicknessMm: 2.5 }),
    '幅 450 mm × 長さ 900 mm × 厚み 2.5 mm'
  )
})
test('材料寸法と部屋の配置を保存・復元し、競合と形状変更を検出して削除時は追従する', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-layout-test-')),
    s = new Storage(join(folder, 'app'))
  try {
    const client = s.createClient('割付テスト'),
      project = s.createProject({
        clientId: client.id,
        name: '割付物件',
        memo: '',
        status: 'active'
      })
    const pdf = await PDFDocument.create()
    pdf.addPage([842, 595])
    const path = join(folder, 'drawing.pdf')
    writeFileSync(path, await pdf.save())
    const drawing = (await s.importPdfs(project.id, [path])).imported[0],
      address = { drawingId: drawing.id, pageNumber: 1 }
    s.applyTakeoff({
      ...address,
      expectedRevision: 0,
      change: {
        kind: 'scale',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 }
        ],
        lengthMm: 1000
      }
    })
    const roomId = randomUUID(),
      polygon = rect(400, 300)
    s.applyTakeoff({
      ...address,
      expectedRevision: 1,
      change: {
        kind: 'room',
        id: roomId,
        input: {
          name: '会議室',
          polygon,
          color: '#327e6d',
          heightMm: 2400,
          finishes: emptyFinishes(),
          sleeveWalls: [],
          enabledCategories: ['floor']
        }
      }
    })
    const materialId = randomUUID()
    s.changeMaterials({
      kind: 'save',
      id: materialId,
      input: {
        projectId: null,
        category: 'floor',
        name: 'タイル',
        unitPrice: null,
        tileWidthMm: 450,
        tileHeightMm: 900,
        tileGapMm: 2,
        tileThicknessMm: 2.5
      }
    })
    s.changeMaterials({ kind: 'import', projectId: project.id, ids: [materialId] })
    const material = s.readMaterials(project.id).project[0]
    assert.equal(material.tileWidthMm, 450)
    assert.equal(material.tileHeightMm, 900)
    assert.equal(material.tileGapMm, 2)
    assert.equal(material.tileThicknessMm, 2.5)
    const request = {
      roomId,
      expectedRevision: 0,
      sourceKey: layoutSourceKey(polygon, 0.01),
      body: { ...base(), materialId: material.id, offsetX: 10 }
    }
    const saved = s.saveLayout(request)
    assert.deepEqual(s.readLayout(roomId), saved)
    assert.throws(() => s.saveLayout(request), /更新/)
    assert.throws(() => s.saveLayout({ ...request, expectedRevision: 1, sourceKey: 'old' }), /縮尺/)
    assert.equal(s.readTakeoff(address).revision, 2)
    const backup = join(folder, 'test.sekisan-backup')
    await s.createBackup(backup)
    s.applyTakeoff({ ...address, expectedRevision: 2, change: { kind: 'deleteRoom', id: roomId } })
    assert.equal(s.readLayout(roomId), null)
    await s.restoreBackup(backup)
    assert.deepEqual(s.readLayout(roomId), saved)
    assert.equal(s.readMaterials(project.id).project[0].tileHeightMm, 900)
    assert.equal(s.readMaterials(project.id).project[0].tileThicknessMm, 2.5)
    s.close()
    const reopened = new Storage(join(folder, 'app'))
    try {
      assert.deepEqual(reopened.readLayout(roomId), saved)
    } finally {
      reopened.close()
    }
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
test('v8からv9への移行は材料を保持して事前退避する', () => {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-layout-migration-'))
  mkdirSync(join(root, 'data/db'), { recursive: true })
  const path = join(root, 'data/db/sekisan-kanri.db'),
    db = new Database(path)
  initializeSchema(db, 0)
  // Recreate a genuine v8 schema by removing only the v9 additions.
  db.exec(
    'ALTER TABLE rooms DROP COLUMN geometryType; ALTER TABLE materials DROP COLUMN layoutType; ALTER TABLE materials DROP COLUMN tileThicknessMm; DROP TABLE room_layouts; ALTER TABLE materials DROP COLUMN tileWidthMm; ALTER TABLE materials DROP COLUMN tileHeightMm; ALTER TABLE materials DROP COLUMN tileGapMm; PRAGMA user_version=8;'
  )
  db.close()
  const s = new Storage(root)
  try {
    assert.equal(s.readMaterials(null).global.length, 9)
    assert.equal(s.readMaterials(null).global[0].tileWidthMm, null)
    assert.ok(readdirSync(join(root, 'recovery')).some((n) => n.startsWith('before-schema-v15-')))
  } finally {
    s.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('原点から離れた部屋でも枚数・面積を保つ', () => {
  const p = rect(1000, 1500)
  const translated = p.map((v) => ({ x: v.x + 9000000, y: v.y + 9000000 }))
  const a = computeLayout(p, 0.001, { ...base(), angle: 13 })
  const b = computeLayout(translated, 0.001, { ...base(), angle: 13 })
  assert.equal(a.full, b.full)
  assert.equal(a.cut, b.cut)
  close(a.laidArea, b.laidArea)
})

test('v9の仕様文・寸法・保存済み目地を残して厚み未設定でv10へ移行する', () => {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-standard-migration-'))
  mkdirSync(join(root, 'data/db'), { recursive: true })
  const path = join(root, 'data/db/sekisan-kanri.db'),
    db = new Database(path)
  initializeSchema(db, 0)
  db.exec(
    'ALTER TABLE rooms DROP COLUMN geometryType; ALTER TABLE materials DROP COLUMN layoutType; ALTER TABLE materials DROP COLUMN tileThicknessMm; PRAGMA user_version=9;'
  )
  db.prepare(
    "UPDATE materials SET specification=?,tileWidthMm=450,tileHeightMm=900,tileGapMm=2 WHERE category='floor'"
  ).run('既存仕様 450×900')
  db.close()
  const storage = new Storage(root)
  try {
    const material = storage.readMaterials(null).global.find((m) => m.category === 'floor')!
    assert.equal(material.specification, '既存仕様 450×900')
    assert.equal(material.tileWidthMm, 450)
    assert.equal(material.tileHeightMm, 900)
    assert.equal(material.tileGapMm, 2)
    assert.equal(material.tileThicknessMm, null)
    assert.ok(readdirSync(join(root, 'recovery')).some((n) => n.startsWith('before-schema-v15-')))
  } finally {
    storage.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('仕様と規格を一欄にまとめ、空欄と部分寸法を区別する', () => {
  const m = { specification: '品番ABC', tileWidthMm: 450, tileHeightMm: 900, tileThicknessMm: 2.5 }
  assert.equal(materialSpecification(m), '品番ABC ／ 450×900×2.5 mm')
  assert.equal(materialSpecification({ ...m, tileThicknessMm: null }), '品番ABC ／ 450×900 mm')
  assert.equal(materialSpecification({ ...m, specification: '' }), '450×900×2.5 mm')
  assert.equal(
    materialSpecification({ ...m, tileWidthMm: null, tileHeightMm: null }),
    '品番ABC ／ 厚み 2.5 mm'
  )
  assert.equal(
    materialSpecification({ ...m, tileWidthMm: null, tileHeightMm: null, tileThicknessMm: null }),
    '品番ABC'
  )
})
