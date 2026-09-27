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
  await button('部位の一覧・編集').click()
  await expect(dialog('部位の一覧・編集')).toContainText('天井')
  await expect(dialog('部位の一覧・編集')).toContainText('基本項目')
  await button('部位「建具」を編集').click()
  await page.getByLabel('変更する部位名', { exact: true }).fill('壁')
  await button('変更して保存').click()
  await expect(dialog('部位を編集')).toContainText('同じ名前')
  await page.getByLabel('変更する部位名', { exact: true }).fill('木製建具')
  await button('変更して保存').click()
  await expect(button('部位「木製建具」を編集')).toBeVisible()
  await dialog('部位の一覧・編集')
    .locator('.modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await button('単位の一覧・編集').click()
  await button('単位「枚」を編集').click()
  await page.getByLabel('変更する単位名', { exact: true }).fill('面')
  await button('変更して保存').click()
  await expect(button('単位「面」を編集')).toBeVisible()
  await page.screenshot({ path: 'test-results/catalog-unit-list.png' })
  await dialog('単位の一覧・編集')
    .locator('.modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await expect(page.locator('.master-list')).toContainText('木製建具')
  await expect(page.locator('.master-list')).toContainText('面')
  await dialog('仕上げ材マスタ')
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
  await expect(dialog('仕上げ材マスタ')).toBeVisible()
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
