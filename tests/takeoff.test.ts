import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { PDFDocument } from 'pdf-lib'
import { summaryRequestSchema } from '../src/shared/summary'
import { validateTakeoffData } from '../src/main/takeoff-storage'
import { Storage } from '../src/main/storage'
import { BASE_SQL } from '../src/main/schema'
import {
  categories,
  emptyFinishes,
  geometry,
  roomQuantities,
  scaleFromCalibration,
  scaleDenominator,
  netQuantity,
  type PageState,
  type Point,
  type RoomInput,
  type TakeoffChange,
  type TakeoffMutation
} from '../src/shared/takeoff'

const polygon: Point[] = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
  { x: 500, y: 400 },
  { x: 100, y: 400 }
]
const roomInput = (): RoomInput => ({
  name: '会議室',
  color: '#327e6d',
  heightMm: 2400,
  polygon,
  enabledCategories: [...categories],
  sleeveWalls: [],
  finishes: emptyFinishes()
})
const near = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-takeoff-'))
  const storage = new Storage(join(folder, 'app'))
  const client = storage.createClient('テスト顧客'),
    project = storage.createProject({
      clientId: client.id,
      name: '案件',
      memo: '',
      status: 'active'
    })
  const pdf = await PDFDocument.create()
  pdf.addPage([842, 595])
  pdf.addPage([842, 595])
  const path = join(folder, '図面.pdf')
  writeFileSync(path, await pdf.save())
  const drawing = (await storage.importPdfs(project.id, [path])).imported[0]
  const address = { drawingId: drawing.id, pageNumber: 1 }
  const read = () => storage.readTakeoff(address)
  const mutation = (change: TakeoffChange): TakeoffMutation => ({
    ...address,
    expectedRevision: read().revision,
    change: change.kind === 'room' ? { ...change, duplicateChoice: 'separate' } : change
  })
  const apply = (change: TakeoffChange): PageState => storage.applyTakeoff(mutation(change))
  const scale = () => apply({ kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 })
  const room = () => {
    const id = randomUUID()
    apply({ kind: 'room', id, input: roomInput() })
    return id
  }
  const cleanup = () => {
    storage.close()
    rmSync(folder, { recursive: true, force: true })
  }
  return { folder, storage, drawing, address, read, mutation, apply, scale, room, cleanup }
}

