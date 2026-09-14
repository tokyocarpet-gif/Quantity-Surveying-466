import { readCatalogOptions } from './business-storage'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { idSchema, nameSchema } from '../shared/validation'
import {
  materialChangeSchema,
  materialInputSchema,
  type Material,
  type MaterialContext
} from '../shared/materials'

// Keep previous schema SQL unchanged: older backup schemas are validated before migration.
export const MASTER_SQL = `
ALTER TABLE rooms ADD COLUMN enabledCategories TEXT NOT NULL DEFAULT '["ceiling","wall","baseboard","floor"]';
ALTER TABLE rooms ADD COLUMN groupId TEXT NOT NULL DEFAULT '';
UPDATE rooms SET groupId=id;
CREATE TABLE materials (id TEXT PRIMARY KEY, projectId TEXT REFERENCES projects(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('ceiling','wall','baseboard','floor')), name TEXT NOT NULL,
 unitPrice REAL CHECK(unitPrice>=0), sourceId TEXT REFERENCES materials(id) ON DELETE SET NULL);
CREATE UNIQUE INDEX project_material_source ON materials(projectId,sourceId) WHERE sourceId IS NOT NULL;
CREATE TABLE room_name_history (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, lastUsed TEXT NOT NULL, PRIMARY KEY(projectId,name));
INSERT INTO room_name_history SELECT drawings.projectId,rooms.name,MAX(projects.updatedAt) FROM rooms
 JOIN drawings ON drawings.id=rooms.drawingId JOIN projects ON projects.id=drawings.projectId GROUP BY drawings.projectId,rooms.name;
INSERT INTO materials(id,category,name) VALUES
 ('a0000000-0000-4000-8000-000000000001','ceiling','ビニルクロス'),
 ('a0000000-0000-4000-8000-000000000002','ceiling','化粧石膏ボード'),
 ('a0000000-0000-4000-8000-000000000003','wall','ビニルクロス'),
 ('a0000000-0000-4000-8000-000000000004','wall','塗装'),
 ('a0000000-0000-4000-8000-000000000005','baseboard','ソフト巾木'),
 ('a0000000-0000-4000-8000-000000000006','baseboard','木製巾木'),
 ('a0000000-0000-4000-8000-000000000007','floor','タイルカーペット'),
 ('a0000000-0000-4000-8000-000000000008','floor','長尺塩ビシート'),
 ('a0000000-0000-4000-8000-000000000009','floor','ビニル床タイル');
PRAGMA user_version = 3;
`
function requireProject(db: Database.Database, projectId: string): void {
  idSchema.parse(projectId)
  if (!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))
    throw new Error('対象の物件がありません。')
}
export function readMaterials(db: Database.Database, raw: unknown): MaterialContext {
  const projectId = idSchema.nullable().parse(raw)
  if (projectId) requireProject(db, projectId)
  return {
    ...readCatalogOptions(db),
    global: db
      .prepare(
        "SELECT * FROM materials WHERE projectId IS NULL ORDER BY CASE category WHEN 'ceiling' THEN 0 WHEN 'wall' THEN 1 WHEN 'baseboard' THEN 2 WHEN 'floor' THEN 3 ELSE 4 END,category,name,id"
      )
      .all() as Material[],
    project: projectId
      ? (db
          .prepare(
            "SELECT * FROM materials WHERE projectId=? ORDER BY CASE category WHEN 'ceiling' THEN 0 WHEN 'wall' THEN 1 WHEN 'baseboard' THEN 2 WHEN 'floor' THEN 3 ELSE 4 END,category,name,id"
          )
          .all(projectId) as Material[])
      : [],
    heightHistory: projectId
      ? (
          db
            .prepare(
              'SELECT heightMm FROM height_history WHERE projectId=? ORDER BY lastUsed DESC,heightMm LIMIT 100'
            )
            .all(projectId) as { heightMm: number }[]
        ).map((r) => r.heightMm)
      : [],
    roomNames: projectId
      ? (
          db
            .prepare(
              'SELECT name FROM room_name_history WHERE projectId=? ORDER BY lastUsed DESC,name LIMIT 100'
            )
            .all(projectId) as { name: string }[]
        ).map((r) => r.name)
      : []
  }
}
export function changeMaterials(db: Database.Database, raw: unknown): void {
  const change = materialChangeSchema.parse(raw)
  db.transaction(() => {
    if (change.kind === 'save') {
      if (change.input.projectId) requireProject(db, change.input.projectId)
      const old = db.prepare('SELECT * FROM materials WHERE id=?').get(change.id) as
        Material | undefined
      if (old && old.projectId !== change.input.projectId)
        throw new Error('共通・物件マスタの所属は変更できません。')
      db.prepare(
        'INSERT INTO materials(id,projectId,category,name,unitPrice,specification,unit,tileWidthMm,tileHeightMm,tileGapMm,tileThicknessMm,layoutType) VALUES (@id,@projectId,@category,@name,@unitPrice,@specification,@unit,@tileWidthMm,@tileHeightMm,@tileGapMm,@tileThicknessMm,@layoutType) ON CONFLICT(id) DO UPDATE SET category=excluded.category,name=excluded.name,unitPrice=excluded.unitPrice,specification=excluded.specification,unit=excluded.unit,tileWidthMm=excluded.tileWidthMm,tileHeightMm=excluded.tileHeightMm,tileGapMm=excluded.tileGapMm,tileThicknessMm=excluded.tileThicknessMm,layoutType=excluded.layoutType'
      ).run({ id: change.id, ...change.input })
    } else if (change.kind === 'delete') {
      if (!db.prepare('DELETE FROM materials WHERE id=?').run(change.id).changes)
        throw new Error('対象の仕上げ材がありません。')
    } else {
      requireProject(db, change.projectId)
      for (const id of new Set(change.ids)) {
        const source = db
          .prepare('SELECT * FROM materials WHERE id=? AND projectId IS NULL')
          .get(id) as Material | undefined
        if (!source) throw new Error('共通マスタに対象の仕上げ材がありません。')
        if (
          db
            .prepare('SELECT id FROM materials WHERE projectId=? AND sourceId=?')
            .get(change.projectId, id)
        )
          continue
        db.prepare(
          'INSERT INTO materials(id,projectId,category,name,unitPrice,sourceId,specification,unit,tileWidthMm,tileHeightMm,tileGapMm,tileThicknessMm,layoutType) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(
          randomUUID(),
          change.projectId,
          source.category,
          source.name,
          source.unitPrice,
          id,
          source.specification,
          source.unit,
          source.tileWidthMm,
          source.tileHeightMm,
          source.tileGapMm,
          source.tileThicknessMm,
          source.layoutType
        )
      }
    }
  })()
}
export function validateMasterData(db: Database.Database): void {
  if ((db.pragma('user_version', { simple: true }) as number) >= 4) {
    for (const row of db.prepare('SELECT * FROM height_history').all() as {
      projectId: string
      heightMm: number
      lastUsed: number
    }[]) {
      idSchema.parse(row.projectId)
      z.number().finite().positive().max(1e7).parse(row.heightMm)
      z.number().int().nonnegative().parse(row.lastUsed)
    }
  }
  const materials = db.prepare('SELECT * FROM materials').all() as Material[]
  for (const { id, sourceId, ...input } of materials) {
    idSchema.parse(id)
    materialInputSchema.parse(input)
    if (
      sourceId !== null &&
      (!input.projectId || !materials.some((m) => m.id === sourceId && m.projectId === null))
    )
      throw new Error('仕上げ材マスタの参照が不正です。')
  }
  for (const r of db.prepare('SELECT * FROM room_name_history').all() as {
    projectId: string
    name: string
    lastUsed: string
  }[]) {
    idSchema.parse(r.projectId)
    nameSchema.parse(r.name)
    z.string().datetime().parse(r.lastUsed)
  }
}
