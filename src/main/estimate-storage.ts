import { readCompany } from './business-storage'
import { companyIssuer, companyConditions } from '../shared/business'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { idSchema } from '../shared/validation'
import {
  estimateBodySchema,
  estimateSourceSchema,
  estimateCreateSchema,
  estimateReadSchema,
  estimateSaveSchema,
  calculateEstimate,
  estimateLinesFromSummary,
  type EstimateDoc,
  type EstimateListItem,
  type EstimateBody
} from '../shared/estimate'
import { summaryScope, summaryViewLabels } from '../shared/summary'
import { readSummary } from './summary-storage'
export const ESTIMATE_SQL = `
CREATE TABLE estimates (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, createdAt TEXT NOT NULL, source TEXT NOT NULL);
CREATE INDEX estimates_project ON estimates(projectId);
CREATE TABLE estimate_revisions (estimateId TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision>0), savedAt TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(estimateId,revision));
PRAGMA user_version = 5;
`
type Stored = { id: string; projectId: string; createdAt: string; source: string }
export function readEstimate(db: Database.Database, raw: unknown): EstimateDoc {
  const input = estimateReadSchema.parse(raw),
    stored = db.prepare('SELECT * FROM estimates WHERE id=?').get(input.id) as Stored | undefined
  if (!stored) throw new Error('見積が見つかりません。')
  const versions = db
    .prepare(
      'SELECT revision,savedAt FROM estimate_revisions WHERE estimateId=? ORDER BY revision DESC'
    )
    .all(input.id) as { revision: number; savedAt: string }[]
  if (!versions.length) throw new Error('見積の保存履歴がありません。')
  const revision = input.revision ?? versions[0].revision
  const row = db
    .prepare('SELECT body,savedAt FROM estimate_revisions WHERE estimateId=? AND revision=?')
    .get(input.id, revision) as { body: string; savedAt: string } | undefined
  if (!row) throw new Error('見積の指定した版が見つかりません。')
  const body = estimateBodySchema.parse(JSON.parse(row.body))
  return {
    id: stored.id,
    projectId: stored.projectId,
    createdAt: stored.createdAt,
    revision,
    latestRevision: versions[0].revision,
    savedAt: row.savedAt,
    body,
    source: estimateSourceSchema.parse(JSON.parse(stored.source)),
    totals: calculateEstimate(body),
    versions
  }
}
export function listEstimates(db: Database.Database, raw: unknown): EstimateListItem[] {
  const projectId = idSchema.parse(raw)
  if (!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))
    throw new Error('物件が見つかりません。')
  const rows = db
    .prepare(
      `SELECT e.id,r.revision,r.savedAt,r.body FROM estimates e JOIN estimate_revisions r ON r.estimateId=e.id WHERE e.projectId=? AND r.revision=(SELECT MAX(revision) FROM estimate_revisions WHERE estimateId=e.id) ORDER BY r.savedAt DESC,e.id`
    )
    .all(projectId) as { id: string; revision: number; savedAt: string; body: string }[]
  return rows.map((r) => {
    const body = estimateBodySchema.parse(JSON.parse(r.body))
    return {
      id: r.id,
      title: body.title,
      number: body.number,
      revision: r.revision,
      updatedAt: r.savedAt,
      total: calculateEstimate(body).subtotal
    }
  })
}
export function createEstimate(db: Database.Database, raw: unknown): EstimateDoc {
  const input = estimateCreateSchema.parse(raw)
  return db.transaction(() => {
    const report = readSummary(db, input.request)
    if (report.fingerprint !== input.fingerprint)
      throw new Error('集計内容が更新されています。再集計してから見積を作成してください。')
    if (!report.rows.length) throw new Error('見積に取り込む明細がありません。')
    const ids = report.rows.map(() => randomUUID()),
      id = randomUUID(),
      now = new Date().toISOString()
    const date = new Date().toLocaleDateString('sv-SE'),
      company = readCompany(db)
    const body: EstimateBody = estimateBodySchema.parse({
      title: report.projectName,
      number: `M-${date.replaceAll('-', '')}-${id.slice(0, 8)}`,
      date,
      recipient: report.clientName,
      issuer: companyIssuer(company),
      conditions: companyConditions(company),
      memo: '',
      taxRate: 0,
      amountRounding: 'round',
      taxRounding: 'truncate',
      lines: estimateLinesFromSummary(report, ids)
    })
    const source = estimateSourceSchema.parse({
      scope: summaryScope(report),
      view: summaryViewLabels[report.request.view],
      generatedAt: report.generatedAt,
      fingerprint: report.fingerprint,
      lines: report.rows.map((r, i) => ({
        lineId: ids[i],
        itemIds: r.sourceIds,
        room: r.roomLabel,
        name: r.finish,
        specification: r.specification ?? '',
        quantity: r.quantity,
        unitPrice: r.unitPrice
      }))
    })
    db.prepare('INSERT INTO estimates(id,projectId,createdAt,source) VALUES (?,?,?,?)').run(
      id,
      input.request.projectId,
      now,
      JSON.stringify(source)
    )
    db.prepare('INSERT INTO estimate_revisions VALUES (?,1,?,?)').run(id, now, JSON.stringify(body))
    return readEstimate(db, { id })
  })()
}
export function saveEstimate(db: Database.Database, raw: unknown): EstimateDoc {
  const input = estimateSaveSchema.parse(raw)
  return db.transaction(() => {
    const old = readEstimate(db, { id: input.id })
    if (old.latestRevision !== input.expectedRevision)
      throw new Error(
        '見積が別の操作で更新されています。入力内容を控えて最新の版を開き直してください。'
      )
    if (JSON.stringify(old.body) === JSON.stringify(input.body)) return old
    db.prepare('INSERT INTO estimate_revisions VALUES (?,?,?,?)').run(
      input.id,
      old.latestRevision + 1,
      new Date().toISOString(),
      JSON.stringify(input.body)
    )
    return readEstimate(db, { id: input.id })
  })()
}
export function validateEstimateData(db: Database.Database): void {
  const rows = db.prepare('SELECT * FROM estimates').all() as Stored[]
  for (const r of rows) {
    idSchema.parse(r.id)
    idSchema.parse(r.projectId)
    z.iso.datetime().parse(r.createdAt)
    estimateSourceSchema.parse(JSON.parse(r.source))
    const doc = readEstimate(db, { id: r.id })
    if (doc.versions.some((v, i) => v.revision !== doc.latestRevision - i))
      throw new Error('見積の版履歴が不正です。')
  }
  for (const r of db.prepare('SELECT * FROM estimate_revisions').all() as {
    estimateId: string
    revision: number
    savedAt: string
    body: string
  }[]) {
    idSchema.parse(r.estimateId)
    z.number().int().positive().parse(r.revision)
    z.iso.datetime().parse(r.savedAt)
    estimateBodySchema.parse(JSON.parse(r.body))
  }
}
