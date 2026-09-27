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
const button = (name) => page.getByRole('button', { name, exact: true })
try {
  await page.waitForFunction(() => !!window.sekisan)
  const doc = await page.evaluate(async (projectId) => {
    const unwrap = (r) => {
      if (!r.ok) throw new Error(JSON.stringify(r))
      return r.data
    }
    let report = unwrap(await window.sekisan.readSummary({ projectId }))
    report = unwrap(
      await window.sekisan.editSummary({
        request: report.request,
        fingerprint: report.fingerprint,
        rowId: report.rows[0].id,
        finish: { name: 'タイルカーペット', specification: '500×500 mm', unitPrice: 2500 }
      })
    )
    unwrap(
      await window.sekisan.changeMaterials({
        kind: 'save',
        id: crypto.randomUUID(),
        input: {
          projectId,
          category: 'floor',
          name: '長尺シート',
          specification: '品番TEST',
          unit: '㎡',
          unitPrice: 3000
        }
      })
    )
    const doc = unwrap(
      await window.sekisan.createEstimate({
        request: report.request,
        fingerprint: report.fingerprint
      })
    )
    location.hash = `/estimate/${doc.id}`
    return doc
  }, fixture.projectId)
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  assert.equal(doc.body.lines[0].name, '会議室')
  assert.equal(doc.body.lines[0].specification, 'タイルカーペット')
  assert.equal(doc.body.lines[0].specification2, '500×500 mm')
  await expect(page.getByLabel('明細1の名称', { exact: true })).toHaveText('会議室')
  await expect(page.getByLabel('明細1の仕様1', { exact: true })).toHaveText('タイルカーペット')
  await expect(page.locator('.paper-name .paper-room')).toHaveCount(0)
  await page.getByLabel('明細1の仕様1', { exact: true }).click()
  await page.getByLabel('明細のメーカー', { exact: true }).fill('メーカーA')
  await page.getByLabel('明細のメーカー', { exact: true }).press('Tab')
  await expect(page.getByLabel('明細の仕様1', { exact: true })).toBeFocused()
  await page.getByLabel('明細の仕様1', { exact: true }).fill('長尺シート｜品番TEST')
  await page.getByLabel('明細の仕様1', { exact: true }).press('Tab')
  await expect(page.getByLabel('明細の品名', { exact: true })).toHaveValue('会議室')
  await expect(page.getByLabel('明細の仕様2', { exact: true })).toHaveValue('品番TEST')
  await button('反映').click()
  await expect(page.getByLabel('明細1の仕様1', { exact: true })).toHaveText('長尺シート')
  await button('元に戻す').click()
  await expect(page.getByLabel('明細1の仕様1', { exact: true })).toHaveText('タイルカーペット')
  await button('セル編集に切り替え').click()
  await page.getByLabel('明細1の部位', { exact: true }).click()
  await page.getByRole('combobox', { name: '明細1の部位', exact: true }).press('Tab')
  await page.getByRole('combobox', { name: '明細1のメーカー', exact: true }).fill('メーカーA')
  await page.getByRole('combobox', { name: '明細1のメーカー', exact: true }).press('Tab')
  await expect(page.getByRole('combobox', { name: '明細1の仕様1', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByLabel('明細1の仕様1', { exact: true }).click()
  await page
    .getByRole('combobox', { name: '明細1の仕様1', exact: true })
    .fill('長尺シート｜品番TEST')
  await page.getByRole('combobox', { name: '明細1の仕様1', exact: true }).press('Tab')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('明細1の名称', { exact: true })).toHaveText('会議室')
  await expect(page.getByLabel('明細1の仕様1', { exact: true })).toHaveText('長尺シート')
  await expect(page.getByLabel('明細1の仕様2', { exact: true })).toHaveText('品番TEST')
  await button('見積を保存').click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  await page.reload()
  await expect(page.getByLabel('明細1の名称', { exact: true })).toHaveText('会議室')
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/estimate-transfer.png' })
  await button('PDFを作成').click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const file = join(root, 'transfer.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await button('PDFを保存').click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(file), true)
  assert.equal(pages.length, 2)
  assert.match(pages[1], /会議室/)
  assert.match(pages[1], /長尺シート/)
  assert.match(pages[1], /メーカーA.*長尺シート.*品番TEST/)
  assert.doesNotMatch(pages.join(''), /ESTIMATE|この内訳書の小計/)
  assert.match(pages[1], /小計/)
  writeFileSync('test-results/estimate-transfer.pdf', readFileSync(file))
  assert.deepEqual(errors, [])
  console.log(
    'PASS 集計から品名=部屋名・仕様=材料+規格、重複表示なし、ポップアップ/直接編集のマスタ選択、保存再表示、PDF'
  )
} catch (e) {
  await page.screenshot({ path: 'test-results/estimate-transfer-failure.png' })
  throw e
} finally {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
