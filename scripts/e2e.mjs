import { exerciseLayout } from './layout-e2e.mjs'
import { exerciseSummaryPdf } from './summary-pdf-e2e.mjs'
import { exercisePdf } from './pdf-e2e.mjs'
import { exerciseExcel } from './xlsx-e2e.mjs'
import { exerciseCounts, verifyCounts } from './count-e2e.mjs'
import { exerciseBusiness } from './business-e2e.mjs'
import { exerciseEstimate, verifySavedEstimate } from './estimate-e2e.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { exerciseSummary } from './summary-e2e.mjs'
import { exerciseTakeoff, verifySavedTakeoff } from './takeoff-e2e.mjs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve('.')
const temporary = mkdtempSync(join(tmpdir(), 'sekisan-e2e-'))
const dataRoot = join(temporary, 'app-data')
const pdfPath = join(temporary, '図面 サンプル.pdf')
const backupPath = join(temporary, 'test.sekisan-backup')
const document = await PDFDocument.create()
const font = await document.embedFont(StandardFonts.Helvetica)
for (let i = 0; i < 2; i++) {
  const page = document.addPage([842, 595])
  page.drawText(`OFFICE RENOVATION / FLOOR ${i + 1}`, {
    x: 55,
    y: 540,
    size: 20,
    font,
    color: rgb(0.18, 0.27, 0.23)
  })
  page.drawRectangle({
    x: 80,
    y: 90,
    width: 650,
    height: 390,
    borderWidth: 3,
    borderColor: rgb(0.22, 0.3, 0.28)
  })
  page.drawLine({
    start: { x: 430, y: 90 },
    end: { x: 430, y: 480 },
    thickness: 2,
    color: rgb(0.3, 0.38, 0.33)
  })
  page.drawLine({
    start: { x: 80, y: 280 },
    end: { x: 430, y: 280 },
    thickness: 2,
    color: rgb(0.3, 0.38, 0.33)
  })
  page.drawText('MEETING ROOM', { x: 180, y: 370, size: 15, font })
  page.drawText('OFFICE', { x: 530, y: 290, size: 15, font })
  page.drawText('ENTRANCE', { x: 190, y: 180, size: 15, font })
}
writeFileSync(pdfPath, await document.save())
mkdirSync('test-results', { recursive: true })
const env = { ...process.env, SEKISAN_DATA_DIR: dataRoot }
delete env.ELECTRON_RUN_AS_NODE
if (process.env.SEKISAN_E2E_RENDERER_URL)
  env.ELECTRON_RENDERER_URL = process.env.SEKISAN_E2E_RENDERER_URL
