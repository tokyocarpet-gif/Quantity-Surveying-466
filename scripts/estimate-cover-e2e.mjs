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
  await expect(page.getByTestId('estimate-cover-summary')).toHaveCount(2)
  await expect(page.getByTestId('estimate-cover-summary').first()).toContainText('50,000')
  const before = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  // Whole-row clicks and field buttons open the same popup. Cancel preserves the saved row.
  await page.getByTestId('estimate-cover-summary').first().locator('td').nth(6).click()
  const popup = page.getByRole('dialog', { name: '表紙の大項目を編集' })
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('50,000 円')
  await page.getByLabel('表紙の大項目名', { exact: true }).fill('キャンセル確認')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByRole('button', { name: '表紙の大項目1の名称', exact: true })).toHaveText(
    '販売センター'
  )
  await page.getByRole('button', { name: '表紙の大項目1の名称', exact: true }).click()
  await page.getByLabel('表紙の大項目名', { exact: true }).fill('内装仕上工事一式')
  await page.getByLabel('表紙の大項目名', { exact: true }).press('Enter')
  await expect(page.getByLabel('表紙の仕様・規格・寸法', { exact: true })).toBeFocused()
  await expect(popup).toBeVisible()
  await page.getByLabel('表紙の仕様・規格・寸法', { exact: true }).fill('天井・壁・床仕上げ')
  await page.getByLabel('表紙の仕様・規格・寸法', { exact: true }).press('Enter')
  await expect(page.getByLabel('表紙の備考', { exact: true })).toBeFocused()
  await page.getByLabel('表紙の備考', { exact: true }).fill('夜間施工')
  await page.screenshot({ path: 'test-results/estimate-cover-dialog.png' })
  await page.getByRole('button', { name: '反映して次の行', exact: true }).click()
  await expect(page.getByLabel('表紙の大項目名', { exact: true })).toHaveValue('モデルルーム')
  await expect(page.getByRole('button', { name: '反映して次の行', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(page.getByRole('button', { name: '表紙の大項目1の備考', exact: true })).toHaveText(
    ''
  )
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  await expect(page.getByRole('button', { name: '表紙の大項目1の備考', exact: true })).toHaveText(
    '夜間施工'
  )
  await page.getByRole('button', { name: '表紙の大項目1の仕様', exact: true }).click()
  await expect(page.getByLabel('表紙の仕様・規格・寸法', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await page.getByRole('button', { name: 'セル編集に切り替え', exact: true }).click()
  await page.getByRole('button', { name: '表紙の大項目1の仕様', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: '表紙の大項目1の仕様', exact: true })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '行をまとめて編集', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('60,000 円')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  const after = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  assert.deepEqual(after.body.lines, before.body.lines)
  assert.deepEqual(after.totals, before.totals)
  assert.equal(after.body.coverSummaries[0].note, '夜間施工')
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.getByRole('button', { name: '表紙の大項目1の名称', exact: true })).toHaveText(
    '内装仕上工事一式'
  )
  await page.screenshot({ path: 'test-results/estimate-cover-edit.png' })
  await page.getByRole('button', { name: 'PDFを作成', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const file = join(root, 'cover.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(file), true)
  assert.match(pages[0], /内装仕上工事一式/)
  assert.match(pages[0], /天井・壁・床仕上げ/)
  assert.match(pages[0], /夜間施工/)
  assert.match(pages[0], /50,000/)
  assert.match(pages[0], /10,000/)
  assert.match(pages.slice(1).join(''), /販売センター/)
  assert.doesNotMatch(pages.slice(1).join(''), /夜間施工/)
  writeFileSync('test-results/estimate-cover.pdf', readFileSync(file))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  // Changing detail amounts updates the summary while preserving its edited text.
  const changed = await page.evaluate(
    async (d) =>
      window.sekisan.saveEstimate({
        id: d.id,
        expectedRevision: d.revision,
        body: {
          ...d.body,
          lines: d.body.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 2000 } : l))
        }
      }),
    after
  )
  assert.equal(changed.ok, true, changed.error)
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.getByTestId('estimate-cover-summary').first()).toContainText('52,000')
  await expect(page.getByRole('button', { name: '表紙の大項目1の名称', exact: true })).toHaveText(
    '内装仕上工事一式'
  )
  // More than 12 sections continue onto another cover without dropping amounts or rows.
  const large = await page.evaluate(async (d) => {
    const lines = d.body.lines.slice(0, 13).map((l, i) => ({
      ...l,
      section: `大項目${String(i + 1).padStart(2, '0')}`,
      quantity: '2.0',
      unitPrice: 1000
    }))
    const body = {
      ...d.body,
      coverSummaries: undefined,
      lines,
      detailSheets: lines.map((l) => ({
        id: crypto.randomUUID(),
        section: l.section,
        lineIds: [l.id]
      }))
    }
    return window.sekisan.saveEstimate({ id: d.id, expectedRevision: d.revision, body })
  }, changed.data)
  assert.equal(large.ok, true, large.error)
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await page.getByLabel('編集する表紙ページ').selectOption('1')
  await expect(page.getByTestId('estimate-cover-summary')).toHaveCount(1)
  await expect(page.getByTestId('estimate-cover-summary')).toContainText('大項目13')
  const preview = await page.evaluate(
    async (d) =>
      window.sekisan.previewEstimatePdf({
        id: d.id,
        revision: d.revision,
        output: { cover: true, detail: false }
      }),
    large.data
  )
  assert.equal(preview.ok, true, preview.error)
  const largeBytes = Buffer.from(preview.data.bytes)
  const coverPages = await inspectPdf(largeBytes, true)
  assert.equal(coverPages.length, 2)
  for (let i = 1; i <= 13; i++)
    assert.equal(coverPages.join('').split(`大項目${String(i).padStart(2, '0')}`).length - 1, 1)
  assert.match(coverPages[1], /続\s*き/)
  assert.match(coverPages[1], /26,000/)
  writeFileSync('test-results/estimate-cover-multiple.pdf', largeBytes)
  await page.evaluate(async (token) => window.sekisan.closePdfPreview(token), preview.data.token)
  const takeoff = await page.evaluate(
    async (a) => (await window.sekisan.readTakeoff(a)).data,
    fixture.address
  )
  assert.deepEqual(takeoff, fixture.takeoff)
  assert.deepEqual(errors, [])
  console.log(
    'PASS 表紙: 同名内訳合算・名称/仕様/備考編集・Undo/Redo・保存再表示・PDF・内訳金額追従・元数量保持'
  )
} catch (e) {
  await page.screenshot({ path: 'test-results/estimate-cover-failure.png' })
  throw e
} finally {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
