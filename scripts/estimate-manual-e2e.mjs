import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
const root = mkdtempSync(join(tmpdir(), 'estimate-manual-')),
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
const button = (name) => page.getByRole('button', { name, exact: true })
const field = (name) => page.getByLabel(`明細の${name}`, { exact: true })
const read = () =>
  page.evaluate(async (id) => (await window.sekisan.readEstimate({ id })).data, fixture.id)
const rows = () => page.locator('.paper-data-row,.paper-blank-row')
try {
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.evaluate((id) => {
    location.hash = `/estimate/${id}`
  }, fixture.id)
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await expect(rows()).toHaveCount(23)
  await expect(page.getByLabel('編集する内訳ページ').locator('option')).toHaveCount(3)
  // Opening/cancelling an existing row is read-only, and focuses the clicked property.
  await page.getByLabel('明細1の数量', { exact: true }).click()
  await expect(field('数量')).toBeFocused()
  await field('数量').fill('123')
  await button('キャンセル').click()
  await expect(page.getByLabel('明細1の数量', { exact: true })).toHaveText('2.0')
  await expect(button('見積を保存')).toBeDisabled()
  // A full sheet does not create another sheet from next-row editing.
  await page.getByLabel('明細23の名称', { exact: true }).click()
  await expect(button('反映して次の行')).toBeDisabled()
  await button('キャンセル').click()
  await button('内訳明細書を追加').click()
  await expect(page.getByLabel('編集する内訳ページ').locator('option')).toHaveCount(4)
  await expect(page.getByTestId('estimate-row')).toHaveCount(0)
  await expect(rows()).toHaveCount(23)
  await page.getByLabel('内訳の工事名', { exact: true }).click()
  await page.locator('.paper-input').fill('追加工事')
  await page.locator('.paper-input').press('Enter')
  await button('空行の品名を入力').click()
  await field('品名').fill('追加のクロス')
  await field('仕様1').fill('RE123')
  await field('数量').fill('数値以外')
  await button('反映').click()
  await expect(page.locator('dialog [role=alert]')).toContainText('数値')
  await field('数量').fill('3.5')
  await field('単位').fill('㎡')
  await field('単価').fill('1200')
  await expect(page.locator('.estimate-row-amount')).toContainText('4,200')
  await field('部位').fill('壁')
  await field('メーカー').fill('サンゲツ')
  // Shortcut undo inside the dialog must not remove the owning sheet behind it.
  await button('反映').focus()
  await button('反映').press('Meta+z')
  await expect(field('品名')).toHaveValue('追加のクロス')
  await expect(page.getByLabel('編集する内訳ページ').locator('option')).toHaveCount(4)
  await page.screenshot({ path: 'test-results/estimate-row-dialog.png' })
  await button('反映して次の行').click()
  await expect(field('品名')).toHaveValue('')
  await button('キャンセル').click()
  await expect(page.getByTestId('estimate-row')).toHaveCount(1)
  await expect(rows()).toHaveCount(23)
  await button('見積を保存').click()
  await expect(page.getByText('第3版として保存しました。', { exact: true })).toBeVisible()
  let saved = await read()
  assert.equal(saved.body.detailSheets.length, 4)
  assert.equal(saved.body.lines.length, 31)
  assert.equal(saved.body.lines.at(-1).category, 'wall')
  assert.equal(saved.body.lines.at(-1).unitPrice, 1200)
  await page.reload()
  await expect(page.getByLabel('編集する内訳ページ').locator('option')).toHaveCount(4)
  await page.getByLabel('編集する内訳ページ').selectOption('3')
  await expect(page.getByLabel('明細31の名称', { exact: true })).toHaveText('追加のクロス')
  await page.screenshot({ path: 'test-results/estimate-manual-sheets.png' })
  // Empty added sheets persist, appear in PDF, and contain exactly 23 slots.
  await button('内訳明細書を追加').click()
  await button('見積を保存').click()
  await expect(page.getByText('第4版として保存しました。', { exact: true })).toBeVisible()
  const pdf = await page.evaluate(async (id) => {
    const r = await window.sekisan.previewEstimatePdf({
      id,
      revision: 4,
      output: { cover: false, detail: true }
    })
    return r.ok ? { ok: true, bytes: Array.from(r.data.bytes), token: r.data.token } : r
  }, fixture.id)
  assert.ok(pdf.ok, pdf.error)
  const pages = await inspectPdf(Uint8Array.from(pdf.bytes), true)
  assert.equal(pages.length, 5)
  assert.match(pages[3], /追加工事/)
  assert.match(pages[3], /4,200/)
  writeFileSync('test-results/estimate-manual.pdf', Buffer.from(pdf.bytes))
  await page.evaluate((token) => window.sekisan.closePdfPreview(token), pdf.token)
  // Fixed rows cannot silently truncate long notes in PDF.
  await page.getByLabel('編集する内訳ページ').selectOption('3')
  await page.getByLabel('明細31の名称', { exact: true }).click()
  await field('備考').fill('長い備考'.repeat(30))
  await button('反映').click()
  await expect(page.getByRole('alert')).toContainText('固定の行枠')
  await button('見積を保存').click()
  await expect(page.getByText('第5版として保存しました。', { exact: true })).toBeVisible()
  const blocked = await page.evaluate(
    (id) =>
      window.sekisan.previewEstimatePdf({
        id,
        revision: 5,
        output: { cover: false, detail: true }
      }),
    fixture.id
  )
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /A4/)
  const source = await page.evaluate(
    async (address) => (await window.sekisan.readTakeoff(address)).data,
    fixture.address
  )
  assert.deepEqual(source, fixture.takeoff)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: manual 23-row sheets, row popup, cancel, validation, next row, explicit add, empty sheet persistence, PDF, overflow protection'
  )
} catch (e) {
  console.error(e)
  await page.screenshot({ path: 'test-results/estimate-manual-failure.png' })
  throw e
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
