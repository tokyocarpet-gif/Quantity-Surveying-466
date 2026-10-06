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
  await expect(page.locator('.estimate-paper')).toBeVisible()
  const doc = await page.evaluate(
      async (id) => (await window.sekisan.readEstimate({ id })).data,
      fixture.id
    ),
    a = doc.body.lines[0].id,
    b = doc.body.lines[1].id
  // Delete directly from the row and restore the original record with undo.
  await page.getByRole('button', { name: '明細1を削除', exact: true }).click()
  await page.getByRole('button', { name: 'この明細を削除', exact: true }).click()
  await expect(cell(a, 'name')).toHaveCount(0)
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(cell(a, 'name')).toBeVisible()
  await page.getByRole('button', { name: 'セル編集に切り替え', exact: true }).click()
  // Optional properties are entered only when needed through the row inspector.
  await cell(a, 'name').click()
  await input().press('Escape')
  await page.getByRole('button', { name: '行の詳細', exact: true }).click()
  await page.getByLabel('選択明細のメーカー', { exact: true }).fill('東リ')
  await page.getByLabel('選択明細のメーカー', { exact: true }).press('Enter')
  await expect(cell(a, 'manufacturer')).toHaveText('東リ')
  await page
    .locator('.estimate-inspector')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await cell(a, 'itemNo').click()
  await input().fill('1-1')
  await input().press('Enter')
  await expect(input()).toHaveAttribute('data-cell-scope', b)
  await input().press('Shift+Enter')
  await expect(input()).toHaveAttribute('data-cell-scope', a)
  await input().press('Tab')
  await expect(input()).toHaveAttribute('data-cell-key', 'name')
  await input().press('Escape')
  await cell(a, 'quantity').click()
  await input().fill('12.3')
  await input().press('Tab')
  await expect(input()).toHaveAttribute('data-cell-key', 'unit')
  await input().press('Escape')
  await expect(cell(a, 'quantity')).toHaveText('12.3')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(cell(a, 'quantity')).toHaveText('2.0')
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  await expect(cell(a, 'quantity')).toHaveText('12.3')
  await cell(a, 'name').click()
  await input().dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await expect(input()).toHaveAttribute('data-cell-scope', a)
  await input().press('Escape')
  await cell(a, 'itemNo').evaluate((el) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData(
      'text/plain',
      'A-1\tクロス\tRE123\t3.4\t㎡\t1,500\t999\t貼付確認\nA-2\t床材\t500角\t2\t㎡\t0\t999\t'
    )
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
    )
  })
  await expect(cell(a, 'quantity')).toHaveText('3.4')
  await expect(cell(b, 'unitPrice')).toHaveText('0')
  await expect(page.locator('.paper-transfer')).toHaveCount(0)
  await page.getByRole('button', { name: '表紙へ転記', exact: true }).click()
  const checks = page.locator('.paper-transfer')
  for (let i = 0; i < 12; i++) await checks.nth(i).check()
  await expect(checks.nth(12)).toBeDisabled()
  await expect(page.getByText('表紙 残り0／12行', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '選択した明細を表紙で編集', exact: true }).click()
  await expect(page.locator('[data-sheet-kind=cover]')).toBeVisible()
  await page.getByRole('button', { name: 'セル編集に切り替え', exact: true }).click()
  await expect(page.getByRole('button', { name: '内訳書', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('estimate-row')).toHaveCount(12)
  await cell('extra:00000000-0000-4000-8000-000000000001', 'unitPrice').click()
  await input().fill('50000')
  await input().press('Enter')
  await page.getByRole('button', { name: '税込', exact: true }).click()
  await page.getByLabel('見積の宛先', { exact: true }).click()
  await input().fill('株式会社東京カーペット加工建設インテリアソリューション事業部')
  await input().press('Enter')
  await page.screenshot({ path: 'test-results/estimate-modern-cover.png', fullPage: true })
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.getByText('第3版として保存しました。', { exact: true })).toBeVisible()
  const saved = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data,
    fixture.id
  )
  assert.equal(saved.body.lines[0].itemNo, 'A-1')
  assert.equal(saved.totals.subtotal, '75100')
  assert.equal(saved.totals.total, '82610')
  for (const output of [
    { cover: true, detail: false },
    { cover: false, detail: true },
    { cover: true, detail: true }
  ]) {
    const result = await page.evaluate(
      async ({ id, output }) => {
        const r = await window.sekisan.previewEstimatePdf({ id, revision: 3, output })
        return r.ok ? { ok: true, bytes: Array.from(r.data.bytes), token: r.data.token } : r
      },
      { id: fixture.id, output }
    )
    assert.ok(result.ok, result.error)
    const pages = await inspectPdf(Uint8Array.from(result.bytes), true)
    assert.equal(pages.length, Number(output.cover) + Number(output.detail))
    if (output.cover) assert.match(pages[0], /82,610/)
    if (!output.cover) assert.doesNotMatch(pages.join(''), /諸経費|消費税/)
    if (output.cover && output.detail)
      writeFileSync('test-results/estimate-modern.pdf', Buffer.from(result.bytes))
    await page.evaluate((token) => window.sekisan.closePdfPreview(token), result.token)
  }
  await page.getByRole('button', { name: '全明細の内訳書編集に戻す', exact: true }).click()
  await expect(page.getByLabel('編集する内訳ページ')).toHaveCount(1)
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.getByText('第4版として保存しました。', { exact: true })).toBeVisible()
  const all = await page.evaluate(async (id) => {
    const r = await window.sekisan.previewEstimatePdf({
      id,
      revision: 4,
      output: { cover: false, detail: true }
    })
    return r.ok ? { ok: true, bytes: Array.from(r.data.bytes), token: r.data.token } : r
  }, fixture.id)
  assert.ok(all.ok, all.error)
  const pages = await inspectPdf(Uint8Array.from(all.bytes), true)
  assert.equal(pages.length, 3)
  assert.match(pages[1], /販売センター/)
  assert.match(pages[2], /モデルルーム/)
  await page.evaluate((token) => window.sekisan.closePdfPreview(token), all.token)
  await page.screenshot({ path: 'test-results/estimate-modern-detail.png', fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: 'セル編集に切り替え', exact: true }).click()
  await expect(page.getByRole('button', { name: '内訳書', exact: true })).toBeVisible()
  await expect(cell(a, 'itemNo')).toHaveText('A-1')
  // Blank rows act as entry points; delete does not leave a phantom line.
  await page.getByLabel('編集する内訳ページ').selectOption('2')
  await page.getByRole('button', { name: '空行の品名を入力', exact: true }).click()
  await expect(input()).toHaveAttribute('data-cell-key', 'name')
  await input().fill('追加した明細')
  await input().press('Enter')
  await expect(input()).toHaveAttribute('data-cell-key', 'name')
  await expect(input()).toHaveValue('')
  await input().press('Escape')
  await page.getByRole('button', { name: '明細32を削除', exact: true }).click()
  await page.getByRole('button', { name: 'この明細を削除', exact: true }).click()
  await page.getByRole('button', { name: '明細31を削除', exact: true }).click()
  await page.getByRole('button', { name: 'この明細を削除', exact: true }).click()
  await expect(page.getByRole('button', { name: '明細31を削除', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '見積を保存', exact: true })).toBeDisabled()
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.screenshot({ path: 'test-results/estimate-refined.png', fullPage: true })
  await page.getByLabel('編集する内訳ページ').selectOption('0')
  await cell(a, 'quantity').click()
  await input().fill('数値以外')
  await input().press('Enter')
  await expect(page.getByRole('alert')).toContainText('数値')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  const unchanged = await page.evaluate(
    async (id) => (await window.sekisan.readEstimate({ id })).data.revision,
    fixture.id
  )
  assert.equal(unchanged, 4)
  await input().press('Escape')
  await page.getByRole('checkbox', { name: '表紙', exact: true }).uncheck()
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.getByText('第5版として保存しました。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'PDFを作成', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await expect(page.getByLabel('見積PDFのページ').locator('option')).toHaveCount(3)
  const savePath = join(root, 'selected.pdf')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, savePath)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  assert.equal((await inspectPdf(readFileSync(savePath), true)).length, 3)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await app.evaluate(({ app }) => {
    app.on('web-contents-created', (_event, wc) => {
      wc.print = (options, callback) => {
        globalThis.__estimatePrint = {
          options,
          html: decodeURIComponent(wc.getURL().split(',').slice(1).join(','))
        }
        callback(true, '')
      }
    })
  })
  await page.getByRole('button', { name: '印刷', exact: true }).click()
  await expect(page.getByText('印刷ダイアログを閉じました。', { exact: true })).toBeVisible()
  const printed = await app.evaluate(() => globalThis.__estimatePrint)
  assert.equal(printed.options.silent, false)
  assert.equal(printed.options.landscape, true)
  assert.equal((printed.html.match(/data-sheet-kind="detail"/g) ?? []).length, 3)
  assert.equal((printed.html.match(/data-sheet-kind="cover"/g) ?? []).length, 0)
  const tooLong = await page.evaluate(async (id) => {
    const d = (await window.sekisan.readEstimate({ id })).data
    const saved = await window.sekisan.saveEstimate({
      id,
      expectedRevision: d.revision,
      body: { ...d.body, issuer: '長い会社情報'.repeat(140) }
    })
    if (!saved.ok) return saved
    return window.sekisan.previewEstimatePdf({
      id,
      revision: saved.data.revision,
      output: { cover: true, detail: false }
    })
  }, fixture.id)
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error, /A4/)
  // Deleting the final cover line keeps one editable blank row and a valid document.
  await page.evaluate(async (id) => {
    const d = (await window.sekisan.readEstimate({ id })).data
    const line = d.body.lines[0]
    const saved = await window.sekisan.saveEstimate({
      id,
      expectedRevision: d.revision,
      body: {
        ...d.body,
        issuer: '東京カーペット加工株式会社',
        lines: [line],
        detailSheets: [{ id: line.id, section: line.section, lineIds: [line.id] }],
        presentation: { ...d.body.presentation, mode: 'cover', coverLineIds: [line.id] }
      }
    })
    if (!saved.ok) throw new Error(saved.error)
  }, fixture.id)
  await page.reload()
  await page.getByRole('button', { name: '明細1を削除', exact: true }).click()
  await page.getByRole('button', { name: 'この明細を削除', exact: true }).click()
  await expect(page.getByTestId('estimate-row')).toHaveCount(1)
  await expect(page.getByLabel('明細1の名称', { exact: true })).toHaveText('品名を入力')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.getByText('第8版として保存しました。', { exact: true })).toBeVisible()
  const source = await page.evaluate(
    async (address) => (await window.sekisan.readTakeoff(address)).data,
    fixture.address
  )
  assert.deepEqual(source, fixture.takeoff)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: edit, IME, keyboard, paste, undo/redo, 12-row limit, revision persistence, selected PDF output, A4 pagination, source isolation'
  )
} finally {
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
