import { readCounts, previewCount, saveCounts } from './count-storage'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { idSchema } from '../shared/validation'
import {
  categories,
  categoryUnits,
  takeoffUnit,
  takeoffMethod,
  deductionQuantity,
  geometry,
  wallLineLength,
  mutationSchema,
  netQuantity,
  numberedRoomName,
  pageAddressSchema,
  quantityRows,
  roomQuantities,
  scaleFromCalibration,
  roomInputSchema,
  deductionInputSchema,
  type PageState,
  type Room,
  type TakeoffItem,
  type Deduction,
  type TakeoffMutation,
  type TakeoffPreview
} from '../shared/takeoff'

export const TAKEOFF_SQL = `
CREATE TABLE drawing_pages (drawingId TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE, pageNumber INTEGER NOT NULL CHECK(pageNumber>0),
 scaleRatio REAL CHECK(scaleRatio>0), calibration TEXT, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(drawingId,pageNumber));
CREATE TABLE rooms (id TEXT PRIMARY KEY, drawingId TEXT NOT NULL, pageNumber INTEGER NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
 heightMm REAL NOT NULL CHECK(heightMm>0), polygon TEXT NOT NULL, finishes TEXT NOT NULL,
 FOREIGN KEY(drawingId,pageNumber) REFERENCES drawing_pages(drawingId,pageNumber) ON DELETE CASCADE);
CREATE TABLE takeoff_items (id TEXT PRIMARY KEY, roomId TEXT REFERENCES rooms(id) ON DELETE SET NULL,
 drawingId TEXT NOT NULL, pageNumber INTEGER NOT NULL, category TEXT NOT NULL CHECK(category IN ('ceiling','wall','baseboard','floor')),
 source TEXT NOT NULL CHECK(source IN ('auto-room','manual')), method TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity>=0), unit TEXT NOT NULL CHECK(unit IN ('㎡','m')),
 finish TEXT NOT NULL, unitPrice REAL CHECK(unitPrice>=0), fixedQuantity REAL CHECK(fixedQuantity>=0), calculationVersion INTEGER NOT NULL,
 FOREIGN KEY(drawingId,pageNumber) REFERENCES drawing_pages(drawingId,pageNumber) ON DELETE CASCADE);
CREATE UNIQUE INDEX auto_room_category ON takeoff_items(roomId,category) WHERE source='auto-room';
CREATE TABLE deductions (id TEXT PRIMARY KEY, targetItemId TEXT NOT NULL REFERENCES takeoff_items(id) ON DELETE CASCADE,
 name TEXT NOT NULL, widthMm REAL NOT NULL CHECK(widthMm>0), heightMm REAL NOT NULL CHECK(heightMm>0), count INTEGER NOT NULL CHECK(count>0),
 quantity REAL NOT NULL CHECK(quantity>0), unit TEXT NOT NULL CHECK(unit IN ('㎡','m')));
CREATE INDEX rooms_page ON rooms(drawingId,pageNumber);
CREATE INDEX takeoff_page ON takeoff_items(drawingId,pageNumber);
CREATE INDEX deductions_target ON deductions(targetItemId);
PRAGMA user_version = 2;
`
type StoredRoom = Omit<Room, 'polygon' | 'finishes' | 'enabledCategories' | 'sleeveWalls'> & {
  polygon: string
  finishes: string
  sleeveWalls?: string
  enabledCategories?: string
}
export function readTakeoff(db: Database.Database, input: unknown): PageState {
  const address = pageAddressSchema.parse(input)
  const drawing = db.prepare('SELECT pageCount FROM drawings WHERE id=?').get(address.drawingId) as
    { pageCount: number } | undefined
  if (!drawing || address.pageNumber > drawing.pageCount)
    throw new Error('対象の図面ページが見つかりません。')
  const row = db
    .prepare('SELECT * FROM drawing_pages WHERE drawingId=? AND pageNumber=?')
    .get(address.drawingId, address.pageNumber) as
    { scaleRatio: number | null; calibration: string | null; revision: number } | undefined
  const rooms = (
    db
      .prepare('SELECT * FROM rooms WHERE drawingId=? AND pageNumber=? ORDER BY rowid')
      .all(address.drawingId, address.pageNumber) as StoredRoom[]
  ).map((r) => ({
    ...r,
    groupId: r.groupId ?? r.id,
    enabledCategories:
      r.enabledCategories === undefined ? [...categories] : JSON.parse(r.enabledCategories),
    polygon: JSON.parse(r.polygon),
    finishes: JSON.parse(r.finishes),
    sleeveWalls: r.sleeveWalls === undefined ? [] : JSON.parse(r.sleeveWalls)
  }))
  const items = db
    .prepare('SELECT * FROM takeoff_items WHERE drawingId=? AND pageNumber=? ORDER BY rowid')
    .all(address.drawingId, address.pageNumber) as TakeoffItem[]
  const deductions = db
    .prepare(
      'SELECT deductions.* FROM deductions JOIN takeoff_items ON takeoff_items.id=deductions.targetItemId WHERE drawingId=? AND pageNumber=? ORDER BY deductions.rowid'
    )
    .all(address.drawingId, address.pageNumber) as Deduction[]
  return {
    ...address,
    scaleRatio: row?.scaleRatio ?? null,
    calibration: row?.calibration ? JSON.parse(row.calibration) : null,
    revision: row?.revision ?? 0,
    rooms,
    counts: readCounts(db, address.drawingId, address.pageNumber),
    items,
    deductions
  }
}

