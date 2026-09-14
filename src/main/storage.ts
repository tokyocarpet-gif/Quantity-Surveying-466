import { layoutPdfSchema } from '../shared/layout-pdf'
import { computeLayout, layoutSourceKey } from '../shared/layout'
import { LAYOUT_SQL, readLayout, saveLayout, validateLayouts } from './layout-storage'
import { COUNT_SQL, validateCounts } from './count-storage'
import {
  BUSINESS_SQL,
  readCompany,
  saveCompany,
  addCatalogOption,
  validateBusinessData
} from './business-storage'
import {
  ESTIMATE_SQL,
  createEstimate,
  readEstimate,
  listEstimates,
  saveEstimate,
  validateEstimateData
} from './estimate-storage'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { PDFDocument } from 'pdf-lib'
import { createHash, randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  statSync,
  mkdtempSync,
  realpathSync
} from 'node:fs'
import { z } from 'zod'
import { readSummary, editSummary } from './summary-storage'
import { summaryCsv, summaryExportSchema } from '../shared/summary'
import { TAKEOFF_EXTRAS_SQL } from './takeoff-extras-schema'
import { MASTER_SQL, readMaterials, changeMaterials, validateMasterData } from './master-storage'
import {
  BASE_SQL,
  initializeSchema,
  PROJECT_DETAILS_SQL,
  MATERIAL_STANDARD_SQL,
  ROLL_MATERIAL_SQL,
  ROLL_CUT_ORDER_SQL,
  ROLL_SHIPPING_SQL
} from './schema'
import {
  TAKEOFF_SQL,
  readTakeoff,
  previewTakeoff,
  applyTakeoff,
  validateTakeoffData
} from './takeoff-storage'
import type { PageState, TakeoffPreview } from '../shared/takeoff'
import type { Client, Drawing, ImportResult, Project, Selection, Workspace } from '../shared/api'
import { idSchema, nameSchema, projectSchema, selectionSchema } from '../shared/validation'

const DATABASE = 'db/sekisan-kanri.db'
const MAX_PDF = 150 * 1024 * 1024
const MAX_BACKUP = 512 * 1024 * 1024
const MAX_ZIP = 256 * 1024 * 1024
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
const now = (): string => new Date().toISOString()
const fileSchema = z.string().regex(/^drawings\/[0-9a-f-]{36}\.pdf$/)
const manifestSchema = z
  .object({
    application: z.literal('sekisan-kanri'),
    formatVersion: z.literal(1),
    schemaVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(10),
      z.literal(11),
      z.literal(12),
      z.literal(13)
    ]),
    createdAt: z.string().datetime(),
    files: z
      .array(
        z
          .object({
            path: z.string(),
            size: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/)
          })
          .strict()
      )
      .min(1)
      .max(10000)
  })
  .strict()
type StoredDrawing = Drawing & { filePath: string; sha256: string }

