import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-layout-boundary-'))
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
  await page.getByLabel('割付の幅（mm）', { exact: true }).fill('500')
  await page.getByLabel('割付の長さ（mm）', { exact: true }).fill('500')
  await page.getByRole('button', { name: '割り付けを保存', exact: true }).click()
  const savedDoc = () =>
    page.evaluate(async (id) => (await window.sekisan.readLayout(id)).data, roomId)
  assert.equal((await savedDoc()).body.customPolygon, null)
  const overlay = page.getByTestId('layout-boundary-overlay')
  async function point(x, y) {
    const box = await overlay.boundingBox(),
      [, , w, h] = (await overlay.getAttribute('viewBox')).split(' ').map(Number)
    await overlay.click({ position: { x: (x / w) * box.width, y: (y / h) * box.height } })
  }
  await page.getByRole('button', { name: '割り付け範囲を囲い直す', exact: true }).click()
  await point(100, 100)
  await point(700, 400)
  await point(100, 400)
  await point(700, 100)
  await page.getByRole('button', { name: '範囲を確定', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '囲い直しをやめる', exact: true }).click()
  assert.equal((await savedDoc()).body.customPolygon, null)
  await page.getByRole('button', { name: '割り付け範囲を囲い直す', exact: true }).click()
  await point(100, 100)
  const box = await overlay.boundingBox()
  await page.mouse.move(box.x + 200, box.y + 170)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(box.x + 210, box.y + 180, { steps: 3 })
  await page.mouse.up({ button: 'right' })
  await point(700, 100)
  await point(700, 400)
  await point(100, 400)
  await page.keyboard.press('Enter')
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('.layout-results')).toContainText(/割り付け面積\s*18\.0 ㎡/)
  assert.deepEqual(await snapshot(), before)
  // PDF must use the same draft range without persisting it.
  await page.getByRole('button', { name: 'PDFプレビュー・保存', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const pdfOut = join(temporary, 'custom.pdf')
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, pdfOut)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(pdfOut), true)
  assert.match(pages[0], /割り付け専用範囲/)
  assert.match(pages[0], /18.0/)
  writeFileSync('test-results/layout-custom-boundary.pdf', readFileSync(pdfOut))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  assert.equal((await savedDoc()).body.customPolygon, null)
  await page.getByRole('button', { name: '割り付けを保存', exact: true }).click()
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  const custom = await savedDoc()
  assert.equal(custom.body.customPolygon.length, 4)
  assert.deepEqual(await snapshot(), before)
  await page.screenshot({ path: 'test-results/layout-custom-boundary.png' })
  await page.getByRole('button', { name: '拾い出しの範囲に戻す', exact: true }).click()
  await expect(page.locator('.layout-results')).toContainText(/部屋面積\s*12\.0 ㎡/)
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  await expect(page.locator('.layout-results')).toContainText(/割り付け面積\s*18\.0 ㎡/)
  await page.getByRole('button', { name: '図面一覧へ', exact: true }).click()
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.locator('.layout-results')).toContainText(/割り付け面積\s*18\.0 ㎡/)
  await page.getByRole('button', { name: '割り付け範囲を囲い直す', exact: true }).click()
  await point(100, 100)
  await page.getByRole('button', { name: '図面一覧へ', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '割り付けに未保存の変更があります', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '破棄して移動', exact: true }).click()
  assert.deepEqual(await savedDoc(), custom)
  assert.deepEqual(await snapshot(), before)
  console.log(
    'PASS 割り付け専用範囲: 交差拒否・キャンセル / 右パン・Enter / 元数量維持 / PDFの図・面積 / 保存再表示 / 元へ戻す・Undo / 描画途中の未保存保護'
  )
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