export function previewTakeoff(db: Database.Database, raw: unknown): TakeoffPreview {
  const input = mutationSchema.parse(raw)
  const before = readTakeoff(db, { drawingId: input.drawingId, pageNumber: input.pageNumber })
  if (input.expectedRevision !== before.revision)
    throw new Error(
      '別の操作で数量が更新されています。最新の状態を読み直してから再確認してください。'
    )
  if (input.change.kind === 'count' || input.change.kind === 'deleteCount')
    return previewCount(db, before, input)
  const after = structuredClone(before)
  const change = input.change
  const warnings: string[] = []
  const affectedRooms = new Set<string>()
  const requireRoom = (id: string): Room => {
    const room = after.rooms.find((r) => r.id === id)
    if (!room) throw new Error('このページに対象の部屋がありません。')
    return room
  }
  if (change.kind === 'scale') {
    after.scaleRatio = scaleFromCalibration(change.points, change.lengthMm)
    after.calibration = { points: change.points, lengthMm: change.lengthMm }
  } else if (change.kind === 'room') {
    if (change.input.geometryType === 'wall-line') wallLineLength(change.input.polygon)
    else geometry(change.input.polygon)
    if (after.scaleRatio === null) throw new Error('このページの縮尺を設定してください。')
    const index = after.rooms.findIndex((r) => r.id === change.id)
    if (index < 0 && db.prepare('SELECT id FROM rooms WHERE id=?').get(change.id))
      throw new Error('別ページの部屋は変更できません。')
    if (
      index >= 0 &&
      (after.rooms[index].geometryType ?? 'area') !== (change.input.geometryType ?? 'area')
    )
      throw new Error('部屋と壁の線拾いは相互に変更できません。別の拾いとして追加してください。')
    if (change.input.geometryType === 'wall-line')
      warnings.push(
        '指定した壁の線を別の数量として追加します。既存の部屋の壁数量からは自動控除しません。一般壁とアクセント壁の重複を確認してください。'
      )
    const previousGroup = index < 0 ? change.id : after.rooms[index].groupId
    const duplicates = after.rooms.filter(
      (r) => r.name === change.input.name && r.groupId !== previousGroup
    )
    let groupId = previousGroup
    if (change.mergeInto) {
      const target = requireRoom(change.mergeInto)
      if (target.name !== change.input.name || target.groupId === previousGroup)
        throw new Error('統合先の部屋名・範囲を確認してください。')
      groupId = target.groupId
      warnings.push(
        '同名の部屋を統合して数量を合算します。図形・仕上げ・控除・固定数量は範囲ごとに保持します。重なる面積や共通の辺も加算されるため、必要な控除を確認してください。'
      )
    } else if (duplicates.length && !change.duplicateChoice) {
      throw new Error(
        '同名の部屋があります。統合するか、別の部屋として登録するか選択してください。'
      )
    }
    const name =
      duplicates.length && !change.mergeInto
        ? numberedRoomName(
            change.input.name,
            after.rooms.filter((r) => r.groupId !== previousGroup).map((r) => r.name)
          )
        : change.input.name
    if (name !== change.input.name) warnings.push(`別の部屋として「${name}」の名前で登録します。`)
    for (const part of after.rooms.filter((r) => r.groupId === previousGroup)) {
      part.name = name
      part.groupId = groupId
      affectedRooms.add(part.id)
    }
    affectedRooms.add(change.id)
    if (change.input.sleeveWalls.length)
      warnings.push(
        '袖壁は指定した面数で壁・巾木に加算します。床・天井の面積には含めません。外周や他の袖壁との重複、端部の小口は自動調整しません。'
      )
    const room = {
      ...change.input,
      name,
      groupId,
      id: change.id,
      drawingId: input.drawingId,
      pageNumber: input.pageNumber
    }
    if (index < 0) after.rooms.push(room)
    else after.rooms[index] = room
  } else if (change.kind === 'deleteRoom') {
    requireRoom(change.id)
    after.rooms = after.rooms.filter((r) => r.id !== change.id)
    const removed = after.items
      .filter((i) => i.roomId === change.id && i.source === 'auto-room')
      .map((i) => i.id)
    after.items = after.items
      .filter((i) => !removed.includes(i.id))
      .map((i) => (i.roomId === change.id ? { ...i, roomId: null } : i))
    after.deductions = after.deductions.filter((d) => !removed.includes(d.targetItemId))
  } else if (change.kind === 'deduction') {
    const item = after.items.find((i) => i.id === change.input.targetItemId)
    if (!item) throw new Error('このページに控除対象の数量がありません。')
    if (!['wall', 'baseboard'].includes(item.category))
      throw new Error('開口控除は壁または巾木を対象にしてください。')
    if (
      db.prepare('SELECT id FROM deductions WHERE id=?').get(change.id) &&
      !after.deductions.some((d) => d.id === change.id)
    )
      throw new Error('別ページの控除は変更できません。')
    const deduction = {
      ...change.input,
      id: change.id,
      unit: item.unit,
      quantity: deductionQuantity(change.input, item.unit)
    }
    after.deductions = after.deductions.filter((d) => d.id !== change.id).concat(deduction)
  } else if (change.kind === 'deleteDeduction') {
    if (!after.deductions.some((d) => d.id === change.id))
      throw new Error('対象の控除がありません。')
    after.deductions = after.deductions.filter((d) => d.id !== change.id)
  } else if (change.kind === 'fixed') {
    const item = after.items.find((i) => i.id === change.itemId)
    if (!item) throw new Error('対象の数量がありません。')
    item.fixedQuantity = change.quantity
  }
  after.counts = (after.counts ?? []).map((c) =>
    c.roomId && !after.rooms.some((r) => r.id === c.roomId) ? { ...c, roomId: null } : c
  )
  // A disabled category removes only its own auto item and linked deductions.
  const disabled = after.items
    .filter(
      (i) =>
        i.source === 'auto-room' &&
        !after.rooms.find((r) => r.id === i.roomId)?.enabledCategories.includes(i.category)
    )
    .map((i) => i.id)
  const removedDeductions = before.deductions.filter(
    (d) => !after.deductions.some((n) => n.id === d.id) || disabled.includes(d.targetItemId)
  )
  if (disabled.length) after.items = after.items.filter((i) => !disabled.includes(i.id))
  after.deductions = after.deductions.filter((d) => !disabled.includes(d.targetItemId))
  if ((change.kind === 'room' || change.kind === 'deleteRoom') && removedDeductions.length)
    warnings.push(`削除する部位・範囲に紐づく控除 ${removedDeductions.length} 件も削除します。`)
  const removedFixed = before.items.filter(
    (i) => i.fixedQuantity !== null && !after.items.some((n) => n.id === i.id)
  )
  if (removedFixed.length)
    warnings.push(`削除する部位・範囲の固定数量 ${removedFixed.length} 件も削除します。`)
  // Update auto items in place. Their IDs (and all deduction references) stay stable.
  for (const room of after.rooms) {
    const quantities = roomQuantities(
      room.polygon,
      after.scaleRatio,
      room.heightMm,
      room.sleeveWalls,
      takeoffUnit('wall', room.finishes),
      room.geometryType
    )
    for (const category of room.enabledCategories) {
      const existing = after.items.find(
        (i) => i.roomId === room.id && i.source === 'auto-room' && i.category === category
      )
      const item: TakeoffItem = {
        id: existing?.id ?? randomUUID(),
        roomId: room.id,
        drawingId: after.drawingId,
        pageNumber: after.pageNumber,
        category,
        source: 'auto-room',
        method: takeoffMethod(category, takeoffUnit(category, room.finishes)),
        quantity: quantities[category],
        unit: takeoffUnit(category, room.finishes),
        finish: room.finishes[category].name,
        specification: room.finishes[category].specification ?? '',
        unitPrice: room.finishes[category].unitPrice,
        fixedQuantity: existing?.fixedQuantity ?? null,
        calculationVersion: 1
      }
      if (existing && existing.unit !== item.unit) {
        warnings.push(
          `${room.name}：壁を${existing.unit}から${item.unit}へ変更し、数量を再計算します。`
        )
        if (existing.fixedQuantity !== null) {
          item.fixedQuantity = null
          warnings.push(`${room.name}：単位が変わるため、壁の固定数量を解除します。`)
        }
        const deductions = after.deductions.filter((d) => d.targetItemId === item.id)
        for (const d of deductions) {
          d.unit = item.unit
          d.quantity = deductionQuantity(
            {
              targetItemId: d.targetItemId,
              name: d.name,
              widthMm: d.widthMm,
              heightMm: d.heightMm,
              count: d.count
            },
            item.unit
          )
        }
        if (deductions.length)
          warnings.push(
            `${room.name}：壁の開口控除を${item.unit === 'm' ? '幅×箇所数' : '幅×高さ×箇所数'}で再計算します。貼る位置に合った控除か確認してください。`
          )
      }
      if (existing) Object.assign(existing, item)
      else after.items.push(item)
    }
  }
  after.revision++
  const rows = quantityRows(before, after).filter((row) => {
    const old = before.items.find((i) => i.id === row.itemId),
      next = after.items.find((i) => i.id === row.itemId)
    return (
      row.before !== row.after ||
      JSON.stringify(old) !== JSON.stringify(next) ||
      (next?.roomId && affectedRooms.has(next.roomId))
    )
  })
  warnings.push(
    ...after.items
      .filter(
        (i) => rows.some((r) => r.itemId === i.id) && netQuantity(i, after.deductions) < -1e-8
      )
      .map(
        (i) =>
          `${after.rooms.find((r) => r.id === i.roomId)?.name ?? '部屋未指定'}：控除が元数量を超えています。負の正味数量を保持します。`
      )
  )
  let mergeSummary: TakeoffPreview['mergeSummary']
  if (change.kind === 'room' && change.mergeInto) {
    const target = after.rooms.find((r) => r.id === change.mergeInto)!
    const total = (page: PageState, c: (typeof categories)[number], unit: string): number =>
      page.items
        .filter(
          (i) =>
            i.category === c &&
            i.unit === unit &&
            page.rooms.some((r) => r.id === i.roomId && r.groupId === target.groupId)
        )
        .reduce((n, i) => n + netQuantity(i, page.deductions), 0)
    mergeSummary = {
      name: target.name,
      rows: categories.flatMap((c) => {
        const units = new Set(
          [...before.items, ...after.items]
            .filter(
              (i) =>
                i.category === c &&
                [...before.rooms, ...after.rooms].some(
                  (r) => r.id === i.roomId && r.groupId === target.groupId
                )
            )
            .map((i) => i.unit)
        )
        return [...units].map((unit) => ({
          category: c,
          before: total(before, c, unit),
          after: total(after, c, unit),
          unit
        }))
      })
    }
  }
  return {
    before,
    after,
    rows,
    warnings: [...new Set(warnings)],
    ...(mergeSummary ? { mergeSummary } : {})
  }
}

