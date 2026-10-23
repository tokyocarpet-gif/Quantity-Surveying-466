import type Database from 'better-sqlite3'
import { drawingIdsSchema, drawingOrderKey } from '../shared/drawing-order'

// Unlisted/new drawings follow saved drawings in import order. Deleted IDs are ignored.
export function orderedDrawings<T extends { id: string }>(
  db: Database.Database,
  projectId: string,
  drawings: T[]
): T[] {
  const row = db
    .prepare('SELECT value FROM settings WHERE key=?')
    .get(drawingOrderKey(projectId)) as { value: string } | undefined
  const ids = drawingIdsSchema.parse(JSON.parse(row?.value ?? '[]'))
  const positions = new Map(ids.map((id, index) => [id, index]))
  return [...drawings].sort(
    (a, b) => (positions.get(a.id) ?? ids.length) - (positions.get(b.id) ?? ids.length)
  )
}
