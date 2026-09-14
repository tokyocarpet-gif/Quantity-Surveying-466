import { layoutPrintHtml, layoutPdfName } from './layout-print'
import { summaryPrintHtml, summaryPdfName } from './summary-print'
import { randomUUID } from 'node:crypto'
import { estimatePdfSchema } from '../shared/estimate'
import { estimatePdfName } from './estimate-print'
import { renderEstimatePdf, renderReportPdf } from './estimate-pdf'
import { savePdfFile, saveReportFile } from './export-file'
import { renderEstimateXlsx, estimateXlsxName } from './estimate-xlsx'
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import { Storage } from './storage'
import { summaryExportSchema } from '../shared/summary'
import { idSchema } from '../shared/validation'
import { ZodError } from 'zod'
import type { Result } from '../shared/api'

const here = dirname(fileURLToPath(import.meta.url))
app.setName('積算管理')
const isDev = !app.isPackaged
const customRoot = isDev ? process.env.SEKISAN_DATA_DIR : undefined
const userData = customRoot
  ? resolve(customRoot)
  : join(app.getPath('appData'), isDev ? 'sekisan-kanri-dev' : 'sekisan-kanri')
app.setPath('userData', userData)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sekisan',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

let storage: Storage
let window: BrowserWindow | null = null
let quitting = false
const rendererUrl = isDev ? process.env.ELECTRON_RENDERER_URL : undefined

