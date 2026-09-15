import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { PDFDocument } from 'pdf-lib'
import {
  computeLayout,
  defaultLayout,
  layoutBodySchema,
  layoutSourceKey
} from '../src/shared/layout'
import { materialInputSchema, materialSpecification } from '../src/shared/materials'
import { initializeSchema } from '../src/main/schema'
import { Storage } from '../src/main/storage'
import { emptyFinishes } from '../src/shared/takeoff'
const rectangle = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h }
]
const body = () => ({
  ...defaultLayout(),
  layoutType: 'sheet' as const,
  mode: 'wall' as const,
  widthMm: 1820,
  heightMm: 20000,
  trimMm: 50
})
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
test('ロール幅で敷き並べ、両端切りしろを含む延長・面積と巻割りを求める', () => {
  const result = computeLayout(rectangle(4000, 6000), 0.001, body())
  const roll = result.roll!
  close(result.roomArea, 24)
  assert.equal(roll.strips.length, 3)
  assert.deepEqual(
    roll.strips.map((s) => s.widthMm),
    [1820, 1820, 360]
  )
  assert.deepEqual(
    roll.strips.map((s) => s.cutLengthMm),
    [6100, 6100, 6100]
  )
  close(roll.lengthM, 18.3)
  close(roll.requiredArea, 33.306)
  assert.equal(roll.rollCount, 1)
  const short = computeLayout(rectangle(4000, 6000), 0.001, { ...body(), heightMm: 10000 }).roll!
  assert.equal(short.rollCount, 3)
  assert.deepEqual(
    short.strips.map((s) => s.rollNumber),
    [1, 2, 3]
  )
  const over = computeLayout(rectangle(4000, 6000), 0.001, { ...body(), heightMm: 6000 }).roll!
  assert.equal(over.rollCount, null)
  assert.ok(over.strips.every((s) => s.overLength))
})
test('巻き長さ未設定でも拾え、方向・継ぎ目・切りしろで必要量が変わる', () => {
  const p = rectangle(4000, 6000)
  const turned = computeLayout(p, 0.001, { ...body(), angle: 90, heightMm: null }).roll!
  assert.equal(turned.strips.length, 4)
  close(turned.lengthM, 16.4)
  assert.equal(turned.rollCount, null)
  assert.ok(turned.strips.every((s) => !s.overLength))
  const center = computeLayout(p, 0.001, { ...body(), mode: 'center' }).roll!
  assert.equal(center.strips.length, 4)
  const across = computeLayout(p, 0.001, {
    ...body(),
    mode: 'center',
    axisX: 'tile',
    layoutType: 'carpet'
  }).roll!
  assert.equal(across.strips.length, 3)
  const noTrim = computeLayout(p, 0.001, { ...body(), trimMm: 0 }).roll!
  close(noTrim.lengthM, 18)
})
test('凹部の各帯は最初から最後までの連続シートとして数え、正味面積を保持する', () => {
  const p = [
    [0, 0],
    [4000, 0],
    [4000, 6000],
    [2500, 6000],
    [2500, 2000],
    [1500, 2000],
    [1500, 6000],
    [0, 6000]
  ].map(([x, y]) => ({ x, y }))
  const r = computeLayout(p, 0.001, { ...body(), widthMm: 1000, trimMm: 0 })
  close(r.roomArea, 20)
  close(r.tiles.reduce((sum, t) => sum + t.areaMm2, 0) / 1e6, r.roomArea)
  assert.equal(r.roll!.strips.length, 4)
  close(r.roll!.requiredArea, 24)
  const reversed = computeLayout([...p].reverse(), 0.001, { ...body(), mode: 'center' })
  const forward = computeLayout(p, 0.001, { ...body(), mode: 'center' })
  close(reversed.roll!.lengthM, forward.roll!.lengthM)
})
test('タイルの旧設定を維持し、ロールの不正幅・目地・過密入力を拒否する', () => {
  const { layoutType, trimMm, reorderCuts, ...legacy } = defaultLayout()
  assert.equal(layoutBodySchema.parse(legacy).layoutType, 'tile')
  assert.throws(() => computeLayout(rectangle(4000, 6000), 0.001, { ...body(), widthMm: 0 }))
  assert.throws(() => computeLayout(rectangle(4000, 6000), 0.001, { ...body(), gapMm: 2 }))
  assert.throws(
    () => computeLayout(rectangle(40000, 6000), 0.001, { ...body(), widthMm: 10 }),
    /2,000/
  )
  assert.equal(
    materialInputSchema.safeParse({
      projectId: null,
      category: 'floor',
      name: 'シート',
      layoutType: 'sheet',
      tileHeightMm: 50000,
      unitPrice: null
    }).success,
    true
  )
  assert.equal(
    materialInputSchema.safeParse({
      projectId: null,
      category: 'floor',
      name: 'タイル',
      tileHeightMm: 50000,
      unitPrice: null
    }).success,
    false
  )
})
test('v10の材料はタイルとして退避・移行し、既存寸法を保持する', () => {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-roll-migration-'))
  mkdirSync(join(root, 'data/db'), { recursive: true })
  const db = new Database(join(root, 'data/db/sekisan-kanri.db'))
  initializeSchema(db, 0)
  db.exec(
    'ALTER TABLE rooms DROP COLUMN geometryType; ALTER TABLE materials DROP COLUMN layoutType; PRAGMA user_version=10;'
  )
  const before = db.prepare('SELECT * FROM materials ORDER BY id').all()
  db.close()
  const storage = new Storage(root)
  try {
    assert.ok(storage.readMaterials(null).global.every((m) => m.layoutType === 'tile'))
    const compare = new Database(join(root, 'data/db/sekisan-kanri.db'))
    assert.deepEqual(
      compare
        .prepare('SELECT * FROM materials ORDER BY id')
        .all()
        .map((r: any) => {
          const { layoutType, ...old } = r
          return old
        }),
      before
    )
    compare.close()
    assert.ok(readdirSync(join(root, 'recovery')).some((n) => n.startsWith('before-schema-v15-')))
  } finally {
    storage.close()
    rmSync(root, { recursive: true, force: true })
  }
})
test('ロール材の取り込み・配置・バックアップ復元を保持し、拾い出し数量は変えない', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sekisan-roll-storage-')),
    s = new Storage(join(root, 'app'))
  try {
    const client = s.createClient('顧客'),
      project = s.createProject({ clientId: client.id, name: '案件', memo: '', status: 'active' })
    const pdf = await PDFDocument.create()
    pdf.addPage([842, 595])
    const path = join(root, 'drawing.pdf')
    writeFileSync(path, await pdf.save())
    await s.importPdfs(project.id, [path])
    const drawing = s.workspace().drawings[0],
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
      polygon = rectangle(400, 600)
    s.applyTakeoff({
      ...address,
      expectedRevision: 1,
      change: {
        kind: 'room',
        id: roomId,
        input: {
          name: '部屋',
          polygon,
          color: '#327e6d',
          heightMm: 2400,
          finishes: emptyFinishes(),
          sleeveWalls: [],
          enabledCategories: ['floor']
        }
      }
    })
    const before = s.readTakeoff(address),
      id = randomUUID()
    s.changeMaterials({
      kind: 'save',
      id,
      input: {
        projectId: null,
        category: 'floor',
        name: 'ロール材',
        layoutType: 'carpet',
        specification: '品番R',
        tileWidthMm: 3640,
        tileHeightMm: 30000,
        tileThicknessMm: 6,
        unitPrice: null
      }
    })
    s.changeMaterials({ kind: 'import', projectId: project.id, ids: [id] })
    const material = s.readMaterials(project.id).project[0]
    assert.equal(material.layoutType, 'carpet')
    assert.match(materialSpecification(material), /L 30,000 mm/)
    const saved = s.saveLayout({
      roomId,
      expectedRevision: 0,
      sourceKey: layoutSourceKey(polygon, 0.01),
      body: {
        ...body(),
        layoutType: 'carpet',
        heightMm: null,
        materialId: material.id,
        reorderCuts: true,
        rollCutMode: 'free',
        maxWidthMm: 3640
      }
    })
    const backup = join(root, 'roll.sekisan-backup')
    await s.createBackup(backup)
    await s.restoreBackup(backup)
    assert.deepEqual(s.readLayout(roomId), saved)
    assert.deepEqual(s.readTakeoff(address), before)
    assert.equal(s.readMaterials(project.id).project[0].layoutType, 'carpet')
    s.close()
    const reopened = new Storage(join(root, 'app'))
    assert.deepEqual(reopened.readLayout(roomId), saved)
    reopened.close()
    const legacy = new Database(join(root, 'app/data/db/sekisan-kanri.db'))
    const { reorderCuts, maxWidthMm, rollCutMode, ...oldBody } = saved.body
    legacy
      .prepare('UPDATE room_layouts SET body=? WHERE roomId=?')
      .run(JSON.stringify(oldBody), roomId)
    legacy.exec('ALTER TABLE rooms DROP COLUMN geometryType; PRAGMA user_version=11')
    const rows = legacy.prepare('SELECT * FROM room_layouts ORDER BY roomId').all()
    legacy.close()
    const migrated = new Storage(join(root, 'app'))
    try {
      assert.equal(migrated.readLayout(roomId)!.body.reorderCuts, false)
      assert.equal(migrated.readLayout(roomId)!.body.rollCutMode, 'width')
      assert.equal(migrated.readLayout(roomId)!.body.maxWidthMm, null)
      const check = new Database(join(root, 'app/data/db/sekisan-kanri.db'))
      assert.equal(check.pragma('user_version', { simple: true }), 15)
      assert.deepEqual(check.prepare('SELECT * FROM room_layouts ORDER BY roomId').all(), rows)
      check.close()
      assert.ok(
        readdirSync(join(root, 'app/recovery')).some((n) => n.startsWith('before-schema-v15-'))
      )
    } finally {
      migrated.close()
    }
  } finally {
    s.close()
    rmSync(root, { recursive: true, force: true })
  }
})
