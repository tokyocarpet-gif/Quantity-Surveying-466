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
const dialog = (name) => page.getByRole('dialog', { name, exact: true })
try {
  await page.waitForFunction(() => !!window.sekisan)
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.getByText('ワークスペース', { exact: true })).toHaveCount(0)
  await expect(page.getByText('WORKSPACE / 案件管理', { exact: true })).toHaveCount(0)
  await expect(page.getByText('大切なデータを手元に', { exact: true })).toHaveCount(0)
  await expect(button('バックアップを管理')).toHaveCount(0)
  await expect(button('設定・データ管理')).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-clean.png' })
  const before = await page.evaluate(async (fixture) => {
    const unwrap = (r) => {
      if (!r.ok) throw new Error(JSON.stringify(r))
      return r.data
    }
    unwrap(await window.sekisan.addCatalogOption({ kind: 'part', name: '建具' }))
    unwrap(await window.sekisan.addCatalogOption({ kind: 'unit', name: '枚' }))
    const id = crypto.randomUUID()
    unwrap(
      await window.sekisan.changeMaterials({
        kind: 'save',
        id,
        input: {
          projectId: null,
          category: '建具',
          name: '木製ドア',
          specification: 'W900',
          unit: '枚',
          unitPrice: 1500
        }
      })
    )
    unwrap(
      await window.sekisan.changeMaterials({
        kind: 'import',
        projectId: fixture.projectId,
        ids: [id]
      })
    )
    const doc = unwrap(await window.sekisan.readEstimate({ id: fixture.id }))
    doc.body.lines[0].category = '建具'
    doc.body.lines[0].unit = '枚'
    const saved = unwrap(
      await window.sekisan.saveEstimate({
        id: doc.id,
        expectedRevision: doc.latestRevision,
        body: doc.body
      })
    )
    location.hash = `/estimate/${doc.id}`
    return saved
  }, fixture)
  await expect(page.locator('.estimate-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByLabel('明細1の数量', { exact: true }).click()
  await page.getByLabel('明細の数量', { exact: true }).fill('3')
  await button('反映').click()
  await expect(button('見積を保存')).toBeEnabled()
  await button('マスタ').click()
  await expect(dialog('マスタ管理')).toBeVisible()
  await expect(button('部位を追加')).toHaveCount(0)
  await expect(button('単位を追加')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/master-management.png' })
  await button('部位マスタ').click()
  await button('部位を追加').click()
  await page.getByLabel('追加する部位名', { exact: true }).fill('ルーバー')
  await button('追加して保存').click()
  await expect(dialog('部位マスタ')).toContainText('ルーバー')
  await expect(button('部位「ルーバー」を編集')).toBeVisible()
  await page.screenshot({ path: 'test-results/catalog-part-list.png' })
  await expect(dialog('部位マスタ')).toContainText('天井')
  await expect(dialog('部位マスタ')).toContainText('基本項目')
  await expect(button('部位「天井」を削除')).toHaveCount(0)
  await button('部位「ルーバー」を削除').click()
  await expect(dialog('部位を削除')).toContainText('ルーバー')
  await button('戻る').click()
  await expect(button('部位「ルーバー」を削除')).toBeVisible()
  await button('部位「ルーバー」を削除').click()
  await button('削除する').click()
  await expect(dialog('部位を削除')).toHaveCount(0)
  await expect(button('部位「ルーバー」を編集')).toHaveCount(0)
  await button('部位「建具」を削除').click()
  await button('削除する').click()
  await expect(dialog('部位を削除')).toContainText('材料マスタで使用中')
  await button('戻る').click()
  await button('部位「建具」を編集').click()
  await page.getByLabel('変更する部位名', { exact: true }).fill('壁')
  await button('変更して保存').click()
  await expect(dialog('部位を編集')).toContainText('同じ名前')
  await page.getByLabel('変更する部位名', { exact: true }).fill('木製建具')
  await button('変更して保存').click()
  await expect(button('部位「木製建具」を編集')).toBeVisible()
  await dialog('部位マスタ')
    .locator('.modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await button('単位マスタ').click()
  await button('単位を追加').click()
  await page.getByLabel('追加する単位名', { exact: true }).fill('組')
  await button('追加して保存').click()
  await expect(dialog('単位マスタ')).toContainText('組')
  await expect(button('単位「組」を編集')).toBeVisible()
  await expect(button('単位「㎡」を削除')).toHaveCount(0)
  await button('単位「組」を削除').click()
  await expect(dialog('単位を削除')).toContainText('組')
  await page.screenshot({ path: 'test-results/catalog-delete-confirm.png' })
  await button('削除する').click()
  await expect(dialog('単位を削除')).toHaveCount(0)
  await expect(button('単位「組」を編集')).toHaveCount(0)
  await button('単位「枚」を削除').click()
  await button('削除する').click()
  await expect(dialog('単位を削除')).toContainText('材料マスタで使用中')
  await button('戻る').click()
  await button('単位「枚」を編集').click()
  await page.getByLabel('変更する単位名', { exact: true }).fill('面')
  await button('変更して保存').click()
  await expect(button('単位「面」を編集')).toBeVisible()
  await page.screenshot({ path: 'test-results/catalog-unit-list.png' })
  await dialog('単位マスタ')
    .locator('.modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await expect(page.locator('.master-list')).toContainText('木製建具')
  await expect(page.locator('.master-list')).toContainText('面')
  await dialog('マスタ管理')
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await expect(page.getByLabel('明細1の数量', { exact: true })).toHaveText('3.0')
  await expect(button('見積を保存')).toBeEnabled()
  await expect(page.locator('#estimate-parts option[value="木製建具"]')).toHaveCount(1)
  await expect(page.locator('#estimate-units option[value="面"]')).toHaveCount(1)
  const state = await page.evaluate(
    async (f) => ({
      doc: (await window.sekisan.readEstimate({ id: f.id })).data,
      materials: (await window.sekisan.readMaterials(f.projectId)).data,
      takeoff: (await window.sekisan.readTakeoff(f.address)).data
    }),
    fixture
  )
  assert.ok(!state.materials.parts.includes('ルーバー'))
  assert.ok(!state.materials.units.includes('組'))
  assert.deepEqual(state.doc, before)
  assert.deepEqual(state.takeoff, fixture.takeoff)
  assert.equal(state.materials.project.find((m) => m.name === '木製ドア').category, '木製建具')
  assert.equal(state.materials.global.find((m) => m.name === '木製ドア').unit, '面')
  await button('見積を保存').click()
  await expect(page.locator('.estimate-save-status')).toHaveText('保存済み')
  await page.evaluate((p) => {
    location.hash = `/estimates/${p}`
  }, fixture.projectId)
  await button('マスタ').click()
  await expect(dialog('マスタ管理')).toBeVisible()
  await expect(page.locator('.master-list')).toContainText('木製建具')
  assert.deepEqual(errors, [])
  console.log(
    'PASS 部位・単位の一覧編集・重複拒否・材料の更新・見積の両画面からマスタ・候補更新・未保存見積と拾い出し保持'
  )
} catch (e) {
  await page.screenshot({ path: 'test-results/catalog-edit-failure.png' })
  throw e
} finally {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  await app.close()
  rmSync(root, { recursive: true, force: true })
}