test('基準の4m×3m・高さ2400mmが天井12、壁33.6、巾木14、床12になる', () => {
  assert.deepEqual(roomQuantities(polygon, 0.01, 2400), {
    ceiling: 12,
    wall: 33.6,
    baseboard: 14,
    floor: 12
  })
  near(scaleFromCalibration([polygon[0], polygon[1]], 4000), 0.01)
})
test('凹形状と逆向きのポリゴンでも面積・閉じた外周を計算する', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 3 }
  ]
  assert.deepEqual(geometry(points), { area: 6, perimeter: 14 })
  assert.deepEqual(geometry([...points].reverse()), geometry(points))
})
test('自己交差・重複点・折り返し・ゼロ面積・無効な縮尺と高さを拒否する', () => {
  assert.throws(() =>
    geometry([
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
      { x: 4, y: 0 }
    ])
  )
  assert.throws(() =>
    geometry([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 4, y: 3 }
    ])
  )
  assert.throws(() =>
    geometry([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 3 }
    ])
  )
  assert.throws(() =>
    geometry([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ])
  )
  assert.throws(() => roomQuantities(polygon, null, 2400))
  assert.throws(() => roomQuantities(polygon, 0.01, 0))
  assert.throws(() => roomQuantities(polygon, NaN, 2400))
  assert.throws(() => scaleFromCalibration([polygon[0], polygon[0]], 4000))
})
test('縮尺未設定の部屋登録は数量や部屋を保存しない', async () => {
  const f = await fixture()
  try {
    assert.throws(() => f.room())
    assert.equal(f.read().rooms.length, 0)
    assert.equal(f.read().items.length, 0)
  } finally {
    f.cleanup()
  }
})
test('プレビューだけでは保存せず、キャンセル後も元数量を保持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room(),
      before = f.read()
    const preview = f.storage.previewTakeoff(
      f.mutation({ kind: 'room', id, input: { ...roomInput(), heightMm: 3000 } })
    )
    near(preview.rows.find((r) => r.category === 'wall')!.after!, 42)
    assert.deepEqual(f.read(), before)
  } finally {
    f.cleanup()
  }
})
test('高さ変更で壁だけ42㎡へ変わり、部屋と4明細のIDが維持される', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room(),
      before = f.read()
    const after = f.apply({ kind: 'room', id, input: { ...roomInput(), heightMm: 3000 } })
    near(after.items.find((i) => i.category === 'wall')!.quantity, 42)
    assert.deepEqual(
      after.items.map((i) => i.id),
      before.items.map((i) => i.id)
    )
    near(after.items.find((i) => i.category === 'floor')!.quantity, 12)
    near(after.items.find((i) => i.category === 'baseboard')!.quantity, 14)
  } finally {
    f.cleanup()
  }
})
test('縮尺2倍で面積4倍・外周2倍・高さ一定の壁2倍になる', async () => {
  const f = await fixture()
  try {
    f.scale()
    f.room()
    const state = f.apply({ kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 8000 })
    near(state.items.find((i) => i.category === 'floor')!.quantity, 48)
    near(state.items.find((i) => i.category === 'wall')!.quantity, 67.2)
    near(state.items.find((i) => i.category === 'baseboard')!.quantity, 28)
  } finally {
    f.cleanup()
  }
})
test('形状を描き直すと面積と外周が再計算され、既存明細のIDを維持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room(),
      before = f.read()
    const next = f.apply({
      kind: 'room',
      id,
      input: {
        ...roomInput(),
        polygon: [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
          { x: 300, y: 400 },
          { x: 100, y: 400 }
        ]
      }
    })
    near(next.items.find((i) => i.category === 'floor')!.quantity, 6)
    near(next.items.find((i) => i.category === 'wall')!.quantity, 24)
    near(next.items.find((i) => i.category === 'baseboard')!.quantity, 10)
    assert.deepEqual(
      next.items.map((i) => i.id),
      before.items.map((i) => i.id)
    )
  } finally {
    f.cleanup()
  }
})
test('壁の開口900×2000は1.8㎡、巾木は0.9mを控除し、再計算後も参照を維持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const roomId = f.room()
    let state = f.read()
    const wall = state.items.find((i) => i.category === 'wall')!,
      base = state.items.find((i) => i.category === 'baseboard')!
    const id = randomUUID()
    f.apply({
      kind: 'deduction',
      id,
      input: { targetItemId: wall.id, name: '入口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    state = f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: base.id, name: '入口巾木', widthMm: 900, heightMm: 2000, count: 1 }
    })
    near(netQuantity(wall, state.deductions), 31.8)
    near(netQuantity(base, state.deductions), 13.1)
    state = f.apply({ kind: 'room', id: roomId, input: { ...roomInput(), heightMm: 3000 } })
    near(
      netQuantity(
        state.items.find((i) => i.category === 'wall')!,
        state.deductions
      ),
      40.2
    )
    assert.equal(state.deductions.find((d) => d.id === id)!.targetItemId, wall.id)
    assert.equal(state.deductions.length, 2)
  } finally {
    f.cleanup()
  }
})
test('過大控除は負の正味数量を保持し、確認対象として返す', async () => {
  const f = await fixture()
  try {
    f.scale()
    f.room()
    const wall = f.read().items.find((i) => i.category === 'wall')!
    const input = f.mutation({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: '過大', widthMm: 20000, heightMm: 3000, count: 1 }
    })
    const preview = f.storage.previewTakeoff(input)
    assert.equal(preview.warnings.length, 1)
    const after = f.storage.applyTakeoff(input)
    near(netQuantity(wall, after.deductions), -26.4)
  } finally {
    f.cleanup()
  }
})
test('数量固定を保持し、自動計算へ戻した時に最新の形状・縮尺の値になる', async () => {
  const f = await fixture()
  try {
    f.scale()
    f.room()
    const floor = f.read().items.find((i) => i.category === 'floor')!
    f.apply({ kind: 'fixed', itemId: floor.id, quantity: 15 })
    let state = f.apply({ kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 8000 })
    const fixed = state.items.find((i) => i.id === floor.id)!
    near(fixed.quantity, 48)
    near(netQuantity(fixed, state.deductions), 15)
    state = f.apply({ kind: 'fixed', itemId: floor.id, quantity: null })
    near(
      netQuantity(
        state.items.find((i) => i.id === floor.id)!,
        state.deductions
      ),
      48
    )
  } finally {
    f.cleanup()
  }
})
test('同名の部屋とページを混ぜず、他ページの部屋や控除対象を拒否する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const first = f.room()
    f.room()
    assert.equal(f.read().rooms.length, 2)
    assert.equal(f.read().items.length, 8)
    const second = { drawingId: f.drawing.id, pageNumber: 2 }
    assert.equal(f.storage.readTakeoff(second).rooms.length, 0)
    f.storage.applyTakeoff({
      ...second,
      expectedRevision: 0,
      change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }
    })
    assert.throws(() =>
      f.storage.applyTakeoff({
        ...second,
        expectedRevision: 1,
        change: { kind: 'room', id: first, input: roomInput() }
      })
    )
    assert.throws(() =>
      f.storage.applyTakeoff({
        ...second,
        expectedRevision: 1,
        change: {
          kind: 'deduction',
          id: randomUUID(),
          input: {
            targetItemId: f.read().items[1].id,
            name: '他ページ',
            widthMm: 900,
            heightMm: 2000,
            count: 1
          }
        }
      })
    )
  } finally {
    f.cleanup()
  }
})
test('古いプレビューの反映を拒否し、直近の編集を失わない', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room()
    const old = f.mutation({ kind: 'room', id, input: { ...roomInput(), heightMm: 3000 } })
    f.storage.previewTakeoff(old)
    f.apply({ kind: 'room', id, input: { ...roomInput(), name: '最新' } })
    assert.throws(() => f.storage.applyTakeoff(old))
    assert.equal(f.read().rooms[0].name, '最新')
  } finally {
    f.cleanup()
  }
})
test('部屋削除時に自動明細と控除を削除し、手動項目を部屋未指定で残す', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room()
    const item = f.read().items.find((i) => i.category === 'wall')!
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: item.id, name: '入口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    const db = (f.storage as unknown as { db: Database.Database }).db,
      manual = randomUUID()
    db.prepare(
      "INSERT INTO takeoff_items(id,roomId,drawingId,pageNumber,category,source,method,quantity,unit,finish,calculationVersion) VALUES (?,?,?,1,'floor','manual','manual',7,'㎡','手動',1)"
    ).run(manual, id, f.drawing.id)
    const after = f.apply({ kind: 'deleteRoom', id })
    assert.equal(after.rooms.length, 0)
    assert.equal(after.deductions.length, 0)
    assert.equal(after.items.length, 1)
    assert.equal(after.items[0].id, manual)
    assert.equal(after.items[0].roomId, null)
  } finally {
    f.cleanup()
  }
})
test('部屋更新の途中でDBが失敗しても形状・数量・リビジョンを全て巻き戻す', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room(),
      before = f.read()
    const db = (f.storage as unknown as { db: Database.Database }).db
    db.exec(
      "CREATE TEMP TRIGGER fail_update BEFORE UPDATE ON takeoff_items BEGIN SELECT RAISE(ABORT,'injected failure'); END"
    )
    assert.throws(
      () => f.apply({ kind: 'room', id, input: { ...roomInput(), heightMm: 3000 } }),
      /injected failure/
    )
    assert.deepEqual(f.read(), before)
  } finally {
    f.cleanup()
  }
})
test('部屋・数量固定・開口控除をバックアップ復元し再起動しても保持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    f.room()
    const item = f.read().items.find((i) => i.category === 'wall')!
    f.apply({ kind: 'fixed', itemId: item.id, quantity: 35 })
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: item.id, name: '入口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    const before = f.read(),
      backup = join(f.folder, 'takeoff.sekisan-backup')
    await f.storage.createBackup(backup)
    f.apply({ kind: 'deleteRoom', id: before.rooms[0].id })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.read(), before)
    f.storage.close()
    const reopened = new Storage(join(f.folder, 'app'))
    try {
      assert.deepEqual(reopened.readTakeoff(f.address), before)
    } finally {
      reopened.close()
    }
  } finally {
    f.cleanup()
  }
})
test('v1の既存DBを退避してv8へ移行し、元データを保持する', () => {
  const folder = mkdtempSync(join(tmpdir(), 'sekisan-migration-')),
    root = join(folder, 'app')
  mkdirSync(join(root, 'data/db'), { recursive: true })
  const db = new Database(join(root, 'data/db/sekisan-kanri.db'))
  db.exec(BASE_SQL)
  const id = randomUUID()
  db.prepare('INSERT INTO clients VALUES (?,?,?)').run(id, '旧版の顧客', new Date().toISOString())
  db.close()
  const storage = new Storage(root)
  try {
    assert.equal(storage.workspace().clients[0].name, '旧版の顧客')
    const backups = readdirSync(join(root, 'recovery'))
    assert.equal(backups.length, 1)
    const old = new Database(join(root, 'recovery', backups[0]), { readonly: true })
    try {
      assert.equal(old.pragma('user_version', { simple: true }), 1)
    } finally {
      old.close()
    }
  } finally {
    storage.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
test('v1バックアップを検証してからv8へ変換・復元する', async () => {
  const f = await fixture()
  try {
    const snapshot = join(f.folder, 'v1.db'),
      db = new Database(snapshot)
    db.exec(BASE_SQL)
    db.prepare('INSERT INTO clients VALUES (?,?,?)').run(
      randomUUID(),
      '旧バックアップ',
      new Date().toISOString()
    )
    db.close()
    const data = readFileSync(snapshot),
      zip = new AdmZip()
    zip.addFile('db/sekisan-kanri.db', data)
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          application: 'sekisan-kanri',
          formatVersion: 1,
          schemaVersion: 1,
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
    const backup = join(f.folder, 'old.sekisan-backup')
    zip.writeZip(backup)
    await f.storage.restoreBackup(backup)
    assert.equal(f.storage.workspace().clients[0].name, '旧バックアップ')
    const internal = (f.storage as unknown as { db: Database.Database }).db
    assert.equal(internal.pragma('user_version', { simple: true }), 14)
  } finally {
    f.cleanup()
  }
})

test('選択した部位だけ登録し、解除した部位の控除だけを確認後に削除する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room()
    const before = f.read()
    const wall = before.items.find((i) => i.category === 'wall')!
    const floor = before.items.find((i) => i.category === 'floor')!
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: '入口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    f.apply({ kind: 'fixed', itemId: floor.id, quantity: 15 })
    const mutation = f.mutation({
      kind: 'room',
      id,
      input: { ...roomInput(), enabledCategories: ['floor'] }
    })
    const preview = f.storage.previewTakeoff(mutation)
    assert.equal(preview.after.items.length, 1)
    assert.equal(preview.after.items[0].id, floor.id)
    assert.equal(preview.after.items[0].fixedQuantity, 15)
    assert.equal(preview.after.deductions.length, 0)
    assert.match(preview.warnings.join(''), /控除 1 件/)
    assert.equal(f.read().items.length, 4)
    assert.equal(f.read().deductions.length, 1)
    f.storage.applyTakeoff(mutation)
    assert.deepEqual(f.read().rooms[0].enabledCategories, ['floor'])
    assert.throws(() =>
      f.apply({ kind: 'room', id, input: { ...roomInput(), enabledCategories: [] } })
    )
  } finally {
    f.cleanup()
  }
})
test('他の部屋の数量・過大控除を部屋編集と数量固定の確認に表示しない', async () => {
  const f = await fixture()
  try {
    f.scale()
    const a = f.room()
    const b = randomUUID()
    f.apply({ kind: 'room', id: b, input: { ...roomInput(), name: '事務室' } })
    const wall = f.read().items.find((i) => i.roomId === b && i.category === 'wall')!
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: '過大', widthMm: 90000, heightMm: 2000, count: 1 }
    })
    const preview = f.storage.previewTakeoff(
      f.mutation({ kind: 'room', id: a, input: { ...roomInput(), heightMm: 3000 } })
    )
    assert.equal(preview.rows.length, 4)
    assert.ok(preview.rows.every((r) => r.roomName === '会議室'))
    assert.deepEqual(preview.warnings, [])
    const item = f.read().items.find((i) => i.roomId === a && i.category === 'floor')!
    const fixed = f.storage.previewTakeoff(
      f.mutation({ kind: 'fixed', itemId: item.id, quantity: 20 })
    )
    assert.equal(fixed.rows.length, 1)
    assert.equal(fixed.rows[0].itemId, item.id)
  } finally {
    f.cleanup()
  }
})
test('同名の統合は明示選択を要求し、範囲・明細ID・控除・単価・固定数量を保持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const a = f.room()
    const b = randomUUID()
    const old = f.read()
    const floor = old.items.find((i) => i.category === 'floor')!
    f.apply({ kind: 'fixed', itemId: floor.id, quantity: 15 })
    const wall = old.items.find((i) => i.category === 'wall')!
    const deduction = randomUUID()
    f.apply({
      kind: 'deduction',
      id: deduction,
      input: { targetItemId: wall.id, name: '入口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    const finishes = emptyFinishes()
    finishes.floor = { name: '別の床材', unitPrice: 1234 }
    const change: TakeoffChange = {
      kind: 'room',
      id: b,
      input: { ...roomInput(), finishes, enabledCategories: ['floor'], heightMm: 3000 }
    }
    assert.throws(
      () => f.storage.previewTakeoff({ ...f.address, expectedRevision: f.read().revision, change }),
      /同名/
    )
    const separate = f.storage.previewTakeoff(f.mutation(change))
    assert.equal(new Set(separate.after.rooms.map((r) => r.groupId)).size, 2)
    const merge = f.mutation({ ...change, mergeInto: a })
    const preview = f.storage.previewTakeoff(merge)
    assert.equal(new Set(preview.after.rooms.map((r) => r.groupId)).size, 1)
    assert.equal(f.read().rooms.length, 1)
    f.storage.applyTakeoff(merge)
    assert.equal(f.read().rooms.length, 2)
    assert.equal(f.read().items.length, 5)
    assert.equal(f.read().items.find((i) => i.id === floor.id)!.fixedQuantity, 15)
    assert.equal(f.read().items.find((i) => i.roomId === b)!.unitPrice, 1234)
    assert.equal(f.read().deductions[0].id, deduction)
    assert.equal(
      f
        .read()
        .items.filter((i) => i.category === 'floor')
        .reduce((n, i) => n + netQuantity(i, f.read().deductions), 0),
      27
    )
    f.apply({ kind: 'room', id: b, input: { ...change.input, name: '統合会議室' } })
    assert.ok(f.read().rooms.every((r) => r.name === '統合会議室'))
    f.apply({ kind: 'deleteRoom', id: a })
    assert.equal(f.read().rooms[0].id, b)
    assert.equal(f.read().items.length, 1)
    const backup = join(f.folder, 'merged.sekisan-backup')
    await f.storage.createBackup(backup)
    await f.storage.restoreBackup(backup)
    assert.equal(f.read().rooms[0].groupId, a)
  } finally {
    f.cleanup()
  }
})
test('共通材料を一括で物件へコピーし、単価変更・削除から既存の材料と拾いを保護する', async () => {
  const f = await fixture()
  try {
    const pid = f.drawing.projectId
    const initial = f.storage.readMaterials(pid)
    assert.ok(initial.global.length >= 9)
    assert.equal(initial.project.length, 0)
    const ids = initial.global
      .filter((m) => ['wall', 'floor'].includes(m.category))
      .map((m) => m.id)
    f.storage.changeMaterials({ kind: 'import', projectId: pid, ids })
    f.storage.changeMaterials({ kind: 'import', projectId: pid, ids })
    assert.equal(f.storage.readMaterials(pid).project.length, ids.length)
    const source = initial.global.find((m) => m.id === ids[0])!
    const material = f.storage.readMaterials(pid).project.find((m) => m.sourceId === source.id)!
    f.storage.changeMaterials({
      kind: 'save',
      id: source.id,
      input: { projectId: null, category: source.category, name: '共通変更', unitPrice: 9000 }
    })
    assert.equal(
      f.storage.readMaterials(pid).project.find((m) => m.id === material.id)!.name,
      material.name
    )
    f.storage.changeMaterials({
      kind: 'save',
      id: material.id,
      input: { projectId: pid, category: material.category, name: '物件用材料', unitPrice: 2400 }
    })
    f.scale()
    const id = randomUUID()
    const finishes = emptyFinishes()
    finishes[material.category as (typeof categories)[number]] = {
      name: '物件用材料',
      unitPrice: 2400
    }
    f.apply({ kind: 'room', id, input: { ...roomInput(), finishes } })
    f.storage.changeMaterials({ kind: 'delete', id: source.id })
    assert.equal(
      f.storage.readMaterials(pid).project.find((m) => m.id === material.id)!.sourceId,
      null
    )
    f.storage.changeMaterials({ kind: 'delete', id: material.id })
    assert.equal(f.read().items.find((i) => i.category === material.category)!.unitPrice, 2400)
    const before = f.storage.readMaterials(pid)
    assert.throws(() =>
      f.storage.changeMaterials({
        kind: 'import',
        projectId: pid,
        ids: [initial.global.at(-1)!.id, randomUUID()]
      })
    )
    assert.deepEqual(f.storage.readMaterials(pid), before, 'invalid batch is atomic')
    assert.throws(() =>
      f.storage.changeMaterials({
        kind: 'save',
        id: ids[1],
        input: { projectId: pid, category: 'floor', name: '所属変更', unitPrice: null }
      })
    )
    f.apply({ kind: 'deleteRoom', id })
    assert.deepEqual(f.storage.readMaterials(pid).roomNames, ['会議室'])
    const backup = join(f.folder, 'masters.sekisan-backup')
    await f.storage.createBackup(backup)
    f.storage.changeMaterials({ kind: 'delete', id: ids[1] })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.storage.readMaterials(pid), before)
  } finally {
    f.cleanup()
  }
})

