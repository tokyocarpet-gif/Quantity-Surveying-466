import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-wall-'))
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
  await page.getByRole('button', { name: '壁材', exact: true }).click()
  await expect(page.locator('.wall-screen')).toHaveAttribute('aria-busy', 'false')
  await page.getByTestId('wall-edge-0').click({ force: true })
  await expect(page.getByLabel('壁の高さ（mm）')).toHaveValue('2400')
  await expect(page.getByLabel('クロスの有効幅（mm）')).toHaveValue('')
  await expect(page.getByRole('img', { name: '壁の展開図' })).toBeVisible()
  await page.getByLabel('クロス名', { exact: true }).fill('ストレートクロス')
  await page.getByLabel('クロスの有効幅（mm）').fill('920')
  await expect(page.getByTestId('wall-totals')).toContainText('12.5m')
  await page.getByLabel('縦リピート（mm）', { exact: true }).fill('640')
  await page.getByLabel('クロスの柄合わせ', { exact: true }).selectOption('straight')
  await expect(page.getByTestId('wall-totals')).toContainText('13.4m')
  await page.getByLabel('クロスの柄合わせ', { exact: true }).selectOption('step')
  await page.getByRole('button', { name: '縦リピートの半分にする', exact: true }).click()
  await page.getByLabel('クロスの巻き長さ（mm・任意）').fill('6300')
  await expect(page.getByTestId('wall-totals')).toContainText('3巻')
  // Add a door: area drops, material consumption keeps full-height drops.
  await page.getByRole('button', { name: '窓・ドアを追加', exact: true }).click()
  await expect(page.getByTestId('wall-totals')).toContainText('8.0㎡')
  await page.getByLabel('左端から（mm）', { exact: true }).fill('500')
  const side = page.getByLabel('壁材の貼り始め')
  const firstDrop = page
    .getByRole('img', { name: '壁の展開図' })
    .locator('g[data-drop-number="1"] rect')
  const firstX = Number(await firstDrop.getAttribute('x'))
  await side.selectOption('right')
  assert.ok(Number(await firstDrop.getAttribute('x')) > firstX)
  await expect(page.getByLabel('左端から（mm）', { exact: true })).toHaveValue('500')
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  await expect(side).toHaveValue('left')
  await side.selectOption('right')
  const beforeTotals = await page.getByTestId('wall-totals').innerText()
  await page.getByRole('button', { name: '左右を反転する', exact: true }).click()
  await expect(page.getByLabel('左端から（mm）', { exact: true })).toHaveValue('2700')
  // Plan panning cannot move the wall.
  const overlay = page.getByTestId('wall-plan'),
    box = await overlay.boundingBox()
  const points = () => overlay.locator('g[pointer-events="none"] line').getAttribute('x1')
  const x1 = await points()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  assert.equal(await points(), x1)
  assert.equal(await page.getByTestId('wall-totals').innerText(), beforeTotals)
  await page.getByRole('button', { name: '壁の割り付けを保存', exact: true }).click()
  await expect(page.locator('.wall-screen').getByRole('status')).toContainText('保存しました')
  const readWalls = () =>
    page.evaluate(async () => {
      const w = (await window.sekisan.workspace()).data
      const r = await window.sekisan.readWalls({ drawingId: w.drawings[0].id, pageNumber: 1 })
      if (!r.ok) throw Error(r.error)
      return r.data
    })
  const saved = (await readWalls())[0]
  assert.equal(saved.body.startSide, 'right')
  assert.equal(saved.body.material.match, 'step')
  assert.equal(saved.body.openings[0].xMm, 2700)
  assert.deepEqual(await snapshot(), before)
  await page.locator('.wall-settings').evaluate((e) => (e.scrollTop = 0))
  await page.locator('.wall-details').evaluate((e) => (e.scrollTop = 0))
  await page.screenshot({ path: 'test-results/wall-layout.png' })
  // PDF preview and real file.
  await page.getByRole('button', { name: '壁のPDFプレビュー・保存', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await page.screenshot({ path: 'test-results/wall-pdf-preview.png' })
  const pdfOut = join(temporary, 'wall.pdf')
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, pdfOut)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const pages = await inspectPdf(readFileSync(pdfOut), true)
  assert.match(pages.join(''), /壁クロス割り付け/)
  assert.match(pages.join(''), /ステップ/)
  assert.match(pages.join(''), /右から/)
  assert.match(pages.join(''), /8.0/)
  writeFileSync('test-results/wall-layout.pdf', readFileSync(pdfOut))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  // Saved document survives mode changes; dirty navigation can be canceled.
  await page.getByLabel('壁の高さ（mm）').fill('2500')
  await page.getByRole('button', { name: '床材', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '操作の確認' })).toBeVisible()
  await page.getByRole('button', { name: '戻る', exact: true }).click()
  await expect(page.getByLabel('壁の高さ（mm）')).toHaveValue('2500')
  await page.getByRole('button', { name: '床材', exact: true }).click()
  await page.getByRole('button', { name: '続ける', exact: true }).click()
  await page.getByRole('button', { name: '壁材', exact: true }).click()
  await expect(page.getByLabel('壁の高さ（mm）')).toHaveValue('2400')
  await expect(side).toHaveValue('right')
  // Material master stores wallpaper dimensions and Enter never submits.
  await page.getByRole('button', { name: '仕上げ材マスタを開く', exact: true }).click()
  const master = page.getByRole('dialog', { name: '仕上げ材マスタ', exact: true })
  await master.getByRole('button', { name: '材料を追加', exact: true }).click()
  await master.getByLabel('材料の部位', { exact: true }).selectOption('wall')
  await master.getByLabel('材料名・仕様', { exact: true }).fill('登録クロス')
  await master.getByLabel('クロスの有効幅・リピートを設定する', { exact: true }).check()
  await master.getByLabel('クロスの有効幅（mm）').fill('900')
  await master.getByLabel('クロスの有効幅（mm）').press('Enter')
  await expect(master.getByRole('button', { name: '材料を保存', exact: true })).toBeVisible()
  await master.getByLabel('縦リピート（mm）', { exact: true }).fill('600')
  await master.getByLabel('クロスの柄合わせ', { exact: true }).selectOption('straight')
  await master.getByRole('button', { name: '材料を保存', exact: true }).click()
  await expect(master.getByText('登録クロス', { exact: true })).toBeVisible()
  await master.getByRole('button', { name: '閉じる', exact: true }).last().click()
  const option = page
    .getByLabel('壁クロスの材料')
    .locator('option')
    .filter({ hasText: '登録クロス' })
  await page.getByLabel('壁クロスの材料').selectOption(await option.getAttribute('value'))
  await expect(page.getByLabel('クロスの有効幅（mm）')).toHaveValue('900')
  await page.getByRole('button', { name: '壁の割り付けを保存', exact: true }).click()
  await expect(page.locator('.wall-screen').getByRole('status')).toContainText('保存しました')
  // Manual two-point wall, independent of room polygons, and guarded deletion.
  await page.getByRole('button', { name: '2点で壁を指定する', exact: true }).click()
  const clickPoint = async (x, y) => {
    const b = await overlay.boundingBox()
    const v = await overlay.getAttribute('viewBox')
    const [, , w, h] = v.split(' ').map(Number)
    await page.mouse.click(b.x + (x / w) * b.width, b.y + (y / h) * b.height)
  }
  await clickPoint(250, 200)
  await clickPoint(400, 200)
  await expect(page.getByLabel('壁の名前')).toHaveValue('壁 2')
  await page.getByRole('button', { name: '壁の割り付けを保存', exact: true }).click()
  await expect(page.locator('.wall-screen').getByRole('status')).toContainText('保存しました')
  assert.equal((await readWalls()).length, 2)
  assert.equal((await readWalls())[1].body.roomId, null)
  await page.getByRole('button', { name: 'この壁を削除', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '壁の割り付けを削除' })).toBeVisible()
  await page.getByRole('button', { name: '戻る', exact: true }).click()
  assert.equal((await readWalls()).length, 2)
  await page.getByRole('button', { name: 'この壁を削除', exact: true }).click()
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '壁の割り付けを削除' })).toHaveCount(0)
  assert.equal((await readWalls()).length, 1)
  assert.deepEqual(await snapshot(), before)
  console.log(
    'PASS 壁クロス: 一辺の展開・2点指定・無地/リピート/ステップ・巻割り・開口・反転・右パン・マスタEnter・保存再表示・PDF保存・未保存保護・削除確認・元数量保持'
  )
} catch (error) {
  console.error(error)
  const page = await application?.firstWindow()
  await page?.screenshot({ path: 'test-results/wall-failure.png' })
  await application?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  throw error
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
