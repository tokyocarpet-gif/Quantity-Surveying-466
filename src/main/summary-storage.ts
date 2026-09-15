import { nameSchema } from '../shared/validation'
import { readCounts } from './count-storage'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import {
  aggregateSummary,
  summaryRequestSchema,
  summaryEditSchema,
  type SummaryReport,
  type SummaryRoom,
  type SummarySource,
  type SummaryDrawing
} from '../shared/summary'
import { netFromTotals, finishesSchema, type Category } from '../shared/takeoff'
export function readSummary(db: Database.Database, raw: unknown): SummaryReport {
  const request = summaryRequestSchema.parse(raw)
  const project = db
    .prepare(
      'SELECT projects.name,clients.name AS clientName FROM projects JOIN clients ON clients.id=projects.clientId WHERE projects.id=?'
    )
    .get(request.projectId) as { name: string; clientName: string } | undefined
  if (!project) throw new Error('集計する物件が見つかりません。')
  const drawings = db
    .prepare('SELECT id,name,pageCount FROM drawings WHERE projectId=? ORDER BY createdAt,id')
    .all(request.projectId) as SummaryDrawing[]
  const storedRooms = db
    .prepare(
      'SELECT rooms.* FROM rooms JOIN drawings ON drawings.id=rooms.drawingId WHERE drawings.projectId=? ORDER BY drawings.createdAt,drawings.id,rooms.pageNumber,rooms.rowid'
    )
    .all(request.projectId) as {
    id: string
    groupId: string
    name: string
    drawingId: string
    pageNumber: number
  }[]
  const rooms: SummaryRoom[] = []
  const groups = new Map<string, SummaryRoom>()
  const pageCounts = new Map<string, number>()
  const groupCounts = new Map<string, number>()
  const partNumbers = new Map<string, number>()
  for (const r of storedRooms) {
    if (!groups.has(r.groupId)) {
      const pageKey = `${r.drawingId}:${r.pageNumber}`
      const ordinal = (pageCounts.get(pageKey) ?? 0) + 1
      pageCounts.set(pageKey, ordinal)
      const room = {
        id: r.groupId,
        name: r.name,
        drawingId: r.drawingId,
        pageNumber: r.pageNumber,
        ordinal
      }
      groups.set(r.groupId, room)
      rooms.push(room)
    }
    const partNumber = (groupCounts.get(r.groupId) ?? 0) + 1
    groupCounts.set(r.groupId, partNumber)
    partNumbers.set(r.id, partNumber)
  }
  if (request.drawingId && !drawings.some((d) => d.id === request.drawingId))
    throw new Error('この物件に対象の図面がありません。')
  if (
    request.pageNumber &&
    request.pageNumber > drawings.find((d) => d.id === request.drawingId)!.pageCount
  )
    throw new Error('対象のページがありません。')
  if (request.groupId && !rooms.some((r) => r.id === request.groupId))
    throw new Error('この物件に対象の部屋がありません。')
  type Row = Omit<
    SummarySource,
    'roomOrdinal' | 'partNumber' | 'rawQuantity' | 'rawNet' | 'fixed'
  > & { quantity: number; fixedQuantity: number | null }
  const rows = db
    .prepare(
      `SELECT i.id,i.roomId,r.groupId,COALESCE(r.name,'部屋未指定') AS roomName,i.drawingId,d.name AS drawingName,i.pageNumber,i.category,i.unit,i.finish,i.specification,i.unitPrice,i.quantity,i.fixedQuantity,i.source,COALESCE(deduct.total,0) AS rawDeduction FROM takeoff_items i JOIN drawings d ON d.id=i.drawingId LEFT JOIN rooms r ON r.id=i.roomId LEFT JOIN (SELECT targetItemId,SUM(quantity) AS total FROM deductions GROUP BY targetItemId) deduct ON deduct.targetItemId=i.id WHERE d.projectId=? ORDER BY d.createdAt,d.id,i.pageNumber,i.rowid`
    )
    .all(request.projectId) as Row[]
  const sources: SummarySource[] = rows.map(({ quantity, fixedQuantity, ...r }) => ({
    ...r,
    roomOrdinal: groups.get(r.groupId ?? '')?.ordinal ?? 0,
    partNumber: partNumbers.get(r.roomId ?? '') ?? 0,
    rawQuantity: fixedQuantity ?? quantity,
    rawNet: netFromTotals({ quantity, fixedQuantity }, r.rawDeduction),
    fixed: fixedQuantity !== null
  }))
  for (const drawing of drawings) {
    const pages = db
      .prepare('SELECT pageNumber FROM drawing_pages WHERE drawingId=?')
      .all(drawing.id) as { pageNumber: number }[]
    for (const page of pages)
      for (const c of readCounts(db, drawing.id, page.pageNumber)) {
        const room = storedRooms.find((r) => r.id === c.roomId)
        sources.push({
          id: c.id,
          roomId: c.roomId,
          groupId: room?.groupId ?? null,
          roomName: room?.name ?? '部屋未指定',
          roomOrdinal: groups.get(room?.groupId ?? '')?.ordinal ?? 0,
          partNumber: 0,
          drawingId: c.drawingId,
          drawingName: drawing.name,
          pageNumber: c.pageNumber,
          category: c.category,
          unit: c.unit,
          finish: c.name,
          specification: c.specification,
          unitPrice: c.unitPrice,
          rawQuantity: c.points.length,
          rawDeduction: 0,
          rawNet: c.points.length,
          fixed: false,
          source: 'count'
        })
      }
  }
  const report = {
    request,
    projectName: project.name,
    clientName: project.clientName,
    drawings,
    rooms,
    categoryOptions: [...new Set(sources.map((s) => s.category))],
    ...aggregateSummary(sources, request)
  }
  return {
    ...report,
    fingerprint: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    generatedAt: new Date().toISOString()
  }
}