for (const schemaVersion of [2, 3])
  test(`v${schemaVersion}の部屋・控除・固定数量を退避付きで移行し、旧バックアップも復元する`, async () => {
    const f = await fixture()
    try {
      f.scale()
      f.room()
      const floor = f.read().items.find((i) => i.category === 'floor')!
      const wall = f.read().items.find((i) => i.category === 'wall')!
      f.apply({ kind: 'fixed', itemId: floor.id, quantity: 15 })
      f.apply({
        kind: 'deduction',
        id: randomUUID(),
        input: { targetItemId: wall.id, name: '既存ドア', widthMm: 900, heightMm: 2000, count: 1 }
      })
      if (schemaVersion === 3)
        f.apply({
          kind: 'room',
          id: randomUUID(),
          mergeInto: f.read().rooms[0].id,
          input: roomInput()
        })
      const before = f.read(),
        oldPath = join(f.folder, 'v2.db'),
        old = new Database(oldPath)
      const { TAKEOFF_SQL } = await import('../src/main/takeoff-storage')
      old.exec(BASE_SQL)
      old.exec(TAKEOFF_SQL)
      if (schemaVersion === 3) {
        const { MASTER_SQL } = await import('../src/main/master-storage')
        old.exec(MASTER_SQL)
        old.exec('DELETE FROM materials')
      }
      const source = (f.storage as unknown as { db: Database.Database }).db
      for (const table of [
        'clients',
        'projects',
        'drawings',
        'settings',
        'drawing_pages',
        'rooms',
        'takeoff_items',
        'deductions',
        ...(schemaVersion === 3 ? ['materials', 'room_name_history'] : [])
      ]) {
        const columns = (
          old.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((r) => r.name)
        for (const row of source.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all())
          old
            .prepare(
              `INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`
            )
            .run(row)
      }
      old.close()
      const zip = new AdmZip(),
        data = readFileSync(oldPath),
        drawing = f.storage.readPdf(f.drawing.id)
      const pdfPath = `drawings/${f.drawing.id}.pdf`
      // Use the actual registered managed path (drawing IDs and storage filenames are independent).
      const registered = source
        .prepare('SELECT filePath FROM drawings WHERE id=?')
        .get(f.drawing.id) as { filePath: string }
      const files = [
        { path: 'db/sekisan-kanri.db', data },
        { path: registered.filePath || pdfPath, data: Buffer.from(drawing) }
      ]
      for (const file of files) zip.addFile(file.path, file.data)
      zip.addFile(
        'manifest.json',
        Buffer.from(
          JSON.stringify({
            application: 'sekisan-kanri',
            formatVersion: 1,
            schemaVersion,
            createdAt: new Date().toISOString(),
            files: files.map(({ path, data }) => ({
              path,
              size: data.length,
              sha256: createHash('sha256').update(data).digest('hex')
            }))
          })
        )
      )
      const backup = join(f.folder, 'v2.sekisan-backup')
      zip.writeZip(backup)
      const root = join(f.folder, 'old-app')
      mkdirSync(join(root, 'data/db'), { recursive: true })
      writeFileSync(join(root, 'data/db/sekisan-kanri.db'), data)
      const migrated = new Storage(root)
      try {
        assert.deepEqual(migrated.readTakeoff(f.address), before)
        assert.deepEqual(migrated.readMaterials(f.drawing.projectId).roomNames, ['会議室'])
        assert.deepEqual(migrated.readMaterials(f.drawing.projectId).heightHistory, [2400])
        const snapshots = readdirSync(join(root, 'recovery'))
        assert.equal(snapshots.length, 1)
        const snapshot = new Database(join(root, 'recovery', snapshots[0]), { readonly: true })
        try {
          assert.equal(snapshot.pragma('user_version', { simple: true }), schemaVersion)
        } finally {
          snapshot.close()
        }
      } finally {
        migrated.close()
      }
      f.apply({ kind: 'deleteRoom', id: before.rooms[0].id })
      await f.storage.restoreBackup(backup)
      assert.deepEqual(f.read(), before)
      assert.equal(f.storage.readMaterials(f.drawing.projectId).global.length, 9)
    } finally {
      f.cleanup()
    }
  })

test('高さ履歴は確定した値だけを物件ごとに保持し、同値を再採用すると先頭になる', async () => {
  const f = await fixture()
  try {
    const pid = f.drawing.projectId
    f.scale()
    const id = f.room()
    assert.deepEqual(f.storage.readMaterials(pid).heightHistory, [2400])
    const change: TakeoffChange = { kind: 'room', id, input: { ...roomInput(), heightMm: 2800 } }
    f.storage.previewTakeoff(f.mutation(change))
    assert.deepEqual(f.storage.readMaterials(pid).heightHistory, [2400])
    f.apply(change)
    assert.deepEqual(f.storage.readMaterials(pid).heightHistory, [2800, 2400])
    f.apply({ kind: 'room', id, input: roomInput() })
    assert.deepEqual(f.storage.readMaterials(pid).heightHistory, [2400, 2800])
    f.apply({
      kind: 'room',
      id: randomUUID(),
      input: { ...roomInput(), name: '別室', heightMm: 3000 }
    })
    f.apply({ kind: 'room', id, input: { ...roomInput(), name: '名前だけ変更' } })
    assert.deepEqual(
      f.storage.readMaterials(pid).heightHistory,
      [3000, 2400, 2800],
      'non-height edits do not change the last chosen height'
    )
    const other = f.storage.createProject({
      clientId: f.storage.workspace().clients[0].id,
      name: '別物件',
      memo: '',
      status: 'active'
    })
    assert.deepEqual(f.storage.readMaterials(other.id).heightHistory, [])
    const backup = join(f.folder, 'heights.sekisan-backup')
    await f.storage.createBackup(backup)
    f.apply({ kind: 'room', id, input: { ...roomInput(), heightMm: 4000 } })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.storage.readMaterials(pid).heightHistory, [3000, 2400, 2800])
  } finally {
    f.cleanup()
  }
})
test('厚みのない袖壁は外周と交差しても壁と巾木だけに加算し、再計算・控除・固定を保持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room()
    const input = {
      ...roomInput(),
      sleeveWalls: [
        {
          id: randomUUID(),
          name: '袖壁',
          points: [
            { x: 100, y: 200 },
            { x: 300, y: 200 }
          ] as [Point, Point],
          faces: 2 as const,
          heightMm: null,
          includeBaseboard: true
        }
      ]
    }
    const preview = f.storage.previewTakeoff(f.mutation({ kind: 'room', id, input }))
    assert.deepEqual(f.read().rooms[0].sleeveWalls, [])
    const qty = (state: PageState, c: string) => state.items.find((i) => i.category === c)!.quantity
    near(qty(preview.after, 'wall'), 43.2)
    near(qty(preview.after, 'baseboard'), 18)
    near(qty(preview.after, 'floor'), 12)
    near(qty(preview.after, 'ceiling'), 12)
    f.apply({ kind: 'room', id, input })
    const wall = f.read().items.find((i) => i.category === 'wall')!
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: '開口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    f.apply({ kind: 'room', id, input: { ...input, heightMm: 3000 } })
    near(qty(f.read(), 'wall'), 54)
    near(
      netQuantity(
        f.read().items.find((i) => i.id === wall.id)!,
        f.read().deductions
      ),
      52.2
    )
    const oneSide = {
      ...input,
      heightMm: 3000,
      sleeveWalls: [
        { ...input.sleeveWalls[0], faces: 1 as const, heightMm: 1000, includeBaseboard: false }
      ]
    }
    f.apply({ kind: 'room', id, input: oneSide })
    near(qty(f.read(), 'wall'), 44)
    near(qty(f.read(), 'baseboard'), 14)
    f.apply({ kind: 'fixed', itemId: wall.id, quantity: 80 })
    f.apply({ kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 8000 })
    near(qty(f.read(), 'wall'), 88)
    assert.equal(f.read().items.find((i) => i.id === wall.id)!.fixedQuantity, 80)
    const backup = join(f.folder, 'sleeve.sekisan-backup'),
      before = f.read()
    await f.storage.createBackup(backup)
    f.apply({ kind: 'deleteRoom', id })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.read(), before)
    f.apply({ kind: 'room', id, input: { ...oneSide, sleeveWalls: [] } })
    near(qty(f.read(), 'wall'), 84)
    assert.equal(f.read().deductions.length, 1)
    assert.throws(() =>
      f.apply({
        kind: 'room',
        id,
        input: {
          ...input,
          sleeveWalls: [{ ...input.sleeveWalls[0], points: [polygon[0], polygon[0]] }]
        }
      })
    )
  } finally {
    f.cleanup()
  }
})

