import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-herringbone-'))
const pdfPath = join(temporary, '割り付け範囲.pdf')
const pdf = await PDFDocument.create()
pdf.addPage([842, 595])
writeFileSync(pdfPath, await pdf.save())
const env = { ...process.env, SEKISAN_DATA_DIR: join(temporary, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
mkdirSync('test-results', { recursive: true })
let application
try {
  application = await electron.launch({ args: ['.'], cwd: resolve('.'), env })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: '顧客を追加', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '顧客を追加', exact: true }).click()
  await page.getByRole('textbox', { name: '顧客名' }).fill('囲い直しテスト')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '案件を作成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '案件名' }).fill('床仕上げ工事')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, pdfPath)
  await page.getByRole('button', { name: '図面を取り込む', exact: true }).click()
  await expect(page.getByRole('button', { name: '割り付け範囲.pdf', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const check = (r) => {
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
    const w = check(await window.sekisan.workspace())
    const address = { drawingId: w.drawings[0].id, pageNumber: 1 }
    const polygon = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 }
    ]
    let state = check(
      await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: 0,
        change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }
      })
    )
    state = check(
      await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: {
          kind: 'room',
          id: crypto.randomUUID(),
          input: {
            name: '会議室',
            color: '#327e6d',
            heightMm: 2400,
            polygon,
            enabledCategories: ['floor'],
            sleeveWalls: [],
            finishes: Object.fromEntries(
              ['wall', 'floor', 'ceiling', 'baseboard'].map((c) => [
                c,
                { name: '', unitPrice: null }
              ])
            )
          }
        }
      })
    )
  })

  const snapshot = () =>
    page.evaluate(async () => {
      const w = (await window.sekisan.workspace()).data
      return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
    })
  const before = await snapshot(),
    roomId = before.rooms[0].id
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  const pattern = page.getByLabel('タイルの貼り方', { exact: true })
  const tiles = () =>
    page
      .getByTestId('layout-overlay')
      .locator('g[clip-path] polygon')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('points')))
  const savedDoc = () =>
    page.evaluate(async (id) => (await window.sekisan.readLayout(id)).data, roomId)
  await page.getByLabel('割付の幅（mm）', { exact: true }).fill('500')
  await page.getByLabel('割付の長さ（mm）', { exact: true }).fill('500')
  await pattern.selectOption('herringbone')
  await expect(page.getByRole('alert')).toContainText('長方形')
  await expect(page.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await expect(page.getByLabel('タイルをずらす方向', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /芯跨ぎ/ })).toHaveCount(0)
  await page.getByLabel('割付の幅（mm）', { exact: true }).fill('150')
  await page.getByLabel('割付の長さ（mm）', { exact: true }).fill('600')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('layout-tile-pattern')).toContainText('ヘリンボーン')
  const zeroJoint = await tiles()
  assert.ok(zeroJoint.length > 10)
  await page.getByLabel('割付の目地幅（mm）', { exact: true }).fill('3')
  const start = await tiles()
  assert.notDeepEqual(start, zeroJoint)
  await pattern.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/herringbone-settings.png' })
  await page.getByRole('button', { name: '柄を90°回転', exact: true }).click()
  await expect(page.getByLabel('図面からの回転（°）', { exact: true })).toHaveValue('90')
  assert.notDeepEqual(await tiles(), start)
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  assert.deepEqual(await tiles(), start)
  await page.getByRole('button', { name: /壁を基準/ }).click()
  await page.getByLabel('割付の基準壁', { exact: true }).selectOption('1')
  assert.notDeepEqual(await tiles(), start)
  await page.getByRole('button', { name: /柄の中心/ }).click()
  assert.deepEqual(await tiles(), start)
  await page.getByLabel('横の移動量（mm）', { exact: true }).fill('75')
  assert.notDeepEqual(await tiles(), start)
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  assert.deepEqual(await tiles(), start)
  // Right drag changes the viewport, never the material placement.
  const overlay = page.getByTestId('layout-overlay'),
    box = await overlay.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 20, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  assert.deepEqual(await tiles(), start)
  await page.getByRole('button', { name: '割り付けを保存', exact: true }).click()
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  const saved = await savedDoc()
  assert.equal(saved.body.tilePattern, 'herringbone')
  assert.equal(saved.body.widthMm, 150)
  assert.equal(saved.body.heightMm, 600)
  assert.equal(saved.body.gapMm, 3)
  assert.deepEqual(await snapshot(), before)
  await page.getByRole('button', { name: '図面一覧へ', exact: true }).click()
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(pattern).toHaveValue('herringbone')
  assert.deepEqual(await tiles(), start)
  await page.getByRole('button', { name: 'PDFプレビュー・保存', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const pdfOut = join(temporary, 'herringbone.pdf')
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, pdfOut)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(pdfOut), true)
  assert.match(pages[1], /ヘリンボーン/)
  assert.match(pages[1], /90°組み合わせ/)
  assert.match(pages[1], /目地 3 mm/)
  writeFileSync('test-results/herringbone.pdf', readFileSync(pdfOut))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  // A switch back to the existing patterns restores their controls.
  await pattern.selectOption('half')
  await expect(page.getByLabel('タイルをずらす方向', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '図面一覧へ', exact: true }).click()
  await page.getByRole('button', { name: '破棄して移動', exact: true }).click()
  assert.deepEqual(await savedDoc(), saved)
  assert.deepEqual(await snapshot(), before)
  console.log(
    'PASS ヘリンボーン: 長方形案内・目地・90°回転・壁基準・移動・Undo・右パン・保存再表示・PDF・馬貼り切替・元数量保持'
  )
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
