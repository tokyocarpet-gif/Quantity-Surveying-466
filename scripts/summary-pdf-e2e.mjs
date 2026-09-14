import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { inspectPdf } from './pdf-e2e.mjs'

export async function exerciseSummaryPdf(page, application, temporary) {
  await page.getByRole('button', { name: '数量集計', exact: true }).click()
  await page.getByLabel('集計する部位').selectOption('ルーバー')
  await expect(page.getByTestId('summary-row')).toHaveCount(1)
  await page.getByRole('button', { name: '集計積算書PDF', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await expect(page.getByLabel('集計積算書PDF 1ページ', { exact: true })).toBeVisible()
  const path = join(temporary, '集計積算書.pdf')
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled()
  await expect(page.getByText(/PDFを保存しました/)).toHaveCount(0)
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const filtered = (await inspectPdf(readFileSync(path), true)).join('')
  assert.match(filtered, /集計積算書/)
  assert.match(filtered, /W100×H2400/)
  assert.match(filtered, /2,000/)
  assert.doesNotMatch(filtered, /67,500/)
  assert.match(filtered, /自社情報テスト株式会社/)
  assert.match(filtered, /山田 太郎/)
  writeFileSync('test-results/summary-filtered.pdf', readFileSync(path))
  await page.screenshot({ path: 'test-results/27-summary-pdf-preview.png' })
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByLabel('集計する部位').selectOption('')
  await expect(page.getByTestId('summary-row')).toHaveCount(5)
  const context = await page.evaluate(async () => {
    const w = await window.sekisan.workspace()
    return { projectId: w.data.projects[0].id, drawingId: w.data.drawings[0].id }
  })
  let baseline
  for (const view of ['room-finish', 'finish', 'room', 'drawing']) {
    const result = await page.evaluate(
      async ({ projectId, view }) => {
        const report = await window.sekisan.readSummary({ projectId, view })
        if (!report.ok) throw new Error(report.error)
        const request = { request: report.data.request, fingerprint: report.data.fingerprint }
        const preview = await window.sekisan.previewSummaryPdf(request)
        return { report: report.data, request, preview }
      },
      { projectId: context.projectId, view }
    )
    assert.equal(result.preview.ok, true, result.preview.error)
    const bytes = Buffer.from(result.preview.data.bytes),
      pages = await inspectPdf(bytes, true)
    assert.match(pages.join(''), /69,500/)
    assert.match(pages.join(''), /未確定/)
    assert.match(pages.join(''), /82\.2/)
    assert.match(pages.join(''), /固定/)
    assert.doesNotMatch(pages.join(''), /消費税|税込/)
    writeFileSync(`test-results/summary-${view}.pdf`, bytes)
    await page.evaluate((token) => window.sekisan.closePdfPreview(token), result.preview.data.token)
    if (view === 'room-finish') baseline = result.request
  }
  // Add test-only groups to exercise pagination and stale-report rejection.
  const added = await page.evaluate(async ({ drawingId }) => {
    const address = { drawingId, pageNumber: 2 }
    let state = (await window.sekisan.readTakeoff(address)).data
    const { id, drawingId: ignored, pageNumber, ...input } = state.counts[0]
    const ids = []
    for (let i = 0; i < 60; i++) {
      const id = crypto.randomUUID()
      const result = await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: {
          kind: 'count',
          id,
          input: {
            ...input,
            name: `積算明細${String(i + 1).padStart(3, '0')}`,
            specification: i === 0 ? '長い仕様と規格の折り返し確認'.repeat(12) : 'W100×H2400',
            category: i % 2 ? 'ルーバー' : '柱型'
          }
        }
      })
      if (!result.ok) throw new Error(result.error)
      state = result.data
      ids.push(id)
    }
    return { address, ids }
  }, context)
  const stale = await page.evaluate(
    (request) => window.sekisan.previewSummaryPdf(request),
    baseline
  )
  assert.equal(stale.ok, false)
  assert.match(stale.error, /再集計/)
  await page.getByRole('button', { name: '再集計', exact: true }).click()
  await expect(page.getByTestId('summary-row')).toHaveCount(65)
  await page.getByRole('button', { name: '集計積算書PDF', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await page.getByLabel('集計積算書PDFのページ', { exact: true }).selectOption('2')
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: 'test-results/28-summary-pdf-page2.png' })
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const multiple = readFileSync(path),
    pages = await inspectPdf(multiple, true),
    all = pages.join('')
  assert.ok(pages.length >= 3)
  for (let i = 1; i <= 60; i++)
    assert.equal(all.split(`積算明細${String(i).padStart(3, '0')}`).length - 1, 1)
  for (const text of pages.filter((text) => text.includes('積算明細')))
    assert.match(text, /正味数量/)
  writeFileSync('test-results/summary-multipage.pdf', multiple)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  const snapshot = await page.evaluate(async (request) => {
    const report = await window.sekisan.readSummary(request)
    return window.sekisan.previewSummaryPdf({
      request: report.data.request,
      fingerprint: report.data.fingerprint
    })
  }, baseline.request)
  assert.equal(snapshot.ok, true)
  await page.evaluate(async ({ address, ids }) => {
    let state = (await window.sekisan.readTakeoff(address)).data
    for (const id of ids) {
      const result = await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: { kind: 'deleteCount', id }
      })
      if (!result.ok) throw new Error(result.error)
      state = result.data
    }
  }, added)
  const saved = await page.evaluate(
    (token) => window.sekisan.savePdfPreview(token),
    snapshot.data.token
  )
  assert.equal(saved.ok, true, saved.error)
  assert.deepEqual(readFileSync(path), Buffer.from(snapshot.data.bytes))
  await page.evaluate((token) => window.sekisan.closePdfPreview(token), snapshot.data.token)
  const empty = await page.evaluate(async (projectId) => {
    const report = await window.sekisan.readSummary({ projectId, query: '存在しない材料XYZ' })
    return window.sekisan.previewSummaryPdf({
      request: report.data.request,
      fingerprint: report.data.fingerprint
    })
  }, context.projectId)
  assert.equal(empty.ok, false)
  assert.match(empty.error, /明細がありません/)
  await page.getByRole('button', { name: '物件の図面一覧に戻る', exact: true }).click()
  console.log(
    `PASS 集計PDF: 4表示 / 絞り込み / 65行${pages.length}ページ / 控除・固定・個数・金額 / 最新照合 / プレビューと保存の一致`
  )
}
