import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-large-pdf-'))
const pdfPath = join(temporary, '割り付け範囲.pdf')
const pdf = await PDFDocument.create()
pdf.addPage([842, 595])
writeFileSync(pdfPath, await pdf.save())
const env = { ...process.env, SEKISAN_DATA_DIR: join(temporary, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
mkdirSync('test-results', { recursive: true })
let application
try {
  application = await electron.launch({ args: ['.'], cwd: resolve('.'), env })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: '顧客を追加', exact: true })).toBeVisible()
  // Dense drawing pixels produce a valid PNG larger than Chromium's navigation URL limit.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2000
    canvas.height = 1400
    const ctx = canvas.getContext('2d'),
      pixels = ctx.createImageData(canvas.width, canvas.height)
    let seed = 12345
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      const tone = 160 + ((seed >>> 16) % 96)
      pixels.data[i] = tone
      pixels.data[i + 1] = tone
      pixels.data[i + 2] = tone
      pixels.data[i + 3] = 255
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const background = await pdf.embedPng(Buffer.from(png, 'base64'))
  pdf.getPages()[0].drawImage(background, { x: 0, y: 0, width: 842, height: 595 })
  writeFileSync(pdfPath, await pdf.save())

  await page.getByRole('button', { name: '顧客を追加', exact: true }).click()
  await page.getByRole('textbox', { name: '顧客名' }).fill('囲い直しテスト')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '案件を作成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '案件名' }).fill('床仕上げ工事')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, pdfPath)
  await page.getByRole('button', { name: '図面を取り込む', exact: true }).click()
  await expect(page.getByRole('button', { name: '割り付け範囲.pdf', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const check = (r) => {
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
    const w = check(await window.sekisan.workspace())
    const address = { drawingId: w.drawings[0].id, pageNumber: 1 }
    const polygon = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 }
    ]
    let state = check(
      await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: 0,
        change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }
      })
    )
    state = check(
      await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: {
          kind: 'room',
          id: crypto.randomUUID(),
          input: {
            name: '会議室',
            color: '#327e6d',
            heightMm: 2400,
            polygon,
            enabledCategories: ['floor'],
            sleeveWalls: [],
            finishes: Object.fromEntries(
              ['wall', 'floor', 'ceiling', 'baseboard'].map((c) => [
                c,
                { name: '', unitPrice: null }
              ])
            )
          }
        }
      })
    )
  })

  const snapshot = () =>
    page.evaluate(async () => {
      const w = (await window.sekisan.workspace()).data
      return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
    })
  const before = await snapshot(),
    roomId = before.rooms[0].id
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  await page.getByLabel('割付の材料の種類', { exact: true }).selectOption('carpet')
  await page.getByLabel('最大出荷W（mm）', { exact: true }).fill('3640')
  await page.getByLabel('割付W（mm）', { exact: true }).fill('3640')
  await page.getByLabel('最大出荷L（mm・任意）', { exact: true }).fill('10000')
  await page.getByLabel('カーペットの出荷方法', { exact: true }).selectOption('free')
  await application.evaluate(({ ipcMain, app }) => {
    globalThis.printUrls = []
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('did-finish-load', () => {
        const url = win.webContents.getURL()
        if (url.startsWith('file:') && url.endsWith('/report.html')) globalThis.printUrls.push(url)
      })
    })
    const original = ipcMain._invokeHandlers.get('layout:pdf-preview')
    ipcMain._invokeHandlers.set('layout:pdf-preview', async (event, input) => {
      globalThis.diagramSize = input.diagram.length
      return original(event, input)
    })
  })
  await page.getByRole('button', { name: 'PDFプレビュー・保存', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const message = await page.getByRole('dialog').getByRole('alert').allTextContents()
  assert.equal(message.length, 0, message.join('').slice(0, 100))
  const bytes = await application.evaluate(() => globalThis.diagramSize)
  assert.ok(bytes > 2 * 1024 * 1024, `Test image too small: ${bytes}`)
  await expect(page.getByLabel('割り付けPDF 1ページ', { exact: true })).toBeVisible()
  const pdfOut = join(temporary, 'large-carpet.pdf')
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, pdfOut)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(pdfOut), true)
  assert.equal(pages.length, 2)
  assert.match(pages[0], /割り付け図/)
  assert.match(pages[1], /ロールカーペット/)
  assert.match(pages[1], /フリーカット/)
  writeFileSync('test-results/large-carpet.pdf', readFileSync(pdfOut))
  await page.getByLabel('割り付けPDFのページ', { exact: true }).selectOption('2')
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: 'test-results/large-carpet-preview.png' })
  const printUrls = await application.evaluate(() => globalThis.printUrls)
  assert.equal(printUrls.length, 1)
  for (const url of printUrls)
    assert.equal(existsSync(fileURLToPath(url)), false, 'Temporary report must be removed')
  assert.deepEqual(await snapshot(), before)
  console.log(
    `PASS large carpet PDF: ${bytes} image characters, preview, 2 A4 pages, saved file, original quantities unchanged`
  )
} catch (error) {
  console.error(String(error).slice(0, 1200))
  process.exitCode = 1
} finally {
  await application
    ?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
    .catch(() => {})
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
