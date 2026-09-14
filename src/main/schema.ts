import { LAYOUT_SQL } from './layout-storage'
import { COUNT_SQL } from './count-storage'
import { BUSINESS_SQL } from './business-storage'
import { ESTIMATE_SQL } from './estimate-storage'
import type Database from 'better-sqlite3'
import { TAKEOFF_EXTRAS_SQL } from './takeoff-extras-schema'
import { MASTER_SQL } from './master-storage'
import { TAKEOFF_SQL } from './takeoff-storage'

export const BASE_SQL = `
          CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL);
          CREATE TABLE projects (id TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            name TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active','completed','archived')),
            createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
          CREATE TABLE drawings (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name TEXT NOT NULL, filePath TEXT NOT NULL UNIQUE, pageCount INTEGER NOT NULL CHECK(pageCount > 0),
            byteSize INTEGER NOT NULL CHECK(byteSize > 0), sha256 TEXT NOT NULL, createdAt TEXT NOT NULL);
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE INDEX projects_client ON projects(clientId);
          CREATE INDEX drawings_project ON drawings(projectId);
          PRAGMA user_version = 1;
        `

export const PROJECT_DETAILS_SQL = `
ALTER TABLE projects ADD COLUMN assignee TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 8;
`

export const MATERIAL_STANDARD_SQL = `
ALTER TABLE materials ADD COLUMN tileThicknessMm REAL;
PRAGMA user_version = 10;
`

export const ROLL_MATERIAL_SQL = `
ALTER TABLE materials ADD COLUMN layoutType TEXT NOT NULL DEFAULT 'tile';
PRAGMA user_version = 11;
`

export const ROLL_CUT_ORDER_SQL = `PRAGMA user_version = 12;`

export const ROLL_SHIPPING_SQL = `PRAGMA user_version = 13;`

export function initializeSchema(db: Database.Database, version: number): void {
  db.transaction(() => {
    if (version === 0) db.exec(BASE_SQL)
    if (version < 2) db.exec(TAKEOFF_SQL)
    if (version < 3) db.exec(MASTER_SQL)
    if (version < 4) db.exec(TAKEOFF_EXTRAS_SQL)
    if (version < 5) db.exec(ESTIMATE_SQL)
    if (version < 6) db.exec(BUSINESS_SQL)
    if (version < 7) db.exec(COUNT_SQL)
    if (version < 8) db.exec(PROJECT_DETAILS_SQL)
    if (version < 9) db.exec(LAYOUT_SQL)
    if (version < 10) db.exec(MATERIAL_STANDARD_SQL)
    if (version < 11) db.exec(ROLL_MATERIAL_SQL)
    if (version < 12) db.exec(ROLL_CUT_ORDER_SQL)
    if (version < 13) db.exec(ROLL_SHIPPING_SQL)
  })()
}