// Update only the selected summary row. Geometry, deductions, fixed values and other finishes stay intact.
export function editSummary(db: Database.Database, raw: unknown): SummaryReport {
  const input = summaryEditSchema.parse(raw)
  return db.transaction(() => {
    const report = readSummary(db, input.request)
    if (report.request.view !== 'room-finish') throw new Error('部屋×仕上げから編集してください。')
    if (report.fingerprint !== input.fingerprint)
      throw new Error('集計内容が更新されています。閉じて再集計してから編集してください。')
    const row = report.rows.find((r) => r.id === input.rowId)
    if (!row) throw new Error('編集する明細が見つかりません。')
    const ids = new Set(row.sourceIds)
    const lines = report.lines.filter((l) => ids.has(l.id))
    const pages = new Map<string, { drawingId: string; pageNumber: number }>()
    for (const line of lines) {
      if (line.source === 'count') {
        nameSchema.parse(input.finish.name)
        db.prepare('UPDATE count_groups SET name=?,unitPrice=?,specification=? WHERE id=?').run(
          input.finish.name,
          input.finish.unitPrice,
          input.finish.specification ?? '',
          line.id
        )
      } else
        db.prepare('UPDATE takeoff_items SET finish=?,unitPrice=?,specification=? WHERE id=?').run(
          input.finish.name,
          input.finish.unitPrice,
          input.finish.specification ?? '',
          line.id
        )
      if (line.roomId && line.source === 'auto-room') {
        const stored = db.prepare('SELECT finishes FROM rooms WHERE id=?').get(line.roomId) as {
          finishes: string
        }
        const finishes = finishesSchema.parse(JSON.parse(stored.finishes))
        finishes[line.category as Category] = {
          ...finishes[line.category as Category],
          ...input.finish
        }
        db.prepare('UPDATE rooms SET finishes=? WHERE id=?').run(
          JSON.stringify(finishes),
          line.roomId
        )
      }
      pages.set(`${line.drawingId}:${line.pageNumber}`, line)
    }
    for (const page of pages.values())
      db.prepare(
        'UPDATE drawing_pages SET revision=revision+1 WHERE drawingId=? AND pageNumber=?'
      ).run(page.drawingId, page.pageNumber)
    return readSummary(db, input.request)
  })()
}