test('PDF原寸基準の縮尺分母をポイントと実寸から求める', () => {
  near(scaleDenominator(25.4 / 720)!, 100)
  near(scaleDenominator(25.4 / 1440)!, 50)
  assert.equal(scaleDenominator(null), null)
})

test('同名の別登録は連番で確定し、プレビュー・履歴・統合・他ページと長い名前を扱う', async () => {
  const f = await fixture()
  try {
    f.scale()
    const first = f.room()
    const b = randomUUID(),
      c = randomUUID()
    const preview = f.storage.previewTakeoff(
      f.mutation({ kind: 'room', id: b, input: roomInput() })
    )
    assert.equal(preview.after.rooms.find((r) => r.id === b)!.name, '会議室（2）')
    assert.equal(f.read().rooms.length, 1)
    f.apply({ kind: 'room', id: b, input: roomInput() })
    f.apply({ kind: 'room', id: c, input: roomInput() })
    assert.deepEqual(
      f.read().rooms.map((r) => r.name),
      ['会議室', '会議室（2）', '会議室（3）']
    )
    assert.ok(f.storage.readMaterials(f.drawing.projectId).roomNames.includes('会議室（3）'))
    const merged = randomUUID()
    f.apply({ kind: 'room', id: merged, mergeInto: first, input: roomInput() })
    assert.equal(f.read().rooms.find((r) => r.id === merged)!.name, '会議室')
    f.apply({ kind: 'room', id: b, input: { ...roomInput(), name: '会議室（2）', heightMm: 3000 } })
    assert.equal(f.read().rooms.find((r) => r.id === b)!.name, '会議室（2）')
    const { numberedRoomName } = await import('../src/shared/takeoff')
    assert.equal(
      numberedRoomName('会議室（2）', ['会議室', '会議室（2）', '会議室（3）']),
      '会議室（4）'
    )
    const long = '室'.repeat(120),
      next = numberedRoomName(long, [long])
    assert.equal(next.length, 120)
    assert.ok(next.endsWith('（2）'))
    assert.notEqual(numberedRoomName(long, [long, next]), next)
    assert.equal(numberedRoomName('会議室', []), '会議室')
  } finally {
    f.cleanup()
  }
})

