import type Database from 'better-sqlite3'
import {
  wallAddressSchema,
  wallBatchPdfSchema,
  wallSaveSchema,
  wallBodySchema,
  wallDeleteSchema,
  computeWall,
  type WallDoc,
  type WallSave
} from '../shared/wall-layout'
import { readTakeoff } from './takeoff-storage'
export const WALL_LAYOUT_SQL = `
ALTER TABLE materials ADD COLUMN wallpaper TEXT;
CREATE TABLE wall_layouts (id TEXT PRIMARY KEY, drawingId TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
 pageNumber INTEGER NOT NULL CHECK(pageNumber > 0), revision INTEGER NOT NULL CHECK(revision > 0), body TEXT NOT NULL);
CREATE INDEX wall_layouts_page ON wall_layouts(drawingId,pageNumber);
PRAGMA user_version = 19;
`
type StoredWall = Omit<WallDoc, 'body'> & { body: string }
function decode(row: StoredWall): WallDoc {
  return { ...row, body: wallBodySchema.parse(JSON.parse(row.body)) }
}
export function readWalls(db: Database.Database, raw: unknown): WallDoc[] {
  const a = wallAddressSchema.parse(raw)
  readTakeoff(db, a)
  const rows = db
    .prepare('SELECT * FROM wall_layouts WHERE drawingId=? AND pageNumber=? ORDER BY rowid')
    .all(a.drawingId, a.pageNumber) as StoredWall[]
  return rows.map(decode)
}
export function checkWallSource(db: Database.Database, input: WallSave): void {
  const page = readTakeoff(db, { drawingId: input.drawingId, pageNumber: input.pageNumber }),
    b = input.body
  if (page.scaleRatio !== b.scale)
    throw new Error('図面の縮尺が変わりました。壁を選び直してください。')
  if (b.roomId) {
    const room = page.rooms.find((r) => r.id === b.roomId)
    const n = b.edgeIndex!
    if (!room || n >= room.polygon.length - (room.geometryType === 'wall-line' ? 1 : 0))
      throw new Error('参照する壁がありません。壁を選び直してください。')
    const p = room.polygon[n],
      q = room.polygon[(n + 1) % room.polygon.length]
    const same = (a: typeof p, c: typeof p) => a.x === c.x && a.y === c.y
    if (
      !(same(p, b.points[0]) && same(q, b.points[1])) &&
      !(same(q, b.points[0]) && same(p, b.points[1]))
    )
      throw new Error('壁の形状が変わりました。壁を選び直してください。')
  }
}
export function wallReport(db: Database.Database, raw: unknown) {
  const input = wallSaveSchema.parse(raw)
  checkWallSource(db, input)
  const old = db
    .prepare('SELECT revision,drawingId,pageNumber FROM wall_layouts WHERE id=?')
    .get(input.id) as Pick<WallDoc, 'revision' | 'drawingId' | 'pageNumber'> | undefined
  if (
    (old?.revision ?? 0) !== input.expectedRevision ||
    (old && (old.drawingId !== input.drawingId || old.pageNumber !== input.pageNumber))
  )
    throw new Error('壁の割り付けが更新されています。開き直してください。')
  const drawing = db
    .prepare(
      'SELECT drawings.name,projects.name AS projectName FROM drawings JOIN projects ON projects.id=drawings.projectId WHERE drawings.id=?'
    )
    .get(input.drawingId) as { name: string; projectName: string }
  return { input, result: computeWall(input.body), drawing }
}
export function wallBatchReport(db: Database.Database, raw: unknown) {
  const request = wallBatchPdfSchema.parse(raw)
  return db.transaction(() =>
    request.walls.map((selected) => {
      const row = db
        .prepare('SELECT * FROM wall_layouts WHERE id=? AND drawingId=? AND pageNumber=?')
        .get(selected.id, request.drawingId, request.pageNumber) as StoredWall | undefined
      if (!row) throw new Error('選択した壁がありません。壁の一覧を開き直してください。')
      const { revision, ...doc } = decode(row)
      return wallReport(db, { ...doc, expectedRevision: selected.expectedRevision })
    })
  )()
}
export function saveWall(db: Database.Database, raw: unknown): WallDoc {
  return db.transaction(() => {
    const { input } = wallReport(db, raw)
    const { expectedRevision, ...data } = input
    const doc = { ...data, revision: expectedRevision + 1 }
    db.prepare(
      'INSERT INTO wall_layouts(id,drawingId,pageNumber,revision,body) VALUES (@id,@drawingId,@pageNumber,@revision,@body) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body'
    ).run({ ...doc, body: JSON.stringify(doc.body) })
    return doc
  })()
}
export function deleteWall(db: Database.Database, raw: unknown): void {
  const input = wallDeleteSchema.parse(raw)
  if (
    !db
      .prepare('DELETE FROM wall_layouts WHERE id=? AND revision=?')
      .run(input.id, input.expectedRevision).changes
  )
    throw new Error('壁の割り付けが更新されています。開き直してください。')
}
export function validateWalls(db: Database.Database): void {
  for (const row of db.prepare('SELECT * FROM wall_layouts').all() as StoredWall[]) {
    const doc = decode(row)
    if (
      (db.pragma('user_version', { simple: true }) as number) < 20 &&
      (doc.body.kind !== undefined || doc.body.panel !== undefined)
    )
      throw new Error('壁タイル・養生板の設定はDB v20以降で保存してください。')
    if (
      (db.pragma('user_version', { simple: true }) as number) < 21 &&
      doc.body.startSide !== undefined
    )
      throw new Error('壁材の貼り始め設定はDB v21以降で保存してください。')
    const { revision, ...data } = doc
    wallSaveSchema.parse({ ...data, expectedRevision: revision })
    const drawing = db.prepare('SELECT pageCount FROM drawings WHERE id=?').get(doc.drawingId) as
      { pageCount: number } | undefined
    if (!drawing || doc.pageNumber > drawing.pageCount)
      throw new Error('壁の割り付けのページが不正です。')
    computeWall(doc.body)
  }
}
