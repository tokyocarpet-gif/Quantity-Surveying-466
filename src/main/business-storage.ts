import type Database from 'better-sqlite3'
import {
  companySchema,
  emptyCompany,
  catalogOptionsSchema,
  addCatalogOptionSchema
} from '../shared/business'
import { categories, categoryLabels } from '../shared/takeoff'
export const BUSINESS_SQL = `
CREATE TABLE materials_v6 (id TEXT PRIMARY KEY, projectId TEXT REFERENCES projects(id) ON DELETE CASCADE, category TEXT NOT NULL, name TEXT NOT NULL, unitPrice REAL CHECK(unitPrice>=0), sourceId TEXT REFERENCES materials_v6(id) ON DELETE SET NULL, specification TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL);
INSERT INTO materials_v6(id,projectId,category,name,unitPrice,sourceId,unit) SELECT id,projectId,category,name,unitPrice,sourceId,CASE category WHEN 'baseboard' THEN 'm' ELSE '㎡' END FROM materials;
DROP TABLE materials;
ALTER TABLE materials_v6 RENAME TO materials;
CREATE UNIQUE INDEX project_material_source ON materials(projectId,sourceId) WHERE sourceId IS NOT NULL;
ALTER TABLE takeoff_items ADD COLUMN specification TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 6;
`
function setting(db: Database.Database, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
    { value: string } | undefined
  return row ? JSON.parse(row.value) : null
}
function save(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, JSON.stringify(value))
}
export function readCompany(db: Database.Database) {
  return companySchema.parse(setting(db, 'company') ?? emptyCompany())
}
export function saveCompany(db: Database.Database, input: unknown) {
  const data = companySchema.parse(input)
  save(db, 'company', data)
  return data
}
export function readCatalogOptions(db: Database.Database) {
  return catalogOptionsSchema.parse(setting(db, 'catalog-options') ?? { parts: [], units: [] })
}
export function addCatalogOption(db: Database.Database, input: unknown): void {
  const data = addCatalogOptionSchema.parse(input)
  db.transaction(() => {
    const options = readCatalogOptions(db)
    const values = data.kind === 'part' ? options.parts : options.units
    const builtins =
      data.kind === 'part'
        ? categories.flatMap((c) => [c, categoryLabels[c]])
        : ['㎡', 'm', '式', '個']
    if (!values.includes(data.name) && !builtins.includes(data.name)) values.push(data.name)
    save(db, 'catalog-options', catalogOptionsSchema.parse(options))
  })()
}
export function validateBusinessData(db: Database.Database): void {
  readCompany(db)
  readCatalogOptions(db)
}