test('共通・物件マスタは登録順によらず天井・壁・巾木・床で整列する', async () => {
  const f = await fixture()
  try {
    const pid = f.drawing.projectId
    for (const projectId of [null, pid])
      for (const category of ['floor', 'baseboard', 'ceiling', 'wall'] as const)
        f.storage.changeMaterials({
          kind: 'save',
          id: randomUUID(),
          input: { projectId, category, name: '追加材' + category, unitPrice: null }
        })
    const context = f.storage.readMaterials(pid)
    for (const list of [context.global, context.project]) {
      const order = list.map((m) => categories.indexOf(m.category as (typeof categories)[number]))
      assert.deepEqual(
        order,
        [...order].sort((a, b) => a - b)
      )
    }
  } finally {
    f.cleanup()
  }
})

test('壁の延長mは高さを掛けず、袖壁の面数・開口幅・縮尺を反映して集計と見積へ引き継ぐ', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = randomUUID(),
      input = roomInput()
    input.finishes.wall = { name: '養生プラベニア', unit: 'm', unitPrice: 500 }
    input.sleeveWalls = [
      {
        id: randomUUID(),
        name: '袖壁',
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 }
        ],
        faces: 2,
        heightMm: 1000,
        includeBaseboard: false
      }
    ]
    let state = f.apply({ kind: 'room', id, input })
    let wall = state.items.find((i) => i.category === 'wall')!
    const wallId = wall.id
    near(wall.quantity, 16)
    assert.equal(wall.unit, 'm')
    assert.equal(wall.method, 'room-perimeter')
    near(state.items.find((i) => i.category === 'baseboard')!.quantity, 14)
    const deductionId = randomUUID()
    state = f.apply({
      kind: 'deduction',
      id: deductionId,
      input: { targetItemId: wallId, name: '出入口', widthMm: 900, heightMm: 2100, count: 1 }
    })
    near(
      netQuantity(
        state.items.find((i) => i.id === wallId)!,
        state.deductions
      ),
      15.1
    )
    state = f.apply({ kind: 'room', id, input: { ...input, heightMm: 3000 } })
    near(state.items.find((i) => i.id === wallId)!.quantity, 16)
    state = f.apply({ kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 8000 })
    near(state.items.find((i) => i.id === wallId)!.quantity, 32)
    f.scale()
    const request = summaryRequestSchema.parse({ projectId: f.drawing.projectId })
    let report = f.storage.readSummary(request)
    const row = report.rows.find((r) => r.category === 'wall')!
    assert.equal(row.unit, 'm')
    assert.equal(row.quantity, '15.100')
    assert.equal(row.amount, '7550')
    report = f.storage.editSummary({
      request,
      fingerprint: report.fingerprint,
      rowId: row.id,
      finish: { name: '壁紙ボーダー', specification: '幅100mm', unitPrice: 600 }
    })
    assert.equal(f.read().rooms[0].finishes.wall.unit, 'm', '集計の仕上げ編集でも計算単位を保持')
    const estimate = f.storage.createEstimate({ request, fingerprint: report.fingerprint })
    const line = estimate.body.lines.find((l) => l.category === 'wall')!
    assert.equal(line.unit, 'm')
    assert.equal(line.quantity, '15.1')
    const snapshot = f.read(),
      backup = join(f.folder, 'wall-m.sekisan-backup')
    await f.storage.createBackup(backup)
    f.apply({ kind: 'deleteRoom', id })
    await f.storage.restoreBackup(backup)
    assert.deepEqual(f.read(), snapshot)
    validateTakeoffData((f.storage as unknown as { db: Database.Database }).db)
  } finally {
    f.cleanup()
  }
})

