import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectPdf } from './pdf-e2e.mjs'

export async function exerciseLayoutPdf(page, application, temporary, roomId) {
  const before = await page.evaluate(
    async (id) => (await window.sekisan.readLayout(id)).data,
    roomId
  )
  await application.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('layout:pdf-preview')
    globalThis.restoreLayoutPdfHandler = () =>
      ipcMain._invokeHandlers.set('layout:pdf-preview', original)
    ipcMain._invokeHandlers.set('layout:pdf-preview', async (event, input) => {
      const result = await original(event, input)
      if (result.ok) {
        globalThis.layoutPdfInput = input
        globalThis.layoutPdfBytes = result.data.bytes
      }
      return result
    })
  })
  try {
    await page.getByRole('button', { name: 'PDFプレビュー・保存', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: '割り付けPDFプレビュー', exact: true })
    ).toBeVisible()
    await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
      timeout: 30000
    })
    await expect(page.getByLabel('割り付けPDF 1ページ', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/40-layout-pdf-drawing.png' })
    const path = join(temporary, '割り付け.pdf')
    writeFileSync(path, 'existing')
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: path })
    }, path)
    await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
    await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled()
    assert.equal(readFileSync(path, 'utf8'), 'existing')
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, path)
    await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
    await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
    const bytes = readFileSync(path)
    const pages = await inspectPdf(bytes, true)
    assert.equal(pages.length, 2)
    assert.match(pages[0], /割り付け図/)
    assert.match(pages[0], /未保存/)
    assert.match(pages[1], /フリーカット/)
    assert.match(pages[1], /最大出荷 W 3,640 mm/)
    assert.match(pages[1], /30,000 mm/)
    assert.match(pages[1], /2,000 mm/)
    assert.match(pages[1], /8,100 mm/)
    assert.match(pages[1], /48.6/)
    const previewBytes = await application.evaluate(() => Array.from(globalThis.layoutPdfBytes))
    const hash = createHash('sha256').update(Buffer.from(previewBytes)).digest('hex')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
    writeFileSync('test-results/layout-free-cut.pdf', bytes)
    await page.getByLabel('割り付けPDFのページ', { exact: true }).selectOption('2')
    await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false')
    await page.screenshot({ path: 'test-results/41-layout-pdf-materials.png' })
    const input = await application.evaluate(() => globalThis.layoutPdfInput)
    const stale = await page.evaluate(
      async (input) => window.sekisan.previewLayoutPdf({ ...input, expectedRevision: 999 }),
      input
    )
    assert.equal(stale.ok, false)
    const changed = await page.evaluate(
      async (input) => window.sekisan.previewLayoutPdf({ ...input, sourceKey: 'stale' }),
      input
    )
    assert.equal(changed.ok, false)
    await page.getByRole('button', { name: '閉じる', exact: true }).click()
    assert.deepEqual(
      await page.evaluate(async (id) => (await window.sekisan.readLayout(id)).data, roomId),
      before
    )
    console.log(
      'PASS 割付PDF: 図面と使用材料2ページ / 最大出荷・フリーカット数量 / 未保存配置 / 保存・キャンセル / プレビュー同一バイト / 古い配置拒否 / 元データ保持'
    )
  } finally {
    await application.evaluate(() => {
      globalThis.restoreLayoutPdfHandler()
      delete globalThis.layoutPdfBytes
      delete globalThis.layoutPdfInput
      delete globalThis.restoreLayoutPdfHandler
    })
  }
}