export function applyTakeoff(db: Database.Database, raw: unknown): PageState {
  const input: TakeoffMutation = mutationSchema.parse(raw)
  return db.transaction(() => {
    const { before, after } = previewTakeoff(db, input)
    db.prepare(
      'INSERT INTO drawing_pages(drawingId,pageNumber,scaleRatio,calibration,revision) VALUES (@drawingId,@pageNumber,@scaleRatio,@calibration,@revision) ON CONFLICT(drawingId,pageNumber) DO UPDATE SET scaleRatio=excluded.scaleRatio,calibration=excluded.calibration,revision=excluded.revision'
    ).run({
      drawingId: after.drawingId,
      pageNumber: after.pageNumber,
      scaleRatio: after.scaleRatio,
      calibration: after.calibration ? JSON.stringify(after.calibration) : null,
      revision: after.revision
    })
    for (const d of before.deductions)
      if (!after.deductions.some((n) => n.id === d.id))
        db.prepare('DELETE FROM deductions WHERE id=?').run(d.id)
    for (const i of before.items)
      if (!after.items.some((n) => n.id === i.id))
        db.prepare('DELETE FROM takeoff_items WHERE id=?').run(i.id)
    for (const r of before.rooms)
      if (!after.rooms.some((n) => n.id === r.id))
        db.prepare('DELETE FROM rooms WHERE id=?').run(r.id)
    for (const room of after.rooms)
      db.prepare(
        'INSERT INTO rooms(id,drawingId,pageNumber,name,color,heightMm,polygon,finishes,enabledCategories,groupId,sleeveWalls,geometryType) VALUES (@id,@drawingId,@pageNumber,@name,@color,@heightMm,@polygon,@finishes,@enabledCategories,@groupId,@sleeveWalls,@geometryType) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,heightMm=excluded.heightMm,polygon=excluded.polygon,finishes=excluded.finishes,enabledCategories=excluded.enabledCategories,groupId=excluded.groupId,sleeveWalls=excluded.sleeveWalls,geometryType=excluded.geometryType'
      ).run({
        ...room,
        geometryType: room.geometryType ?? 'area',
        polygon: JSON.stringify(room.polygon),
        finishes: JSON.stringify(room.finishes),
        sleeveWalls: JSON.stringify(room.sleeveWalls),
        enabledCategories: JSON.stringify(room.enabledCategories)
      })
    const roomChange = input.change
    if (roomChange.kind === 'room')
      db.prepare(
        'INSERT INTO room_name_history(projectId,name,lastUsed) VALUES ((SELECT projectId FROM drawings WHERE id=?),?,?) ON CONFLICT(projectId,name) DO UPDATE SET lastUsed=excluded.lastUsed'
      ).run(
        after.drawingId,
        after.rooms.find((r) => r.id === roomChange.id)!.name,
        new Date().toISOString()
      )
    if (
      roomChange.kind === 'room' &&
      before.rooms.find((r) => r.id === roomChange.id)?.heightMm !== roomChange.input.heightMm
    ) {
      const projectId = (
        db.prepare('SELECT projectId FROM drawings WHERE id=?').get(after.drawingId) as {
          projectId: string
        }
      ).projectId
      const order = (
        db
          .prepare(
            'SELECT COALESCE(MAX(lastUsed),0)+1 AS next FROM height_history WHERE projectId=?'
          )
          .get(projectId) as { next: number }
      ).next
      db.prepare(
        'INSERT INTO height_history(projectId,heightMm,lastUsed) VALUES (?,?,?) ON CONFLICT(projectId,heightMm) DO UPDATE SET lastUsed=excluded.lastUsed'
      ).run(projectId, roomChange.input.heightMm, order)
    }
    saveCounts(db, before, after)
    for (const item of after.items)
      db.prepare(
        'INSERT INTO takeoff_items(id,roomId,drawingId,pageNumber,category,source,method,quantity,unit,finish,unitPrice,fixedQuantity,calculationVersion,specification) VALUES (@id,@roomId,@drawingId,@pageNumber,@category,@source,@method,@quantity,@unit,@finish,@unitPrice,@fixedQuantity,@calculationVersion,@specification) ON CONFLICT(id) DO UPDATE SET roomId=excluded.roomId,method=excluded.method,unit=excluded.unit,quantity=excluded.quantity,finish=excluded.finish,specification=excluded.specification,unitPrice=excluded.unitPrice,fixedQuantity=excluded.fixedQuantity,calculationVersion=excluded.calculationVersion'
      ).run({ ...item, specification: item.specification ?? '' })
    for (const d of after.deductions)
      db.prepare(
        'INSERT INTO deductions(id,targetItemId,name,widthMm,heightMm,count,quantity,unit) VALUES (@id,@targetItemId,@name,@widthMm,@heightMm,@count,@quantity,@unit) ON CONFLICT(id) DO UPDATE SET targetItemId=excluded.targetItemId,name=excluded.name,widthMm=excluded.widthMm,heightMm=excluded.heightMm,count=excluded.count,quantity=excluded.quantity,unit=excluded.unit'
      ).run(d)
    db.prepare(
      'UPDATE projects SET updatedAt=? WHERE id=(SELECT projectId FROM drawings WHERE id=?)'
    ).run(new Date().toISOString(), after.drawingId)
    return readTakeoff(db, { drawingId: after.drawingId, pageNumber: after.pageNumber })
  })()
}