test('㎡とmの切替は固定数量を解除し控除を再計算、反映前は元データと版を保持する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const id = f.room(),
      wall = f.read().items.find((i) => i.category === 'wall')!
    f.apply({ kind: 'fixed', itemId: wall.id, quantity: 40 })
    f.apply({
      kind: 'deduction',
      id: randomUUID(),
      input: { targetItemId: wall.id, name: '扉', widthMm: 900, heightMm: 2100, count: 2 }
    })
    const before = f.read(),
      input = roomInput()
    input.finishes.wall = { name: 'ボーダー', unit: 'm', unitPrice: 800 }
    const mutation = f.mutation({ kind: 'room', id, input })
    const preview = f.storage.previewTakeoff(mutation)
    assert.deepEqual(f.read(), before)
    const row = preview.rows.find((r) => r.itemId === wall.id)!
    assert.equal(row.beforeUnit, '㎡')
    assert.equal(row.unit, 'm')
    assert.match(preview.warnings.join(' '), /固定数量を解除/)
    assert.match(preview.warnings.join(' '), /幅×箇所数/)
    near(row.before!, 36.22)
    near(row.after!, 12.2)
    let after = f.storage.applyTakeoff(mutation)
    assert.equal(after.items.find((i) => i.id === wall.id)!.fixedQuantity, null)
    assert.equal(after.items.find((i) => i.id === wall.id)!.method, 'room-perimeter')
    assert.equal(after.deductions[0].unit, 'm')
    near(after.deductions[0].quantity, 1.8)
    f.apply({ kind: 'fixed', itemId: wall.id, quantity: 20 })
    after = f.apply({ kind: 'room', id, input: roomInput() })
    assert.equal(after.items.find((i) => i.id === wall.id)!.fixedQuantity, null)
    assert.equal(after.items.find((i) => i.id === wall.id)!.unit, '㎡')
    assert.equal(after.items.find((i) => i.id === wall.id)!.method, 'room-wall')
    near(after.deductions[0].quantity, 3.78)
    validateTakeoffData((f.storage as unknown as { db: Database.Database }).db)
  } finally {
    f.cleanup()
  }
})