/** All calls from IPC use run(), so async snapshots/imports cannot interleave mutations. */
export class Storage {
  private db!: Database.Database
  private tail: Promise<unknown> = Promise.resolve()
  readonly dataPath: string
  constructor(readonly root: string) {
    this.root = resolve(root)
    this.dataPath = join(this.root, 'data')
    mkdirSync(this.root, { recursive: true })
    this.recoverInterruptedRestore()
    this.open()
  }
  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }
  close(): void {
    if (this.db?.open) this.db.close()
  }
  private open(): void {
    mkdirSync(join(this.dataPath, 'db'), { recursive: true })
    mkdirSync(join(this.dataPath, 'drawings'), { recursive: true })
    this.db = new Database(join(this.dataPath, DATABASE))
    try {
      this.db.pragma('foreign_keys = ON')
      const version = this.db.pragma('user_version', { simple: true }) as number
      if (version > 13)
        throw new Error('このデータは新しいバージョンの積算管理で作成されています。')
      if (version > 0 && version < 13) {
        const migrationPath = join(
          this.root,
          'recovery',
          `before-schema-v13-${Date.now()}-${randomUUID()}.db`
        )
        mkdirSync(dirname(migrationPath), { recursive: true })
        this.db.prepare('VACUUM INTO ?').run(migrationPath)
      }
      initializeSchema(this.db, version)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
    } catch (error) {
      this.close()
      throw error
    }
  }
  readCompany() {
    return readCompany(this.db)
  }
  saveCompany(input: unknown) {
    return saveCompany(this.db, input)
  }
  addCatalogOption(input: unknown) {
    return addCatalogOption(this.db, input)
  }
  createEstimate(input: unknown) {
    return createEstimate(this.db, input)
  }
  readEstimate(input: unknown) {
    return readEstimate(this.db, input)
  }
  listEstimates(input: unknown) {
    return listEstimates(this.db, input)
  }
  saveEstimate(input: unknown) {
    return saveEstimate(this.db, input)
  }
  editSummary(input: unknown) {
    return editSummary(this.db, input)
  }
  readSummary(input: unknown) {
    return readSummary(this.db, input)
  }
  exportSummary(input: unknown, path: string): string {
    const data = summaryExportSchema.parse(input),
      report = this.readSummary(data.request)
    if (report.fingerprint !== data.fingerprint)
      throw new Error(
        '集計内容が更新されています。「再集計」で最新の内容を確認してから出力してください。'
      )
    if (extname(path).toLowerCase() !== '.csv') throw new Error('拡張子.csvで保存してください。')
    const target = join(realpathSync(dirname(resolve(path))), basename(path))
    const root = realpathSync(this.root)
    if (target === root || target.startsWith(root + sep))
      throw new Error('アプリのデータ保存先以外を指定してください。')
    const temporary = target + '.tmp-' + randomUUID()
    try {
      writeFileSync(temporary, summaryCsv(report), { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, target)
    } finally {
      rmSync(temporary, { force: true })
    }
    return target
  }
  layoutReport(raw: unknown) {
    const input = layoutPdfSchema.parse(raw)
    const room = this.db
      .prepare('SELECT drawingId,pageNumber FROM rooms WHERE id=?')
      .get(input.roomId) as { drawingId: string; pageNumber: number } | undefined
    if (!room) throw new Error('対象の部屋がありません。')
    const page = this.readTakeoff(room)
    const selected = page.rooms.find((r) => r.id === input.roomId)!
    if (!page.scaleRatio || layoutSourceKey(selected.polygon, page.scaleRatio) !== input.sourceKey)
      throw new Error('部屋の形状または縮尺が変わりました。割り付けを開き直してください。')
    const saved = this.readLayout(input.roomId)
    if ((saved?.revision ?? 0) !== input.expectedRevision)
      throw new Error('配置が更新されています。割り付けを開き直してください。')
    const workspace = this.workspace()
    const drawing = workspace.drawings.find((d) => d.id === room.drawingId)!
    const project = workspace.projects.find((p) => p.id === drawing.projectId)!
    return {
      input,
      result: computeLayout(selected.polygon, page.scaleRatio, input.body),
      roomName: selected.name,
      projectName: project.name,
      drawingName: drawing.name,
      pageNumber: room.pageNumber,
      company: this.readCompany().name,
      draft:
        !saved ||
        JSON.stringify({
          ...saved.body,
          maxWidthMm:
            saved.body.layoutType === 'tile'
              ? saved.body.maxWidthMm
              : (saved.body.maxWidthMm ?? saved.body.widthMm)
        }) !== JSON.stringify(input.body)
    }
  }
  readLayout(input: unknown) {
    return readLayout(this.db, input)
  }
  saveLayout(input: unknown) {
    return saveLayout(this.db, input)
  }
  readMaterials(input: unknown) {
    return readMaterials(this.db, input)
  }
  changeMaterials(input: unknown): void {
    changeMaterials(this.db, input)
  }
  readTakeoff(input: unknown): PageState {
    return readTakeoff(this.db, input)
  }
  previewTakeoff(input: unknown): TakeoffPreview {
    return previewTakeoff(this.db, input)
  }
  applyTakeoff(input: unknown): PageState {
    return applyTakeoff(this.db, input)
  }
  private setting(key: string): string | null {
    return (
      (
        this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
          { value: string } | undefined
      )?.value ?? null
    )
  }
  private setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      )
      .run(key, value)
  }
  private requireRow(table: 'clients' | 'projects' | 'drawings', id: unknown): void {
    idSchema.parse(id)
    if (!this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id))
      throw new Error('対象が見つかりません。画面を更新してください。')
  }
  workspace(): Workspace {
    const clients = this.db
      .prepare('SELECT * FROM clients ORDER BY createdAt, id')
      .all() as Client[]
    const projects = this.db
      .prepare('SELECT * FROM projects ORDER BY updatedAt DESC, id')
      .all() as Project[]
    const drawings = this.db
      .prepare(
        'SELECT id,projectId,name,pageCount,byteSize,createdAt FROM drawings ORDER BY createdAt DESC, id'
      )
      .all() as Drawing[]
    let selection: Selection = { clientId: null, projectId: null }
    try {
      selection = selectionSchema.parse(JSON.parse(this.setting('selection') ?? '{}'))
    } catch {
      /* First launch. */
    }
    if (!clients.some((c) => c.id === selection.clientId)) selection.clientId = null
    if (
      !projects.some(
        (p) =>
          p.id === selection.projectId && (!selection.clientId || p.clientId === selection.clientId)
      )
    )
      selection.projectId = null
    return {
      clients,
      projects,
      drawings,
      selection,
      dataPath: this.dataPath,
      lastBackupAt: this.setting('lastBackupAt')
    }
  }
  saveSelection(input: unknown): void {
    const selection = selectionSchema.parse(input)
    if (selection.clientId) this.requireRow('clients', selection.clientId)
    if (selection.projectId) {
      this.requireRow('projects', selection.projectId)
      const project = this.db
        .prepare('SELECT clientId FROM projects WHERE id = ?')
        .get(selection.projectId) as Project
      if (selection.clientId && selection.clientId !== project.clientId)
        throw new Error('顧客と案件の組み合わせが一致しません。')
    }
    this.setSetting('selection', JSON.stringify(selection))
  }
  createClient(input: unknown): Client {
    const client = { id: randomUUID(), name: nameSchema.parse(input), createdAt: now() }
    this.db
      .prepare('INSERT INTO clients(id,name,createdAt) VALUES (@id,@name,@createdAt)')
      .run(client)
    return client
  }
  renameClient(id: unknown, name: unknown): void {
    this.requireRow('clients', id)
    this.db.prepare('UPDATE clients SET name=? WHERE id=?').run(nameSchema.parse(name), id)
  }
  createProject(input: unknown): Project {
    const data = projectSchema.parse(input)
    this.requireRow('clients', data.clientId)
    const project = { ...data, id: randomUUID(), createdAt: now(), updatedAt: now() }
    this.db
      .prepare(
        'INSERT INTO projects(id,clientId,name,memo,status,assignee,createdAt,updatedAt) VALUES (@id,@clientId,@name,@memo,@status,@assignee,@createdAt,@updatedAt)'
      )
      .run(project)
    return project
  }
  updateProject(id: unknown, input: unknown): void {
    const data = projectSchema.parse(input)
    this.requireRow('projects', id)
    this.requireRow('clients', data.clientId)
    this.db
      .prepare(
        'UPDATE projects SET clientId=@clientId,name=@name,memo=@memo,status=@status,assignee=@assignee,updatedAt=@updatedAt WHERE id=@id'
      )
      .run({ ...data, id, updatedAt: now() })
  }
  deleteImpact(
    kind: 'clients' | 'projects' | 'drawings',
    id: string
  ): { name: string; projects: number; drawings: number } {
    this.requireRow(kind, id)
    const row = this.db.prepare(`SELECT name FROM ${kind} WHERE id=?`).get(id) as { name: string }
    const drawings = this.drawingsFor(kind, id)
    const projects =
      kind === 'clients'
        ? (
            this.db.prepare('SELECT count(*) AS n FROM projects WHERE clientId=?').get(id) as {
              n: number
            }
          ).n
        : kind === 'projects'
          ? 1
          : 0
    return { name: row.name, projects, drawings: drawings.length }
  }
  private drawingsFor(kind: 'clients' | 'projects' | 'drawings', id: string): StoredDrawing[] {
    if (kind === 'clients')
      return this.db
        .prepare(
          'SELECT drawings.* FROM drawings JOIN projects ON projects.id=drawings.projectId WHERE projects.clientId=?'
        )
        .all(id) as StoredDrawing[]
    return this.db
      .prepare(`SELECT * FROM drawings WHERE ${kind === 'projects' ? 'projectId' : 'id'}=?`)
      .all(id) as StoredDrawing[]
  }
  delete(kind: 'clients' | 'projects' | 'drawings', id: string): void {
    this.requireRow(kind, id)
    const drawings = this.drawingsFor(kind, id)
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${kind} WHERE id=?`).run(id)
    })()
    // Only files whose DB deletion committed are removed. A failed unlink leaves an unreferenced file, never a broken reference.
    for (const drawing of drawings) {
      try {
        rmSync(this.drawingPath(drawing.filePath), { force: true })
      } catch (error) {
        console.error('Unreferenced PDF cleanup failed', error)
      }
    }
  }
  private drawingPath(filePath: string): string {
    return join(this.dataPath, fileSchema.parse(filePath))
  }
  async importPdfs(projectId: string, paths: string[]): Promise<ImportResult> {
    this.requireRow('projects', projectId)
    if (paths.length > 50) throw new Error('一度に取り込める図面は50ファイルまでです。')
    const result: ImportResult = { imported: [], failures: [] }
    for (const path of paths) {
      let managedPath: string | null = null
      try {
        if (extname(path).toLowerCase() !== '.pdf')
          throw new Error('PDFファイルを選択してください。')
        const size = statSync(path).size
        if (size === 0 || size > MAX_PDF) throw new Error('PDFは1ファイル150MB以内にしてください。')
        const data = readFileSync(path)
        if (data.length === 0 || data.length > MAX_PDF)
          throw new Error('PDFは1ファイル150MB以内にしてください。')
        if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-')))
          throw new Error('PDFとして読み取れないファイルです。')
        let pdf: PDFDocument
        try {
          pdf = await PDFDocument.load(data, { updateMetadata: false })
        } catch {
          throw new Error('PDFを読み取れません。破損やパスワード保護を確認してください。')
        }
        if (pdf.getPageCount() === 0) throw new Error('ページがないPDFは取り込めません。')
        const id = randomUUID()
        const row: StoredDrawing = {
          id,
          projectId,
          name: basename(path).slice(0, 120),
          filePath: `drawings/${id}.pdf`,
          pageCount: pdf.getPageCount(),
          byteSize: data.length,
          sha256: sha256(data),
          createdAt: now()
        }
        managedPath = this.drawingPath(row.filePath)
        writeFileSync(managedPath, data, { flag: 'wx' })
        this.db.transaction(() => {
          this.db
            .prepare(
              'INSERT INTO drawings(id,projectId,name,filePath,pageCount,byteSize,sha256,createdAt) VALUES (@id,@projectId,@name,@filePath,@pageCount,@byteSize,@sha256,@createdAt)'
            )
            .run(row)
          this.db.prepare('UPDATE projects SET updatedAt=? WHERE id=?').run(now(), projectId)
        })()
        const { filePath: _path, sha256: _hash, ...drawing } = row
        result.imported.push(drawing)
      } catch (error) {
        if (managedPath) rmSync(managedPath, { force: true })
        result.failures.push({
          name: basename(path),
          message: error instanceof Error ? error.message : '取り込みに失敗しました。'
        })
      }
    }
    return result
  }
  readPdf(id: string): Uint8Array {
    this.requireRow('drawings', id)
    const row = this.db.prepare('SELECT * FROM drawings WHERE id=?').get(id) as StoredDrawing
    const path = this.drawingPath(row.filePath)
    if (!existsSync(path))
      throw new Error('図面ファイルが見つかりません。バックアップから復元してください。')
    if (statSync(path).size > MAX_PDF) throw new Error('図面のサイズが上限を超えています。')
    const data = readFileSync(path)
    if (sha256(data) !== row.sha256)
      throw new Error('保存図面の内容が変わっています。バックアップから復元してください。')
    return new Uint8Array(data)
  }
  renameDrawing(id: string, input: unknown): void {
    this.requireRow('drawings', id)
    this.db.prepare('UPDATE drawings SET name=? WHERE id=?').run(nameSchema.parse(input), id)
  }
  async createBackup(destination: string): Promise<void> {
    // Resolve the parent too, so a symlink or Windows drive casing cannot target the live data.
    const normalize = (path: string): string =>
      process.platform === 'win32' ? path.toLowerCase() : path
    const target = normalize(
      join(realpathSync(dirname(resolve(destination))), basename(destination))
    )
    const dataRoot = normalize(realpathSync(this.root))
    if (target === dataRoot || target.startsWith(dataRoot + sep))
      throw new Error('バックアップはアプリのデータ領域の外に保存してください。')
    const temporary = mkdtempSync(join(this.root, 'backup-'))
    const output = `${destination}.${randomUUID()}.tmp`
    try {
      const snapshot = join(temporary, 'snapshot.db')
      await this.db.backup(snapshot)
      const source = new Database(snapshot, { readonly: true, fileMustExist: true })
      let rows: StoredDrawing[]
      try {
        rows = source.prepare('SELECT * FROM drawings').all() as StoredDrawing[]
      } finally {
        source.close()
      }
      if (rows.length > 9999 || statSync(snapshot).size > 64 * 1024 * 1024)
        throw new Error('この版のバックアップ上限（図面9999件・DB64MB）を超えています。')
      const zip = new AdmZip()
      const files: { path: string; size: number; sha256: string }[] = []
      let total = 0
      const add = (name: string, path: string, expectedHash?: string): void => {
        total += statSync(path).size
        if (total > MAX_BACKUP) throw new Error('この版のバックアップ上限は展開後512MBです。')
        const data = readFileSync(path)
        const hash = sha256(data)
        if (expectedHash && hash !== expectedHash)
          throw new Error('保存図面の内容が変わっているためバックアップを中止しました。')
        files.push({ path: name, size: data.length, sha256: hash })
        zip.addFile(name, data)
      }
      add(DATABASE, snapshot)
      for (const row of rows) add(row.filePath, this.drawingPath(row.filePath), row.sha256)
      const createdAt = now()
      const manifest = Buffer.from(
        JSON.stringify(
          { application: 'sekisan-kanri', formatVersion: 1, schemaVersion: 13, createdAt, files },
          null,
          2
        )
      )
      if (total + manifest.length > MAX_BACKUP)
        throw new Error('この版のバックアップ上限は展開後512MBです。')
      zip.addFile('manifest.json', manifest)
      const archive = zip.toBuffer()
      if (archive.length > MAX_ZIP) throw new Error('この版のバックアップ上限は圧縮後256MBです。')
      writeFileSync(output, archive, { flag: 'wx' })
      renameSync(output, destination)
      this.setSetting('lastBackupAt', createdAt)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
      rmSync(output, { force: true })
    }
  }
  private unpackBackup(path: string, target: string): void {
    if (statSync(path).size > MAX_ZIP) throw new Error('バックアップのサイズが上限を超えています。')
    const zip = new AdmZip(readFileSync(path))
    const entries = zip.getEntries()
    const names = new Set(entries.map((entry) => entry.entryName))
    if (entries.length > 10001 || names.size !== entries.length)
      throw new Error('バックアップのファイル構成が不正です。')
    let total = 0
    const boundedData = (entry: AdmZip.IZipEntry, limit: number): Buffer => {
      if (entry.isDirectory || entry.header.size > limit || entry.header.flags & 1)
        throw new Error('バックアップに読み取れない項目があります。')
      const compressed = entry.getCompressedData()
      const data =
        entry.header.method === 0
          ? compressed
          : entry.header.method === 8
            ? inflateRawSync(compressed, { maxOutputLength: limit })
            : null
      if (!data || data.length !== entry.header.size || data.length > limit)
        throw new Error('バックアップが破損しています。')
      total += data.length
      if (total > MAX_BACKUP) throw new Error('バックアップの展開サイズが上限を超えています。')
      return data
    }
    const manifestEntry = zip.getEntry('manifest.json')
    if (!manifestEntry) throw new Error('積算管理のバックアップではありません。')
    const manifest = manifestSchema.parse(
      JSON.parse(boundedData(manifestEntry, 4 * 1024 * 1024).toString('utf8'))
    )
    if (
      entries.length !== manifest.files.length + 1 ||
      new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length
    )
      throw new Error('バックアップの構成が一致しません。')
    if (!manifest.files.some((f) => f.path === DATABASE))
      throw new Error('バックアップにDBがありません。')
    for (const file of manifest.files) {
      if (file.path !== DATABASE) fileSchema.parse(file.path)
      const entry = zip.getEntry(file.path)
      if (!entry || file.size !== entry.header.size)
        throw new Error('バックアップに不足したファイルがあります。')
      const data = boundedData(entry, file.path === DATABASE ? 64 * 1024 * 1024 : MAX_PDF)
      if (sha256(data) !== file.sha256)
        throw new Error('バックアップの検証に失敗しました。内容が破損しています。')
      const output = join(target, file.path)
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, data, { flag: 'wx' })
    }
    const db = new Database(join(target, DATABASE), { readonly: true, fileMustExist: true })
    try {
      // Validate schema before querying data: backups cannot introduce views or triggers.
      const schema = (database: Database.Database): unknown =>
        database
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
          )
          .all()
      const reference = new Database(':memory:')
      try {
        reference.exec(BASE_SQL)
        if (manifest.schemaVersion >= 2) reference.exec(TAKEOFF_SQL)
        if (manifest.schemaVersion >= 3) reference.exec(MASTER_SQL)
        if (manifest.schemaVersion >= 4) reference.exec(TAKEOFF_EXTRAS_SQL)
        if (manifest.schemaVersion >= 5) reference.exec(ESTIMATE_SQL)
        if (manifest.schemaVersion >= 6) reference.exec(BUSINESS_SQL)
        if (manifest.schemaVersion >= 7) reference.exec(COUNT_SQL)
        if (manifest.schemaVersion >= 8) reference.exec(PROJECT_DETAILS_SQL)
        if (manifest.schemaVersion >= 9) reference.exec(LAYOUT_SQL)
        if (manifest.schemaVersion >= 10) reference.exec(MATERIAL_STANDARD_SQL)
        if (manifest.schemaVersion >= 11) reference.exec(ROLL_MATERIAL_SQL)
        if (manifest.schemaVersion >= 12) reference.exec(ROLL_CUT_ORDER_SQL)
        if (manifest.schemaVersion >= 13) reference.exec(ROLL_SHIPPING_SQL)
        if (JSON.stringify(schema(db)) !== JSON.stringify(schema(reference)))
          throw new Error('このアプリのデータ形式と一致しません。')
      } finally {
        reference.close()
      }
      if (
        db.pragma('user_version', { simple: true }) !== manifest.schemaVersion ||
        db.pragma('integrity_check', { simple: true }) !== 'ok' ||
        (db.pragma('foreign_key_check') as unknown[]).length
      )
        throw new Error('バックアップのDBが不正です。')
      if (manifest.schemaVersion >= 2) validateTakeoffData(db)
      if (manifest.schemaVersion >= 3) validateMasterData(db)
      if (manifest.schemaVersion >= 5) validateEstimateData(db)
      if (manifest.schemaVersion >= 6) validateBusinessData(db)
      if (manifest.schemaVersion >= 7) validateCounts(db)
      if (manifest.schemaVersion >= 9) validateLayouts(db)
      const clients = db.prepare('SELECT id,name,createdAt FROM clients').all() as Client[]
      for (const row of clients) {
        idSchema.parse(row.id)
        nameSchema.parse(row.name)
        z.string().datetime().parse(row.createdAt)
      }
      const projects = db.prepare('SELECT * FROM projects').all() as Project[]
      for (const row of projects) {
        idSchema.parse(row.id)
        projectSchema.parse({
          clientId: row.clientId,
          name: row.name,
          memo: row.memo,
          assignee: row.assignee,
          status: row.status
        })
        z.string().datetime().parse(row.createdAt)
        z.string().datetime().parse(row.updatedAt)
        if (!clients.some((c) => c.id === row.clientId))
          throw new Error('案件の顧客参照が不正です。')
      }
      const drawings = db.prepare('SELECT * FROM drawings').all() as StoredDrawing[]
      for (const row of drawings) {
        idSchema.parse(row.id)
        nameSchema.parse(row.name)
        fileSchema.parse(row.filePath)
        z.number().int().positive().parse(row.pageCount)
        z.string().datetime().parse(row.createdAt)
        if (!projects.some((p) => p.id === row.projectId))
          throw new Error('図面の案件参照が不正です。')
        const file = manifest.files.find((f) => f.path === row.filePath)
        if (!file || file.sha256 !== row.sha256 || file.size !== row.byteSize)
          throw new Error('図面とDBの内容が一致しません。')
      }
      if (drawings.length + 1 !== manifest.files.length)
        throw new Error('バックアップに未登録のファイルがあります。')
      const settings = db.prepare('SELECT key,value FROM settings').all() as {
        key: string
        value: string
      }[]
      for (const setting of settings) {
        if (setting.key === 'selection') selectionSchema.parse(JSON.parse(setting.value))
        if (setting.key === 'lastBackupAt') z.string().datetime().parse(setting.value)
      }
    } finally {
      db.close()
    }
    if (manifest.schemaVersion < 13) {
      const staged = new Database(join(target, DATABASE))
      try {
        staged.pragma('foreign_keys = ON')
        initializeSchema(staged, manifest.schemaVersion)
      } finally {
        staged.close()
      }
    }
  }
  async restoreBackup(path: string): Promise<string> {
    const stage = mkdtempSync(join(this.root, 'restore-'))
    const recoveryName = `before-restore-${Date.now()}-${randomUUID()}`
    const recovery = join(this.root, 'recovery', recoveryName)
    const journal = join(this.root, 'restore-journal.json')
    try {
      this.unpackBackup(path, stage)
      mkdirSync(dirname(recovery), { recursive: true })
      // Journal is written before any rename; startup rolls incomplete restores back.
      writeFileSync(journal, JSON.stringify({ recoveryName }), { flag: 'wx', flush: true })
      this.close()
      try {
        renameSync(this.dataPath, recovery)
        renameSync(stage, this.dataPath)
        this.open()
        rmSync(journal)
      } catch (error) {
        this.close()
        if (existsSync(recovery)) {
          rmSync(this.dataPath, { recursive: true, force: true })
          renameSync(recovery, this.dataPath)
        }
        this.open()
        rmSync(journal, { force: true })
        throw error
      }
      return recovery
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  }
  private recoverInterruptedRestore(): void {
    const journal = join(this.root, 'restore-journal.json')
    if (!existsSync(journal)) return
    const { recoveryName } = z
      .object({ recoveryName: z.string().regex(/^before-restore-\d+-[0-9a-f-]{36}$/) })
      .parse(JSON.parse(readFileSync(journal, 'utf8')))
    const recovery = join(this.root, 'recovery', recoveryName)
    if (existsSync(recovery)) {
      if (existsSync(this.dataPath))
        renameSync(this.dataPath, join(this.root, `interrupted-${randomUUID()}`))
      renameSync(recovery, this.dataPath)
    }
    rmSync(journal)
  }
}