function registerIpc(): void {
  let pdfPreview: { token: string; bytes: Buffer; name: string } | null = null
  const handle = (channel: string, action: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
      const senderUrl = event.senderFrame?.url
      const trusted = rendererUrl
        ? senderUrl?.split('#')[0] === `${rendererUrl.replace(/\/$/, '')}/`
        : senderUrl?.split('#')[0] === 'sekisan://app/index.html'
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !trusted
      )
        return { ok: false, error: '許可されていない操作です。' }
      try {
        return { ok: true, data: await storage.run(() => action(...args)) }
      } catch (error) {
        console.error(channel, error)
        const code = (error as NodeJS.ErrnoException)?.code
        const errorMessage =
          error instanceof ZodError
            ? (error.issues[0]?.message ?? '入力内容を確認してください。')
            : code === 'ENOSPC'
              ? '空き容量が不足しています。編集内容を確認し、空き容量を確保して再試行してください。'
              : code === 'EACCES' || code === 'EPERM'
                ? 'ファイルにアクセスできません。保存先の権限や他のアプリで開いていないか確認してください。'
                : error instanceof Error
                  ? error.message
                  : '処理に失敗しました。もう一度お試しください。'
        return { ok: false, error: errorMessage }
      }
    })
  }
  handle('layout:pdf-preview', async (raw) => {
    const report = storage.layoutReport(raw)
    pdfPreview = null
    const bytes = await renderReportPdf(layoutPrintHtml(report), {
      footer: '割り付け・使用材料',
      landscape: true
    })
    pdfPreview = { token: randomUUID(), bytes, name: layoutPdfName(report) }
    return { token: pdfPreview.token, bytes }
  })
  handle('summary:pdf-preview', async (raw) => {
    const input = summaryExportSchema.parse(raw)
    const report = storage.readSummary(input.request)
    if (report.fingerprint !== input.fingerprint)
      throw new Error('集計内容が更新されています。閉じて「再集計」してからPDFを作成してください。')
    if (!report.rows.length) throw new Error('出力する集計明細がありません。')
    const company = storage.readCompany()
    const assignee =
      storage.workspace().projects.find((p) => p.id === input.request.projectId)?.assignee ?? ''
    pdfPreview = null
    const bytes = await renderReportPdf(summaryPrintHtml(report, company, assignee), {
      footer: '集計積算書',
      landscape: true
    })
    pdfPreview = { token: randomUUID(), bytes, name: summaryPdfName(report) }
    return { token: pdfPreview.token, bytes }
  })
  handle('estimate:pdf-preview', async (raw) => {
    const request = estimatePdfSchema.parse(raw)
    const doc = storage.readEstimate(request)
    pdfPreview = null
    const bytes = await renderEstimatePdf(doc)
    pdfPreview = { token: randomUUID(), bytes, name: estimatePdfName(doc) }
    return { token: pdfPreview.token, bytes }
  })
  handle('estimate:xlsx-save', async (raw) => {
    const request = estimatePdfSchema.parse(raw)
    const doc = storage.readEstimate(request)
    const bytes = renderEstimateXlsx(doc)
    const selected = await dialog.showSaveDialog(window!, {
      title: 'Excel帳票を保存',
      defaultPath: estimateXlsxName(doc),
      filters: [{ name: 'Excelブック', extensions: ['xlsx'] }]
    })
    if (selected.canceled || !selected.filePath) return null
    return saveReportFile(selected.filePath, bytes, storage.root, '.xlsx')
  })
  handle('pdf:save', async (raw) => {
    const token = idSchema.parse(raw)
    const preview = pdfPreview
    if (!preview || token !== preview.token)
      throw new Error('PDFプレビューを開き直してから保存してください。')
    const selected = await dialog.showSaveDialog(window!, {
      title: 'PDFを保存',
      defaultPath: preview.name,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (selected.canceled || !selected.filePath) return null
    return savePdfFile(selected.filePath, preview.bytes, storage.root)
  })
  handle('pdf:close', (raw) => {
    if (idSchema.parse(raw) === pdfPreview?.token) pdfPreview = null
  })
  handle('company:read', () => storage.readCompany())
  handle('company:save', (input) => storage.saveCompany(input))
  handle('catalog:add-option', (input) => storage.addCatalogOption(input))
  handle('estimate:create', (input) => storage.createEstimate(input))
  handle('estimate:read', (input) => storage.readEstimate(input))
  handle('estimate:list', (input) => storage.listEstimates(input))
  handle('estimate:save', (input) => storage.saveEstimate(input))
  handle('summary:edit', (input) => storage.editSummary(input))
  handle('summary:read', (input) => storage.readSummary(input))
  handle('summary:export', async (raw) => {
    const input = summaryExportSchema.parse(raw)
    const report = storage.readSummary(input.request)
    if (report.fingerprint !== input.fingerprint)
      throw new Error('集計内容が更新されています。再集計してから出力してください。')
    const result = await dialog.showSaveDialog(window!, {
      title: '表示中の集計をCSVに保存',
      defaultPath: '数量集計.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return null
    return storage.exportSummary(input, result.filePath)
  })
  handle('workspace:read', () => storage.workspace())
  handle('layout:read', (id) => storage.readLayout(id))
  handle('layout:save', (input) => storage.saveLayout(input))
  handle('materials:read', (id) => storage.readMaterials(id))
  handle('materials:change', (input) => storage.changeMaterials(input))
  handle('takeoff:read', (address) => storage.readTakeoff(address))
  handle('takeoff:preview', (input) => storage.previewTakeoff(input))
  handle('takeoff:apply', (input) => storage.applyTakeoff(input))
  handle('selection:save', (value) => storage.saveSelection(value))
  handle('client:create', (name) => storage.createClient(name))
  handle('client:rename', (id, name) => storage.renameClient(id, name))
  handle('project:create', (input) => storage.createProject(input))
  handle('project:update', (id, input) => storage.updateProject(id, input))
  handle('drawing:rename', (id, name) => storage.renameDrawing(id, name))
  handle('drawing:read', (id) => storage.readPdf(idSchema.parse(id)))
  for (const [channel, kind] of [
    ['client:delete', 'clients'],
    ['project:delete', 'projects'],
    ['drawing:delete', 'drawings']
  ] as const) {
    handle(channel, async (id) => {
      const impact = storage.deleteImpact(kind, idSchema.parse(id))
      const answer = await dialog.showMessageBox(window!, {
        type: 'warning',
        title: '削除の確認',
        message: `「${impact.name}」を削除しますか？`,
        detail: `関連する案件 ${impact.projects}件・図面 ${impact.drawings}件と部屋に保存した割り付けも削除されます。${kind === 'drawings' ? '保存済みの見積は保持します。' : '保存済みの見積とすべての版も削除されます。'}この操作は取り消せません。必要なデータは先にバックアップしてください。`,
        buttons: ['キャンセル', '削除する'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (answer.response !== 1) return false
      storage.delete(kind, id)
      return true
    })
  }
  handle('drawing:import', async (projectId) => {
    idSchema.parse(projectId)
    const result = await dialog.showOpenDialog(window!, {
      title: '図面PDFを取り込む',
      filters: [{ name: 'PDF図面', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return null
    return storage.importPdfs(projectId, result.filePaths)
  })
  handle('backup:create', async () => {
    const result = await dialog.showSaveDialog(window!, {
      title: 'バックアップを保存',
      defaultPath: join(
        app.getPath('documents'),
        `積算管理_${new Date().toISOString().slice(0, 10)}.sekisan-backup`
      ),
      filters: [{ name: '積算管理バックアップ', extensions: ['sekisan-backup'] }]
    })
    if (result.canceled || !result.filePath) return null
    await storage.createBackup(result.filePath)
    return result.filePath
  })
  handle('backup:restore', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: '復元するバックアップを選択',
      filters: [{ name: '積算管理バックアップ', extensions: ['sekisan-backup'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    const answer = await dialog.showMessageBox(window!, {
      type: 'warning',
      title: 'バックアップを復元',
      message: '現在のデータをバックアップの内容に置き換えますか？',
      detail:
        '顧客・案件・図面・設定をまとめて復元します。現在のデータは復元前に別フォルダーへ退避されます。',
      buttons: ['キャンセル', '検証して復元する'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (answer.response !== 1) return null
    return storage.restoreBackup(result.filePaths[0])
  })
  handle('data:open', async () => {
    const error = await shell.openPath(storage.root)
    if (error) throw new Error(error)
  })
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    title: '積算管理',
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      void storage.run(() => {
        quitting = true
        app.quit()
      })
    }
  })
  window.on('closed', () => {
    window = null
  })
  window.once('ready-to-show', () => window?.show())
  if (rendererUrl) await window.loadURL(rendererUrl)
  else await window.loadURL('sekisan://app/index.html')
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('jp.tokyocarpet.sekisan-kanri')
      storage = new Storage(userData)
      const rendererRoot = resolve(here, '../renderer')
      protocol.handle('sekisan', (request) => {
        const url = new URL(request.url)
        const path = resolve(rendererRoot, '.' + decodeURIComponent(url.pathname))
        if (url.host !== 'app' || !path.startsWith(rendererRoot + sep))
          return new Response('Not found', { status: 404 })
        return net.fetch(pathToFileURL(path).href)
      })
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false)
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const scripts = rendererUrl ? "'self' 'unsafe-inline'" : "'self'"
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'${rendererUrl ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; object-src 'none'; base-uri 'none'; frame-src 'none'`
            ]
          }
        })
      })
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin'
            ? [
                {
                  label: '積算管理',
                  submenu: [
                    { role: 'about' as const },
                    { type: 'separator' as const },
                    { role: 'quit' as const }
                  ]
                }
              ]
            : []),
          {
            label: '編集',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' }
            ]
          },
          {
            label: '表示',
            submenu: [
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              ...(isDev ? [{ role: 'toggleDevTools' as const }] : [])
            ]
          }
        ])
      )
      registerIpc()
      await createWindow()
    })
    .catch((error) => {
      console.error(error)
      dialog.showErrorBox(
        '積算管理を起動できません',
        error instanceof Error ? error.message : String(error)
      )
      app.exit(1)
    })
  app.on('before-quit', (event) => {
    if (storage && !quitting) {
      event.preventDefault()
      void storage.run(() => {
        quitting = true
        app.quit()
      })
    }
  })
  app.on('will-quit', () => storage?.close())
  app.on('window-all-closed', () => app.quit())
}
