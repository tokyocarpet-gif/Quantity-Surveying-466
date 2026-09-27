import type Database from 'better-sqlite3'
import {
  companySchema,
  emptyCompany,
  catalogOptionsSchema,
  addCatalogOptionSchema,
  renameCatalogOptionSchema,
  builtinCatalogValues
} from '../shared/business'
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
    const builtins = builtinCatalogValues(data.kind)
    if (!values.includes(data.name) && !builtins.includes(data.name)) values.push(data.name)
    save(db, 'catalog-options', catalogOptionsSchema.parse(options))
  })()
}
export function validateBusinessData(db: Database.Database): void {
  readCompany(db)
  readCatalogOptions(db)
}

export function renameCatalogOption(db: Database.Database, input: unknown): void {
  const data = renameCatalogOptionSchema.parse(input)
  db.transaction(() => {
    const options = readCatalogOptions(db)
    const key = data.kind === 'part' ? 'parts' : 'units'
    const column = data.kind === 'part' ? 'category' : 'unit'
    const values = options[key]
    const builtins = builtinCatalogValues(data.kind)
    if (builtins.includes(data.oldName))
      throw new Error('基本項目は数量計算に使用するため変更できません。')
    const exists = (name: string) =>
      !!db.prepare(`SELECT 1 FROM materials WHERE ${column}=? LIMIT 1`).get(name)
    if (!values.includes(data.oldName) && !exists(data.oldName))
      throw new Error('変更元の項目が見つかりません。一覧を開き直してください。')
    if (data.name === data.oldName) return
    if (builtins.includes(data.name) || values.includes(data.name) || exists(data.name))
      throw new Error('同じ名前の項目が既にあります。別の名前を入力してください。')
    options[key] = values.includes(data.oldName)
      ? values.map((v) => (v === data.oldName ? data.name : v))
      : [...values, data.name]
    save(db, 'catalog-options', catalogOptionsSchema.parse(options))
    // Materials are editable masters. Takeoff and estimate snapshots retain their original labels.
    db.prepare(`UPDATE materials SET ${column}=? WHERE ${column}=?`).run(data.name, data.oldName)
  })()
}