else delete env.ELECTRON_RENDERER_URL
let application
const errors = []
async function launch() {
  application = await electron.launch({ args: ['.'], cwd: root, env, timeout: 30000 })
  application
    .process()
    .stderr.on('data', (data) => writeFileSync('test-results/electron.log', data, { flag: 'a' }))
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByRole('button', { name: '顧客を追加', exact: true })).toBeVisible({
    timeout: 20000
  })
  return page
}
try {
  let page = await launch()
  await page.screenshot({ path: 'test-results/01-empty.png' })
  await page.getByRole('button', { name: '顧客を追加', exact: true }).click()
  await page.getByRole('textbox', { name: '顧客名' }).fill('東京カーペット株式会社')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '東京カーペット株式会社', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '案件を作成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '案件名' }).fill('本社ビル 3階 内装改修工事')
  await page.getByLabel('案件の担当者', { exact: true }).fill('山田 太郎')
  await page
    .getByRole('textbox', { name: '案件メモ' })
    .fill('施工場所：東京都千代田区\n現地確認後に拾い出しを開始')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByRole('heading', { name: /本社ビル 3階 内装改修工事/ })).toBeVisible()
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, pdfPath)
  await page.getByRole('button', { name: '図面を取り込む', exact: true }).click()
  await expect(page.getByRole('button', { name: '図面 サンプル.pdf', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/02-drawings.png' })
  await page.getByRole('button', { name: '図面 サンプル.pdf', exact: true }).click()
  await expect(page.getByLabel('図面 1ページ')).toBeVisible()
  await expect(page.getByText('図面を読み込んでいます…')).toHaveCount(0, { timeout: 20000 })
  assert.equal(
    await page.locator('canvas').evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      return data.some((value, index) => index % 4 !== 3 && value < 180)
    }),
    true,
    'PDF contains rendered drawing pixels'
  )
  await exerciseTakeoff(page)
  const savedLayout = await exerciseLayout(page, application, temporary)
  await page.getByRole('button', { name: '次のページ', exact: true }).click()
  await expect(page.getByLabel('図面 2ページ')).toBeVisible()
  await expect(page.getByText('図面を読み込んでいます…')).toHaveCount(0)
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: 'test-results/03-pdf.png' })
  await page.getByRole('button', { name: '図面一覧に戻る', exact: true }).click()
  await exerciseSummary(page, application, temporary)
  await exerciseBusiness(page)
  await exerciseEstimate(page)
  await exerciseCounts(page)
  await exerciseSummaryPdf(page, application, temporary)
  await exercisePdf(page, application, temporary)
  await exerciseExcel(page, application, temporary)
  await page.getByRole('button', { name: '案件を編集', exact: true }).click()
  await expect(page.getByLabel('案件の担当者', { exact: true })).toHaveValue('山田 太郎')
  await page.getByLabel('案件の担当者', { exact: true }).fill('佐藤 次郎')
  await page.getByLabel('状態', { exact: true }).selectOption('completed')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.locator('.page-top .badge')).toHaveText('完了')
  await expect(page.locator('.page-top')).toContainText('担当：佐藤 次郎')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, backupPath)
  await page.getByRole('button', { name: '設定・データ管理', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('バックアップを保存しました', { exact: true })).toBeVisible()
  assert.ok(existsSync(backupPath))
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '案件を編集', exact: true }).click()
  await page.getByRole('textbox', { name: '案件名' }).fill('復元前の変更')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByRole('heading', { name: /復元前の変更/ })).toBeVisible()
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, backupPath)
  await page.getByRole('button', { name: '設定・データ管理', exact: true }).click()
  await page.getByRole('button', { name: '復元', exact: true }).click()
  await expect(
    page.getByText('バックアップを復元しました。復元前のデータは退避済みです。')
  ).toBeVisible()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(page.getByRole('heading', { name: /本社ビル 3階 内装改修工事/ })).toBeVisible()
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined')
  assert.equal(await page.evaluate(() => 'ipcRenderer' in window.sekisan), false)
  await application.close()
  application = undefined
  rmSync(pdfPath)
  page = await launch()
  await expect(page.getByRole('heading', { name: /本社ビル 3階 内装改修工事/ })).toBeVisible()
  await expect(page.locator('.page-top .badge')).toHaveText('完了')
  await expect(page.locator('.page-top')).toContainText('担当：佐藤 次郎')
  await page.getByRole('button', { name: '図面 サンプル.pdf', exact: true }).click()
  await expect(page.getByText('図面を読み込んでいます…')).toHaveCount(0)
  await expect(page.locator('canvas')).toBeVisible()
  await verifySavedTakeoff(page)
  await page.getByRole('button', { name: '図面一覧に戻る', exact: true }).click()
  await verifySavedEstimate(page)
  assert.deepEqual(
    await page.evaluate(
      async (id) => (await window.sekisan.readLayout(id)).data,
      savedLayout.roomId
    ),
    savedLayout
  )
  await verifyCounts(page)
  await page.getByRole('button', { name: 'すべての案件', exact: false }).click()
  await expect(page.locator('.project-row')).toContainText('担当：佐藤 次郎')
  await page.screenshot({ path: 'test-results/04-workspace.png' })
  assert.deepEqual(errors, [])
  console.log(
    'PASS Electron E2E: 顧客・案件作成 / PDF取り込み・描画・ページ切替 / 編集 / バックアップ・復元 / 原本削除・再起動 / renderer分離 / 縮尺・部屋・控除・再計算・数量固定 / カーソル中心ズーム・右パン・直交描画 / 部位選択・履歴・同名統合 / 材料マスタ / 高さ履歴・袖壁・縮尺表示 / 物件集計・4表示・絞込・内訳・CSV / 自社情報 / 部位・単位追加・仕様 / 見積作成・編集・削除確認・税非表示・版履歴・復元 / 個数拾い・点編集・集計・見積・復元'
  )
} catch (error) {
  if (application) {
    const windows = application.windows()
    await windows[0]?.screenshot({ path: 'test-results/failure.png' }).catch(() => {})
    if (windows[0])
      writeFileSync('test-results/failure.html', await windows[0].content().catch(() => ''))
  }
  console.error('Renderer errors:', errors)
  throw error
} finally {
  if (application) await application.close()
  rmSync(temporary, { recursive: true, force: true })
}
