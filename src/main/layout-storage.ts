import type Database from 'better-sqlite3'
import { idSchema } from '../shared/validation'
import {
  computeLayout,
  layoutBodySchema,
  layoutSaveSchema,
  layoutSourceKey,
  type LayoutDoc
} from '../shared/layout'
import { readTakeoff } from './takeoff-storage'

export const LAYOUT_SQL = `
ALTER TABLE materials ADD COLUMN tileWidthMm REAL;
ALTER TABLE materials ADD COLUMN tileHeightMm REAL;
ALTER TABLE materials ADD COLUMN tileGapMm REAL NOT NULL DEFAULT 0;
CREATE TABLE room_layouts (roomId TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision > 0), sourceKey TEXT NOT NULL, body TEXT NOT NULL);
PRAGMA user_version = 9;
`
export function readLayout(db: Database.Database, raw: unknown): LayoutDoc | null {
  const roomId = idSchema.parse(raw)
  const row = db.prepare('SELECT * FROM room_layouts WHERE roomId=?').get(roomId) as
    { roomId: string; revision: number; sourceKey: string; body: string } | undefined
  return row ? { ...row, body: layoutBodySchema.parse(JSON.parse(row.body)) } : null
}
export function saveLayout(db: Database.Database, raw: unknown): LayoutDoc {
  const input = layoutSaveSchema.parse(raw)
  return db.transaction(() => {
    const room = db
      .prepare('SELECT drawingId,pageNumber FROM rooms WHERE id=?')
      .get(input.roomId) as { drawingId: string; pageNumber: number } | undefined
    if (!room) throw new Error('対象の部屋がありません。')
    const page = readTakeoff(db, room)
    const selected = page.rooms.find((r) => r.id === input.roomId)!
    if (selected.geometryType === 'wall-line')
      throw new Error('壁の線拾いは床材割り付けの対象外です。')
    const polygon = selected.polygon
    if (!page.scaleRatio || layoutSourceKey(polygon, page.scaleRatio) !== input.sourceKey)
      throw new Error('部屋の形状または縮尺が変わりました。割り付けを開き直してください。')
    const old = readLayout(db, input.roomId)
    if ((old?.revision ?? 0) !== input.expectedRevision)
      throw new Error('割り付けが別の操作で更新されました。開き直してください。')
    computeLayout(polygon, page.scaleRatio, input.body)
    const next = {
      roomId: input.roomId,
      revision: input.expectedRevision + 1,
      sourceKey: input.sourceKey,
      body: input.body
    }
    db.prepare(
      'INSERT INTO room_layouts(roomId,revision,sourceKey,body) VALUES (@roomId,@revision,@sourceKey,@body) ON CONFLICT(roomId) DO UPDATE SET revision=excluded.revision,sourceKey=excluded.sourceKey,body=excluded.body'
    ).run({ ...next, body: JSON.stringify(next.body) })
    return next
  })()
}
export function validateLayouts(db: Database.Database): void {
  for (const row of db.prepare('SELECT * FROM room_layouts').all() as {
    roomId: string
    revision: number
    sourceKey: string
    body: string
  }[]) {
    idSchema.parse(row.roomId)
    if (
      (db.pragma('user_version', { simple: true }) as number) >= 15 &&
      (
        db.prepare('SELECT geometryType FROM rooms WHERE id=?').get(row.roomId) as
          { geometryType: string } | undefined
      )?.geometryType === 'wall-line'
    )
      throw new Error('壁の線拾いに床材割り付けは保存できません。')
    layoutSaveSchema.parse({
      roomId: row.roomId,
      expectedRevision: row.revision,
      sourceKey: row.sourceKey,
      body: JSON.parse(row.body)
    })
  }
}
