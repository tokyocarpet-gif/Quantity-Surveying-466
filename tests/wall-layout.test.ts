import { defaultWallPanel } from '../src/shared/wall-panels'
import { validateWalls } from '../src/main/wall-layout-storage'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PDFDocument } from 'pdf-lib'
import { computeWall, wallpaperSchema, type WallBody } from '../src/shared/wall-layout'
import { emptyFinishes } from '../src/shared/takeoff'
import { Storage } from '../src/main/storage'
import { wallPrintHtml } from '../src/main/wall-layout-print'
const base = (): WallBody => ({
  name: '会議室・壁1',
  points: [
    { x: 0, y: 0 },
    { x: 400, y: 0 }
  ],
  roomId: null,
  edgeIndex: null,
  scale: 0.01,
  heightMm: 2400,
  materialName: 'テストクロス',
  material: {
    widthMm: 920,
    repeatMm: 0,
    horizontalRepeatMm: 0,
    match: 'none',
    stepMm: 0,
    rollLengthMm: null
  },
  topTrimMm: 50,
  bottomTrimMm: 50,
  offsetMm: 0,
  openings: []
})
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
test('壁の縮尺はm/図面座標からmmに換算。幅なりと端部、貼り始め・左右反転', () => {
  const b = base(),
    r = computeWall(b)
  assert.equal(r.widthMm, 4000)
  assert.equal(r.drops.length, 5)
  assert.equal(r.drops.at(-1)!.widthMm, 320)
  assert.equal(r.usedMm, 12500)
  assert.equal(r.cutMm, 12500)
  assert.equal(r.wasteMm, 0)
  near(r.netArea, 9.6)
  assert.deepEqual(computeWall({ ...b, points: [b.points[1], b.points[0]] }), r)
  const offset = computeWall({ ...b, offsetMm: 800 })
  assert.equal(offset.drops.length, 6)
  assert.equal(offset.drops[0].widthMm, 120)
  near(
    offset.drops.reduce((s, d) => s + d.widthMm, 0),
    4000
  )
  assert.equal(
    computeWall({
      ...b,
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 400 }
      ]
    }).widthMm,
    5000
  )
})
test('無地・ストレート・ステップ柄の裁断長と柄出し、横リピートは数量を変えない', () => {
  const b = base()
  b.material = { ...b.material, repeatMm: 640, horizontalRepeatMm: 920, match: 'straight' }
  const r = computeWall(b)
  assert.equal(r.cutMm, 5 * 2560)
  assert.equal(r.wasteMm, 640)
  assert.equal(r.usedMm, 13440)
  const step = computeWall({ ...b, material: { ...b.material, match: 'step', stepMm: 320 } })
  assert.deepEqual(
    step.drops.map((d) => d.phaseMm),
    [0, 320, 0, 320, 0]
  )
  assert.equal(step.wasteMm, 640 + 4 * 320)
  const third = computeWall({
    ...b,
    material: { ...b.material, repeatMm: 600, match: 'step', stepMm: 200 }
  })
  assert.deepEqual(
    third.drops.map((d) => d.phaseMm),
    [0, 200, 400, 0, 200]
  )
  assert.equal(third.cutMm, 15000)
  assert.deepEqual(computeWall({ ...b, material: { ...b.material, horizontalRepeatMm: 0 } }), r)
  assert.equal(computeWall({ ...b, material: { ...b.material, match: 'none' } }).usedMm, 12500)
})
test('巻き長さによる分割、巻き始めの柄出し、裁断できない寸法を拒否', () => {
  const b = base()
  b.material = { ...b.material, repeatMm: 640, match: 'step', stepMm: 320, rollLengthMm: 6300 }
  const r = computeWall(b)
  assert.equal(r.rollCount, 3)
  assert.deepEqual(
    r.rolls.map((r) => r.drops),
    [[1, 2], [3, 4], [5]]
  )
  assert.ok(r.rolls.every((r) => r.usedMm <= 6300))
  assert.equal(
    r.usedMm,
    r.rolls.reduce((s, r) => s + r.usedMm, 0)
  )
  assert.throws(
    () => computeWall({ ...b, material: { ...b.material, rollLengthMm: 3000 } }),
    /巻き長さ/
  )
  assert.equal(
    computeWall({ ...base(), material: { ...base().material, rollLengthMm: 5000 } }).rollCount,
    3
  )
})
test('開口面積だけ控除。全高かつ巾全体の開口のみ裁断を省略し、柄の連続性を保つ', () => {
  const b = base(),
    door = { id: randomUUID(), name: 'ドア', xMm: 0, bottomMm: 0, widthMm: 920, heightMm: 2000 }
  const r = computeWall({ ...b, openings: [door] })
  near(r.netArea, 9.6 - 1.84)
  assert.equal(r.cutMm, 12500)
  const all = computeWall({
    ...b,
    material: { ...b.material, match: 'step', repeatMm: 600, stepMm: 300 },
    openings: [{ ...door, heightMm: 2400 }]
  })
  assert.equal(all.drops[0].skipped, true)
  assert.equal(all.drops[1].phaseMm, 300)
  assert.equal(all.drops[1].wasteMm, 900)
  assert.throws(
    () => computeWall({ ...b, openings: [door, { ...door, id: randomUUID() }] }),
    /重なって/
  )
  assert.throws(() => computeWall({ ...b, openings: [{ ...door, xMm: 3900 }] }), /範囲内/)
  const blank = computeWall({ ...b, openings: [{ ...door, widthMm: 4000, heightMm: 2400 }] })
  assert.equal(blank.usedMm, 0)
  assert.equal(blank.netArea, 0)
})
test('不正な規格・重複ID・過密配置を拒否する', () => {
  assert.throws(
    () => wallpaperSchema.parse({ ...base().material, match: 'straight' }),
    /縦リピート/
  )
  assert.throws(
    () => wallpaperSchema.parse({ ...base().material, match: 'step', repeatMm: 500, stepMm: 500 }),
    /ステップ/
  )
  assert.throws(() => computeWall({ ...base(), offsetMm: 920 }), /有効幅/)
  assert.throws(
    () => computeWall({ ...base(), material: { ...base().material, widthMm: 1 } }),
    /2,000/
  )
  assert.throws(
    () =>
      computeWall({
        ...base(),
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 }
        ]
      }),
    /壁の長さ/
  )
})
test('壁・マスタ保存、PDF、競合と古い形状の拒否、バックアップ復元、v18移行', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'wall-test-'))
  let s = new Storage(join(folder, 'app'))
  try {
    const c = s.createClient('顧客'),
      p = s.createProject({ clientId: c.id, name: '工事', memo: '', status: 'active' })
    const pdf = await PDFDocument.create()
    pdf.addPage([842, 595])
    const path = join(folder, 'wall.pdf')
    writeFileSync(path, await pdf.save())
    const drawing = (await s.importPdfs(p.id, [path])).imported[0],
      address = { drawingId: drawing.id, pageNumber: 1 },
      roomId = randomUUID()
    let page = s.applyTakeoff({
      ...address,
      expectedRevision: 0,
      change: {
        kind: 'scale',
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 }
        ],
        lengthMm: 4000
      }
    })
    page = s.applyTakeoff({
      ...address,
      expectedRevision: page.revision,
      change: {
        kind: 'room',
        id: roomId,
        input: {
          name: '会議室',
          color: '#327e6d',
          polygon: [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
            { x: 0, y: 300 }
          ],
          heightMm: 2400,
          finishes: emptyFinishes()
        }
      }
    })
    const materialId = randomUUID(),
      wallpaper = {
        ...base().material,
        repeatMm: 600,
        match: 'step' as const,
        stepMm: 300,
        rollLengthMm: 50000
      }
    s.changeMaterials({
      kind: 'save',
      id: materialId,
      input: { projectId: null, category: 'wall', name: '柄クロス', unitPrice: null, wallpaper }
    })
    s.changeMaterials({ kind: 'import', projectId: p.id, ids: [materialId] })
    assert.deepEqual(s.readMaterials(p.id).project[0].wallpaper, wallpaper)
    const input = {
      ...address,
      id: randomUUID(),
      expectedRevision: 0,
      body: { ...base(), roomId, edgeIndex: 0, material: wallpaper }
    }
    const doc = s.saveWall(input)
    assert.deepEqual(s.readWalls(address), [doc])
    assert.deepEqual(s.readTakeoff(address), page)
    assert.throws(() => s.saveWall(input), /更新/)
    assert.throws(() => s.deleteWall({ id: doc.id, expectedRevision: 2 }), /更新/)
    const report = s.wallReport({ ...input, expectedRevision: doc.revision })
    const html = wallPrintHtml(report)
    assert.ok(html.includes('壁クロス割り付け'))
    assert.ok(html.includes('<svg'))
    assert.ok(html.includes('ステップ'))
    const tileInput = {
      ...input,
      id: randomUUID(),
      body: {
        ...input.body,
        kind: 'tile' as const,
        startSide: 'right' as const,
        panel: {
          ...defaultWallPanel(),
          widthMm: 300,
          heightMm: 600,
          gapMm: 3,
          pattern: 'half' as const
        }
      }
    }
    const tileDoc = s.saveWall(tileInput)
    const protectionInput = {
      ...tileInput,
      id: randomUUID(),
      body: {
        ...tileInput.body,
        kind: 'protection' as const,
        panel: {
          ...tileInput.body.panel,
          gapMm: 0,
          pattern: 'straight' as const,
          widthMm: 910,
          heightMm: 1820,
          coverageHeightMm: 900
        }
      }
    }
    const protectionDoc = s.saveWall(protectionInput)
    const tileReport = s.wallReport({ ...tileInput, expectedRevision: 1 })
    assert.ok(tileReport.result.panel!.count > 0)
    const tileHtml = wallPrintHtml(tileReport)
    assert.match(tileHtml, /壁タイル割り付け/)
    assert.match(tileHtml, /必要元材/)
    assert.match(tileHtml, /右から/)
    assert.match(tileHtml, /外形 横 mm/)
    assert.deepEqual(s.readTakeoff(address), page)
    const batchInput = {
      ...address,
      walls: [protectionDoc, doc, tileDoc].map((d) => ({ id: d.id, expectedRevision: d.revision }))
    }
    const batch = s.wallBatchReport(batchInput)
    assert.deepEqual(
      batch.map((r) => r.input.id),
      [protectionDoc.id, doc.id, tileDoc.id]
    )
    const combinedHtml = wallPrintHtml(batch)
    assert.equal((combinedHtml.match(/class="wall-report"/g) ?? []).length, 3)
    assert.match(combinedHtml, /選択面の数量一覧/)
    assert.match(combinedHtml, /施工面積合計 22.8㎡/)
    assert.deepEqual(s.readWalls(address), [doc, tileDoc, protectionDoc])
    assert.throws(() => s.wallBatchReport({ ...address, walls: [] }), /選択/)
    assert.throws(
      () => s.wallBatchReport({ ...address, walls: [batchInput.walls[0], batchInput.walls[0]] }),
      /重複/
    )
    assert.throws(
      () =>
        s.wallBatchReport({
          ...address,
          walls: Array.from({ length: 101 }, () => ({ id: randomUUID(), expectedRevision: 1 }))
        }),
      /100面/
    )
    assert.throws(() => s.wallBatchReport({ ...batchInput, pageNumber: 2 }), /壁がありません/)
    assert.throws(
      () => s.wallBatchReport({ ...batchInput, drawingId: randomUUID() }),
      /壁がありません/
    )
    assert.throws(
      () => s.wallBatchReport({ ...address, walls: [{ id: doc.id, expectedRevision: 2 }] }),
      /更新/
    )
    const backup = join(folder, 'wall.sekisan-backup')
    await s.createBackup(backup)
    s.deleteWall({ id: doc.id, expectedRevision: doc.revision })
    assert.equal(s.readWalls(address).length, 2)
    assert.throws(() => s.wallBatchReport(batchInput), /壁がありません/)
    await s.restoreBackup(backup)
    assert.deepEqual(s.readWalls(address), [doc, tileDoc, protectionDoc])
    assert.deepEqual(s.readMaterials(p.id).project[0].wallpaper, wallpaper)
    s.applyTakeoff({
      ...address,
      expectedRevision: page.revision,
      change: {
        kind: 'scale',
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 }
        ],
        lengthMm: 8000
      }
    })
    assert.throws(() => s.wallReport({ ...input, expectedRevision: doc.revision }), /縮尺/)
    assert.throws(() => s.wallBatchReport(batchInput), /縮尺/)
    await s.restoreBackup(backup)
    s.applyTakeoff({
      ...address,
      expectedRevision: page.revision,
      change: { kind: 'deleteRoom', id: roomId }
    })
    assert.throws(() => s.saveWall({ ...input, expectedRevision: doc.revision }), /参照する壁/)
    // Historical snapshots survive source changes; manual walls need no room.
    const manual = s.saveWall({
      ...input,
      id: randomUUID(),
      body: { ...input.body, roomId: null, edgeIndex: null }
    })
    assert.equal(manual.revision, 1)
    s.close()
    const db = new Database(join(folder, 'app/data/db/sekisan-kanri.db'))
    db.pragma('user_version=20')
    assert.throws(() => validateWalls(db), /v21/)
    const originalBodies = db.prepare('SELECT * FROM wall_layouts ORDER BY id').all()
    db.close()
    s = new Storage(join(folder, 'app'))
    s.close()
    const check = new Database(join(folder, 'app/data/db/sekisan-kanri.db'))
    assert.deepEqual(check.prepare('SELECT * FROM wall_layouts ORDER BY id').all(), originalBodies)
    check.close()
    const v19 = new Database(join(folder, 'app/data/db/sekisan-kanri.db'))
    v19.pragma('user_version=19')
    assert.throws(() => validateWalls(v19), /v20/)
    v19.prepare('DELETE FROM wall_layouts WHERE id IN (?,?)').run(tileDoc.id, protectionDoc.id)
    const wallRows = v19.prepare('SELECT * FROM wall_layouts ORDER BY id').all()
    v19.close()
    s = new Storage(join(folder, 'app'))
    s.close()
    const oldData = new Database(join(folder, 'app/data/db/sekisan-kanri.db'))
    assert.deepEqual(oldData.prepare('SELECT * FROM wall_layouts ORDER BY id').all(), wallRows)
    oldData.close()
    const legacy = new Database(join(folder, 'app/data/db/sekisan-kanri.db'))
    legacy.exec(
      'DROP TABLE wall_layouts; ALTER TABLE materials DROP COLUMN wallpaper; PRAGMA user_version=18'
    )
    const rows = legacy.prepare('SELECT * FROM materials ORDER BY id').all()
    legacy.close()
    s = new Storage(join(folder, 'app'))
    const after = new Database(join(folder, 'app/data/db/sekisan-kanri.db'))
    assert.equal(after.pragma('user_version', { simple: true }), 21)
    assert.deepEqual(
      (after.prepare('SELECT * FROM materials ORDER BY id').all() as any[]).map(
        ({ wallpaper, ...rest }) => rest
      ),
      rows
    )
    after.close()
    assert.ok(
      readdirSync(join(folder, 'app/recovery')).some((n) => n.startsWith('before-schema-v21-'))
    )
  } finally {
    s.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

test('クロスの右始まりは開口位置を変えず、右端から番号・柄合わせ・巻割りを計算する', () => {
  const b = base(),
    snapshot = JSON.stringify(b),
    r = computeWall({ ...b, startSide: 'right' })
  assert.deepEqual(
    r.drops.map((d) => [d.number, d.xMm, d.widthMm]),
    [
      [1, 3080, 920],
      [2, 2160, 920],
      [3, 1240, 920],
      [4, 320, 920],
      [5, 0, 320]
    ]
  )
  assert.equal(r.usedMm, computeWall(b).usedMm)
  const offset = computeWall({ ...b, startSide: 'right', offsetMm: 200 })
  assert.equal(offset.drops[0].xMm, 3280)
  assert.equal(offset.drops[0].widthMm, 720)
  const opened = {
    ...b,
    openings: [
      { id: randomUUID(), name: '全高開口', xMm: 3080, bottomMm: 0, widthMm: 920, heightMm: 2400 }
    ],
    material: {
      ...b.material,
      match: 'step' as const,
      repeatMm: 640,
      stepMm: 320,
      rollLengthMm: 6300
    }
  }
  const right = computeWall({ ...opened, startSide: 'right' }),
    mirror = computeWall({
      ...opened,
      openings: opened.openings.map((o) => ({ ...o, xMm: 4000 - o.xMm - o.widthMm }))
    })
  assert.equal(right.drops[0].skipped, true)
  assert.equal(right.drops[1].phaseMm, 320)
  assert.deepEqual(right.rolls, mirror.rolls)
  assert.equal(right.usedMm, mirror.usedMm)
  assert.deepEqual(
    right.drops.map((d) => ({ ...d, xMm: 4000 - d.xMm - d.widthMm })),
    mirror.drops
  )
  assert.equal(JSON.stringify(b), snapshot)
  assert.deepEqual(computeWall({ ...b, startSide: 'left' }), computeWall(b))
})
