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
  assert.match(before.body.number, /^\d{4}-0001$/)
  await expect(page.getByTestId('estimate-cover-extra')).toHaveCount(1)
  const sequence = await page
    .locator('.paper-items tbody tr')
    .evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute('data-testid')))
  assert.deepEqual(sequence, [
    'estimate-cover-summary',
    'estimate-cover-summary',
    'estimate-cover-extra'
  ])
  const numberBox = await page.getByRole('button', { name: '見積番号', exact: true }).boundingBox()
  const paperBox = await page.locator('.estimate-paper').boundingBox()
  assert.ok(numberBox.x > paperBox.x + paperBox.width / 2)
  const set = async (label, value) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
    await page.locator('.estimate-heading h1').click()
  }
  await page.getByRole('button', { name: '表紙の大項目1の名称', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: '表紙の大項目1の名称', exact: true })
  ).toBeVisible()
  await page
    .getByRole('textbox', { name: '表紙の大項目1の名称', exact: true })
    .fill('販売センター仕上工事')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('textbox', { name: '表紙の大項目1の仕様', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('textbox', { name: '表紙の大項目2の仕様', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await set('表紙の自由行1の名称', '現場管理費')
  await set('表紙の自由行1の数量', '2')
  await set('表紙の自由行1の単価', '1500')
  await expect(page.getByTestId('estimate-total')).toHaveText('63,000 円')
  await page.getByRole('button', { name: '表紙に行を追加', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: '表紙の自由行2の名称', exact: true })
  ).toBeFocused()
  await page.getByRole('textbox', { name: '表紙の自由行2の名称', exact: true }).fill('運搬費')
  await page.locator('.estimate-heading h1').click()
  await set('表紙の自由行2の単価', '2000')
  await expect(page.getByTestId('estimate-total')).toHaveText('65,000 円')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('63,000 円')
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('65,000 円')
  await page.getByRole('button', { name: '表紙の自由行2を削除', exact: true }).click()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-extra')).toHaveCount(2)
  await page.getByRole('button', { name: '表紙の自由行2を削除', exact: true }).click()
  await page.getByRole('button', { name: 'この明細を削除', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('63,000 円')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('65,000 円')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  const saved = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  assert.deepEqual(saved.body.lines, before.body.lines)
  assert.equal(saved.body.coverExtras.length, 2)
  assert.equal(saved.body.expenses, 0)
  assert.equal(saved.body.number, before.body.number)
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('65,000 円')
  await page.screenshot({ path: 'test-results/estimate-free-cover.png' })
  await page.getByRole('button', { name: 'PDFを作成', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const file = join(root, 'free-cover.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(file), true)
  assert.match(pages[0], /現場管理費/)
  assert.match(pages[0], /運搬費/)
  assert.match(pages[0], /65,000/)
  assert.doesNotMatch(pages[0], /諸経費/)
  assert.match(pages[0], new RegExp(before.body.number))
  writeFileSync('test-results/estimate-free-cover.pdf', readFileSync(file))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  // Remove all free rows: an explicitly empty list must not resurrect legacy expenses.
  for (let i = 2; i >= 1; i--) {
    await page.getByRole('button', { name: `表紙の自由行${i}を削除`, exact: true }).click()
    await page.getByRole('button', { name: 'この明細を削除', exact: true }).click()
  }
  await expect(page.getByTestId('estimate-cover-extra')).toHaveCount(0)
  await expect(page.getByTestId('estimate-total')).toHaveText('60,000 円')
  const takeoff = await page.evaluate(
    async (a) => (await window.sekisan.readTakeoff(a)).data,
    fixture.address
  )
  assert.deepEqual(takeoff, fixture.takeoff)
  assert.deepEqual(errors, [])
  console.log(
    'PASS 表紙セル編集・Tab/Enter・諸経費直下配置・自由行追加/削除確認・Undo/Redo・保存再表示・金額・年別連番/右上配置・PDF'
  )
} catch (e) {
  await page.screenshot({ path: 'test-results/estimate-free-cover-failure.png' })
  throw e
} finally {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
