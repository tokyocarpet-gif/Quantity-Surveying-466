import type Database from 'better-sqlite3'
import {
  countInputSchema,
  type CountGroup,
  type PageState,
  type TakeoffMutation,
  type TakeoffPreview
} from '../shared/takeoff'
import { idSchema } from '../shared/validation'

export const COUNT_SQL = `
CREATE TABLE count_groups (
 id TEXT PRIMARY KEY, drawingId TEXT NOT NULL, pageNumber INTEGER NOT NULL,
 roomId TEXT REFERENCES rooms(id) ON DELETE SET NULL,
 name TEXT NOT NULL, category TEXT NOT NULL, specification TEXT NOT NULL,
 unit TEXT NOT NULL, unitPrice REAL CHECK(unitPrice>=0), color TEXT NOT NULL, points TEXT NOT NULL,
 FOREIGN KEY(drawingId,pageNumber) REFERENCES drawing_pages(drawingId,pageNumber) ON DELETE CASCADE);
CREATE INDEX counts_page ON count_groups(drawingId,pageNumber);
PRAGMA user_version = 7;
`
export function readCounts(
  db: Database.Database,
  drawingId: string,
  pageNumber: number
): CountGroup[] {
  if ((db.pragma('user_version', { simple: true }) as number) < 7) return []
  return (
    db
      .prepare('SELECT * FROM count_groups WHERE drawingId=? AND pageNumber=? ORDER BY rowid')
      .all(drawingId, pageNumber) as (Omit<CountGroup, 'points'> & { points: string })[]
  ).map((row) => ({ ...row, points: JSON.parse(row.points) }))
}
export function previewCount(
  db: Database.Database,
  before: PageState,
  input: TakeoffMutation
): TakeoffPreview {
  const change = input.change,
    after = structuredClone(before)
  if (change.kind !== 'count' && change.kind !== 'deleteCount')
    throw new Error('個数の変更を指定してください。')
  const old = before.counts?.find((c) => c.id === change.id)
  let next: CountGroup | undefined
  if (change.kind === 'count') {
    if (
      !old &&
      (db.prepare('SELECT id FROM count_groups WHERE id=?').get(change.id) ||
        db.prepare('SELECT id FROM takeoff_items WHERE id=?').get(change.id))
    )
      throw new Error('別ページの個数拾いは変更できません。')
    if (change.input.roomId && !before.rooms.some((r) => r.id === change.input.roomId))
      throw new Error('このページの部屋を指定してください。')
    next = {
      ...change.input,
      id: change.id,
      drawingId: input.drawingId,
      pageNumber: input.pageNumber
    }
  } else if (!old) throw new Error('削除する個数拾いがありません。')
  after.counts = (before.counts ?? []).filter((c) => c.id !== change.id).concat(next ? [next] : [])
  after.revision++
  const item = next ?? old!
  return {
    before,
    after,
    rows: [
      {
        itemId: item.id,
        roomName: `${before.rooms.find((r) => r.id === item.roomId)?.name ?? '部屋未指定'} · ${item.name}`,
        category: item.category,
        unit: item.unit,
        before: old?.points.length ?? null,
        after: next?.points.length ?? null,
        fixed: false
      }
    ],
    warnings:
      change.kind === 'deleteCount'
        ? [`「${item.name}」の${item.points.length}点と数量を削除します。`]
        : []
  }
}
export function saveCounts(db: Database.Database, before: PageState, after: PageState): void {
  for (const old of before.counts ?? [])
    if (!after.counts?.some((c) => c.id === old.id))
      db.prepare('DELETE FROM count_groups WHERE id=?').run(old.id)
  for (const group of after.counts ?? [])
    db.prepare(
      'INSERT INTO count_groups(id,drawingId,pageNumber,roomId,name,category,specification,unit,unitPrice,color,points) VALUES (@id,@drawingId,@pageNumber,@roomId,@name,@category,@specification,@unit,@unitPrice,@color,@points) ON CONFLICT(id) DO UPDATE SET roomId=excluded.roomId,name=excluded.name,category=excluded.category,specification=excluded.specification,unit=excluded.unit,unitPrice=excluded.unitPrice,color=excluded.color,points=excluded.points'
    ).run({ ...group, points: JSON.stringify(group.points) })
}
export function validateCounts(db: Database.Database): void {
  for (const row of db.prepare('SELECT * FROM count_groups').all() as (Omit<
    CountGroup,
    'points'
  > & { points: string })[]) {
    const { id, drawingId, pageNumber, points, ...input } = row
    idSchema.parse(id)
    countInputSchema.parse({ ...input, points: JSON.parse(points) })
    if (
      input.roomId &&
      !db
        .prepare('SELECT id FROM rooms WHERE id=? AND drawingId=? AND pageNumber=?')
        .get(input.roomId, drawingId, pageNumber)
    )
      throw new Error('個数拾いの部屋参照が不正です。')
  }
}
