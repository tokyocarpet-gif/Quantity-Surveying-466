import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
const root = mkdtempSync(join(tmpdir(), 'estimate-modern-')),
  env = { ...process.env, SEKISAN_DATA_DIR: join(root, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const seed = spawnSync(
  electronPath,
  ['--import', 'tsx', 'scripts/estimate-modern-fixture.ts', root],
  { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }
)
if (seed.status !== 0) throw new Error(seed.stderr)
const fixture = JSON.parse(readFileSync(join(root, 'fixture.json'), 'utf8')),
  app = await electron.launch({ args: ['.'], env }),
  page = await app.firstWindow(),
  errors = []
page.on('pageerror', (e) => errors.push(e.message))
const cell = (row, key) => page.locator(`button[data-cell-scope="${row}"][data-cell-key="${key}"]`),
  input = () => page.locator('.paper-input')
try {
  await page.evaluate((id) => {
    location.hash = `/estimate/${id}`
  }, fixture.id)
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  const before = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  const free = page.getByTestId('estimate-cover-extra').first()
  await free.locator('td').nth(6).click()
  const dialog = page.getByRole('dialog', { name: '表紙の行を編集' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('表紙の行の品名').fill('キャンセルする名称')
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(free).not.toContainText('キャンセルする名称')
  await page.getByRole('button', { name: '表紙だけで入力', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-summary')).toHaveCount(0)
  await expect(page.getByTestId('estimate-total')).toHaveText('0 円')
  await free.locator('td').nth(6).click()
  await dialog.getByLabel('表紙の行の品名').fill('内装工事')
  await dialog.getByLabel('表紙の行の仕様・規格・寸法').fill('クロス貼替')
  await dialog.getByLabel('表紙の行の数量').fill('2.5')
  await dialog.getByLabel('表紙の行の単価').fill('1000')
  await dialog.getByRole('button', { name: '反映', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('2,500 円')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('0 円')
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('2,500 円')
  // Every blank row is editable, including the final (13th) row, and cancellation adds nothing.
  const blanks = page.getByRole('button', { name: '空行の品名を入力', exact: true })
  await expect(blanks).toHaveCount(12)
  await blanks.last().click()
  const add = page.getByRole('dialog', { name: '表紙の行を追加' })
  await expect(add).toBeVisible()
  await add.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-extra')).toHaveCount(1)
  await blanks.last().click()
  await add.getByLabel('表紙の行の品名').fill('末尾運搬費')
  await add.getByLabel('表紙の行の単価').fill('1500')
  await add.getByRole('button', { name: '反映して次の行', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-extra')).toHaveCount(13)
  await expect(page.getByTestId('estimate-cover-extra').last()).toContainText('末尾運搬費')
  await add.getByLabel('表紙の行の品名').fill('次ページ作業')
  await add.getByLabel('表紙の行の単価').fill('500')
  await add.getByRole('button', { name: '反映', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-extra')).toHaveCount(1)
  await expect(page.getByTestId('estimate-cover-extra')).toContainText('次ページ作業')
  await expect(page.getByTestId('estimate-total')).toHaveText('4,500 円')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  const saved = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  assert.deepEqual(saved.body.lines, before.body.lines)
  assert.equal(saved.body.coverExtras.length, 14)
  assert.equal(saved.body.presentation.outputDetail, false)
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('estimate-total')).toHaveText('4,500 円')
  await page.screenshot({ path: 'test-results/estimate-cover-only.png' })
  await page.getByRole('button', { name: 'PDFを作成', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const file = join(root, 'cover-only.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(file), true)
  assert.equal(pages.length, 2)
  assert.match(pages[0], /末尾運搬費/)
  assert.match(pages[1], /次ページ作業/)
  assert.ok(pages.every((p) => p.includes('4,500')))
  writeFileSync('test-results/estimate-cover-only.pdf', readFileSync(file))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '全明細の内訳書編集に戻す', exact: true }).click()
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-summary')).toHaveCount(2)
  await expect(page.getByTestId('estimate-total')).toHaveText('64,500 円')
  assert.deepEqual(errors, [])
  console.log(
    'PASS 表紙全行ポップアップ・キャンセル・13行目入力・次ページ・表紙のみ計算・Undo/Redo・保存再表示・PDF・元内訳保持'
  )
} catch (e) {
  await page.screenshot({ path: 'test-results/estimate-cover-popup-failure.png' }).catch(() => {})
  throw e
} finally {
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
    .catch(() => {})
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