test('同名統合で壁の㎡とmを混ぜず、旧v13の行とJSONを変更せずに移行する', async () => {
  const f = await fixture()
  try {
    f.scale()
    const first = f.room(),
      id = randomUUID(),
      input = roomInput()
    input.finishes.wall = { name: 'ボーダー', unit: 'm', unitPrice: 100 }
    const mutation = f.mutation({ kind: 'room', id, input, mergeInto: first })
    const preview = f.storage.previewTakeoff(mutation)
    const rows = preview.mergeSummary!.rows.filter((r) => r.category === 'wall')
    assert.equal(rows.length, 2)
    near(rows.find((r) => r.unit === '㎡')!.after, 33.6)
    near(rows.find((r) => r.unit === 'm')!.after, 14)
    f.storage.applyTakeoff(mutation)
    const report = f.storage.readSummary(
      summaryRequestSchema.parse({ projectId: f.drawing.projectId })
    )
    assert.equal(report.rows.filter((r) => r.category === 'wall').length, 2)
    const db = (f.storage as unknown as { db: Database.Database }).db
    db.pragma('user_version = 13')
    assert.throws(() => validateTakeoffData(db), /v14/)
    db.pragma('user_version = 14')
    f.apply({ kind: 'deleteRoom', id })
    const oldRooms = db.prepare('SELECT * FROM rooms').all()
    const oldItems = db.prepare('SELECT * FROM takeoff_items').all()
    db.pragma('user_version = 13')
    f.storage.close()
    const reopened = new Storage(join(f.folder, 'app'))
    try {
      const migrated = (reopened as unknown as { db: Database.Database }).db
      assert.equal(migrated.pragma('user_version', { simple: true }), 14)
      assert.deepEqual(migrated.prepare('SELECT * FROM rooms').all(), oldRooms)
      assert.deepEqual(migrated.prepare('SELECT * FROM takeoff_items').all(), oldItems)
      assert.ok(
        readdirSync(join(f.folder, 'app/recovery')).some((n) => n.startsWith('before-schema-v14-'))
      )
    } finally {
      reopened.close()
    }
  } finally {
    f.cleanup()
  }
})
