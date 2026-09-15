import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-wall-length-'))
const pdfPath = join(temporary, '壁の延長.pdf')
const pdf = await PDFDocument.create()
pdf.addPage([842, 595])
writeFileSync(pdfPath, await pdf.save())
const env = { ...process.env, SEKISAN_DATA_DIR: join(temporary, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let application
try {
  application = await electron.launch({ args: ['.'], cwd: resolve('.'), env })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: '顧客を追加', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '顧客を追加', exact: true }).click()
  await page.getByRole('textbox', { name: '顧客名' }).fill('延長テスト')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '案件を作成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '案件名' }).fill('ボーダー工事')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '仕上げ材マスタ', exact: true }).click()
  await page.getByRole('button', { name: '材料を追加', exact: true }).click()
  await page.getByLabel('材料の部位', { exact: true }).selectOption('wall')
  await page.getByLabel('材料名・仕様', { exact: true }).fill('養生プラベニア')
  await page.getByLabel('材料の単位', { exact: true }).selectOption('m')
  await page.getByLabel('材料の単価', { exact: true }).fill('500')
  await page.getByRole('button', { name: '材料を保存', exact: true }).click()
  await page
    .locator('.takeoff-dialog > .modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, pdfPath)
  await page.getByRole('button', { name: '図面を取り込む', exact: true }).click()
  await expect(page.getByRole('button', { name: '壁の延長.pdf', exact: true })).toBeVisible()
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
            name: '養生範囲',
            color: '#327e6d',
            heightMm: 2400,
            polygon,
            enabledCategories: ['wall'],
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
  await page.getByRole('button', { name: '壁の延長.pdf', exact: true }).click()
  await page.getByTestId('room-card').click()
  await expect(page.getByTestId('quantity-wall')).toContainText('33.6')
  await page.getByRole('button', { name: '部屋を編集', exact: true }).click()
  await page.getByRole('combobox', { name: '壁の仕上げ', exact: true }).fill('養生')
  await page.getByRole('option', { name: /養生プラベニア/ }).click()
  await expect(page.getByLabel('壁の拾い方', { exact: true })).toHaveValue('m')
  await expect(page.locator('.finish-input')).toContainText('14 m')
  await expect(page.locator('.price-label')).toContainText('円/m')
  await page.getByLabel('天井・壁高さ（mm）', { exact: true }).fill('3000')
  await expect(page.locator('.finish-input')).toContainText('14 m')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(page.locator('.quantity-preview')).toContainText('33.6 ㎡')
  await expect(page.getByText(/壁を㎡からmへ変更/)).toBeVisible()
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByTestId('quantity-wall')).toContainText('14 m')
  await expect(page.getByTestId('room-card')).toContainText('14 m')
  await page.getByRole('button', { name: '開口控除', exact: true }).click()
  await page.getByRole('textbox', { name: '開口名', exact: true }).fill('入口')
  // Default opening width is 900mm; height is irrelevant for length deductions.
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByTestId('quantity-wall')).toContainText('13.1 m')
  const saved = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
  })
  assert.equal(saved.rooms[0].finishes.wall.unit, 'm')
  assert.equal(saved.items[0].method, 'room-perimeter')
  await page.getByRole('button', { name: '部屋を編集', exact: true }).click()
  await expect(page.getByLabel('壁の拾い方', { exact: true })).toHaveValue('m')
  await page.getByLabel('壁の拾い方', { exact: true }).selectOption('㎡')
  await expect(page.locator('.finish-input')).toContainText('42 ㎡')
  await page.getByRole('button', { name: '編集をやめる', exact: true }).click()
  await expect(page.getByTestId('quantity-wall')).toContainText('13.1 m')
  console.log(
    'PASS 壁の延長m: マスタ登録・選択 / 高さ非依存 / 旧㎡比較 / 保存再表示 / 開口幅控除 / 変更キャンセル'
  )
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