export function validateTakeoffData(db: Database.Database): void {
  const pages = db.prepare('SELECT * FROM drawing_pages').all() as {
    drawingId: string
    pageNumber: number
    scaleRatio: number | null
    calibration: string | null
    revision: number
  }[]
  for (const row of pages) {
    const state = readTakeoff(db, { drawingId: row.drawingId, pageNumber: row.pageNumber })
    z.number().int().nonnegative().parse(row.revision)
    if (state.calibration) {
      const change = mutationSchema.shape.change.parse({ kind: 'scale', ...state.calibration })
      if (
        change.kind !== 'scale' ||
        Math.abs(scaleFromCalibration(change.points, change.lengthMm) - (row.scaleRatio ?? 0)) >
          1e-10
      )
        throw new Error('縮尺の記録が一致しません。')
    } else if (row.scaleRatio !== null) throw new Error('縮尺の根拠がありません。')
    for (const room of state.rooms) {
      idSchema.parse(room.id)
      roomInputSchema.parse({
        name: room.name,
        color: room.color,
        heightMm: room.heightMm,
        polygon: room.polygon,
        geometryType: room.geometryType,
        finishes: room.finishes,
        sleeveWalls: room.sleeveWalls,
        enabledCategories: room.enabledCategories
      })
      idSchema.parse(room.groupId)
      if (state.rooms.some((r) => r.groupId === room.groupId && r.name !== room.name))
        throw new Error('統合した部屋の名前が一致しません。')
      if (
        (db.pragma('user_version', { simple: true }) as number) >= 3 &&
        db
          .prepare('SELECT id FROM rooms WHERE groupId=? AND (drawingId<>? OR pageNumber<>?)')
          .get(room.groupId, room.drawingId, room.pageNumber)
      )
        throw new Error('異なるページの部屋は統合できません。')
      const quantities = roomQuantities(
        room.polygon,
        state.scaleRatio,
        room.heightMm,
        room.sleeveWalls,
        takeoffUnit('wall', room.finishes),
        room.geometryType
      )
      for (const c of categories) {
        const items = state.items.filter(
          (i) => i.roomId === room.id && i.source === 'auto-room' && i.category === c
        )
        if (!room.enabledCategories.includes(c)) {
          if (items.length) throw new Error('選択していない部位に数量があります。')
          continue
        }
        if (
          items.length !== 1 ||
          Math.abs(items[0].quantity - quantities[c]) > Math.max(1e-8, quantities[c] * 1e-10)
        )
          throw new Error('部屋と自動数量が一致しません。')
      }
    }
    for (const item of state.items) {
      idSchema.parse(item.id)
      z.string()
        .max(400)
        .parse(item.specification ?? '')
      const room = state.rooms.find((r) => r.id === item.roomId)
      const expectedUnit =
        room && item.source === 'auto-room'
          ? takeoffUnit(item.category, room.finishes)
          : categoryUnits[item.category]
      if (item.source === 'auto-room' && item.method !== takeoffMethod(item.category, expectedUnit))
        throw new Error('部位と計算方式が一致しません。')
      if (item.unit !== expectedUnit || item.calculationVersion !== 1)
        throw new Error('数量の単位・計算バージョンが不正です。')
      if (
        (db.pragma('user_version', { simple: true }) as number) < 14 &&
        item.category === 'wall' &&
        item.unit === 'm'
      )
        throw new Error('壁の延長mはDB v14以降で保存してください。')
      z.number().finite().min(0).max(1e12).parse(item.quantity)
      z.number().finite().min(0).max(1e12).nullable().parse(item.fixedQuantity)
      z.number().finite().min(0).max(1e9).nullable().parse(item.unitPrice)
      if (
        (item.roomId !== null && !state.rooms.some((r) => r.id === item.roomId)) ||
        (item.source === 'auto-room' && item.roomId === null)
      )
        throw new Error('数量の部屋参照が不正です。')
    }
    for (const d of state.deductions) {
      idSchema.parse(d.id)
      const deductionInput = deductionInputSchema.parse({
        targetItemId: d.targetItemId,
        name: d.name,
        widthMm: d.widthMm,
        heightMm: d.heightMm,
        count: d.count
      })
      const item = state.items.find((i) => i.id === d.targetItemId)
      if (
        !item ||
        !['wall', 'baseboard'].includes(item.category) ||
        item.unit !== d.unit ||
        Math.abs(d.quantity - deductionQuantity(deductionInput, d.unit)) > 1e-8
      )
        throw new Error('控除の計算結果が不正です。')
    }
  }
}
