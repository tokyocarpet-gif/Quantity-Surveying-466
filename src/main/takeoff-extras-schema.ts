export const TAKEOFF_EXTRAS_SQL = `
ALTER TABLE rooms ADD COLUMN sleeveWalls TEXT NOT NULL DEFAULT '[]';
CREATE TABLE height_history (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 heightMm REAL NOT NULL CHECK(heightMm>0), lastUsed INTEGER NOT NULL CHECK(lastUsed>=0), PRIMARY KEY(projectId,heightMm));
INSERT INTO height_history SELECT drawings.projectId,rooms.heightMm,MAX(rooms.rowid) FROM rooms
 JOIN drawings ON drawings.id=rooms.drawingId GROUP BY drawings.projectId,rooms.heightMm;
PRAGMA user_version = 4;
`
