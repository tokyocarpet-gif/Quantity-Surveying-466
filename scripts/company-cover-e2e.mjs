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
try {
  await page.getByRole('button', { name: '設定・データ管理', exact: true }).click()
  await page.getByRole('button', { name: '自社情報を登録・編集', exact: true }).click()
  const fields = {
    建設業許可: '東京都知事許可（般2）第12226号',
    消防庁認定: '消防庁認定第12703号',
    会社名: '東京カーペット加工 株式会社',
    郵便番号: '130-0012',
    住所: '東京都墨田区太平4-6-6',
    電話番号: '03-3625-4169',
    FAX: '03-3626-2669'
  }
  for (const [label, value] of Object.entries(fields))
    await page.getByLabel(`自社の${label}`, { exact: true }).fill(value)
  await page.getByLabel('自社の建設業許可', { exact: true }).press('Enter')
  await expect(page.getByLabel('自社の消防庁認定', { exact: true })).toBeFocused()
  await expect(page.getByText('自社情報を保存しました。', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/company-settings.png' })
  await page.getByRole('button', { name: '自社情報を保存', exact: true }).click()
  await expect(page.getByText('自社情報を保存しました。', { exact: true })).toBeVisible()
  await page.locator('.company-form').getByRole('button', { name: '閉じる', exact: true }).click()
  await page.evaluate((id) => {
    location.hash = `/estimate/${id}`
  }, fixture.id)
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.locator('.paper-issuer .company-block')).toHaveCount(0)
  const before = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByRole('button', { name: '自社情報を反映', exact: true }).click()
  await expect(page.getByLabel('見積の会社情報の建設業許可', { exact: true })).toHaveValue(
    fields.建設業許可
  )
  await page.getByRole('button', { name: 'この見積に反映', exact: true }).click()
  await expect(page.locator('.paper-issuer .company-line-permit')).toHaveCount(2)
  await expect(page.locator('.paper-issuer .company-line-phone')).toHaveText(
    'TEL 03-3625-4169　FAX 03-3626-2669'
  )
  await page
    .locator('.estimate-inspector')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await page.getByRole('button', { name: '見積の発行者', exact: true }).click()
  await page.getByLabel('見積の会社情報の住所', { exact: true }).fill('東京都墨田区太平4-6-6 本社')
  await page.getByRole('button', { name: 'この見積に反映', exact: true }).click()
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(page.locator('.paper-issuer .company-line-address')).toHaveText(fields.住所)
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.locator('.paper-issuer .company-line-name')).toHaveText(fields.会社名)
  const saved = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  assert.deepEqual(saved.body.lines, before.body.lines)
  assert.equal(saved.body.issuerCompany.constructionLicense, fields.建設業許可)
  const old = await page.evaluate(
    async ({ id, revision }) => (await window.sekisan.readEstimate({ id, revision })).data,
    { id: fixture.id, revision: before.revision }
  )
  assert.deepEqual(old.body, before.body)
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  const issuerBox = await page.locator('.paper-issuer').boundingBox()
  const numberBox = await page.locator('.paper-estimate-number').boundingBox()
  assert.ok(Math.abs(issuerBox.x + issuerBox.width - numberBox.x - numberBox.width) < 2)
  assert.ok(issuerBox.y >= numberBox.y + numberBox.height)
  await expect(page.locator('.paper-kicker')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/company-cover.png' })
  // Fill all 13 cover slots (2 linked rows + 11 extras) and add a multiline memo.
  await page.evaluate(async (id) => {
    const r = await window.sekisan.readEstimate({ id })
    if (!r.ok) throw new Error(JSON.stringify(r))
    const doc = r.data
    doc.body.coverExtras = Array.from({ length: 11 }, (_, i) => ({
      id: crypto.randomUUID(),
      room: '',
      category: '',
      name: `経費${i + 1}`,
      specification: '',
      section: '',
      note: '',
      quantity: '1.0',
      unit: '式',
      unitPrice: 0
    }))
    doc.body.memo = '施工時間は別途協議\n搬入経路は現地確認\n養生範囲は打合せの上決定'
    const saved = await window.sekisan.saveEstimate({
      id,
      expectedRevision: doc.latestRevision,
      body: doc.body
    })
    if (!saved.ok) throw new Error(JSON.stringify(saved))
  }, fixture.id)
  await page.reload()
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.locator('.paper-items .paper-data-row')).toHaveCount(13)
  await page.getByRole('button', { name: '税込', exact: true }).click()
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await expect(page.locator('.paper-tax')).toHaveCount(2)
  await expect(page.locator('.paper-items .paper-data-row')).toHaveCount(13)
  await page.getByRole('button', { name: '税抜', exact: true }).click()
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await page.getByRole('button', { name: '税込', exact: true }).click()
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await page.getByRole('button', { name: 'PDFを作成', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const file = join(root, 'company-cover.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(file), true)
  assert.match(pages[0], /東京都知事許可/)
  assert.match(pages[0], /消防庁認定第12703号/)
  assert.match(pages[0], /03-3625-4169/)
  assert.equal(pages.length, 4)
  assert.match(pages[0], /66,000/)
  assert.match(pages[0], /消費税/)
  assert.match(pages[0], /6,000/)
  assert.match(pages[0], /60,000/)
  assert.match(pages[0], /経費11/)
  assert.match(pages[0], /養生範囲は打合せの上決定/)
  writeFileSync('test-results/company-cover.pdf', readFileSync(file))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '見積の発行者', exact: true }).click()
  for (const [key, value] of [
    ['メールアドレス', 'info@example.test'],
    ['担当者', '山田 太郎'],
    ['登録番号', 'T1234567890123']
  ])
    await page.getByLabel(`見積の会社情報の${key}`, { exact: true }).fill(value)
  await page.getByRole('button', { name: 'この見積に反映', exact: true }).click()
  await expect(page.locator('.paper-issuer .company-line-extra')).toHaveCount(3)
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await expect(page.getByText(/文字が固定の行枠/)).toHaveCount(0)
  await page.getByRole('button', { name: 'PDFを作成', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const extraPages = await inspectPdf(readFileSync(file), true)
  assert.match(extraPages[0], /T1234567890123/)
  writeFileSync('test-results/company-cover-extras.pdf', readFileSync(file))
  assert.deepEqual(errors, [])
  console.log(
    'PASS 自社情報登録・Enter移動・既存見積への反映・個別編集・Undo・保存再表示・旧版保持・PDF'
  )
} catch (e) {
  await page.screenshot({ path: 'test-results/company-failure.png' })
  throw e
} finally {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
