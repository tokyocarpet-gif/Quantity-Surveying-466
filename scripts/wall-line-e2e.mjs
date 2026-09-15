import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
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
mkdirSync('test-results', { recursive: true })
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
  const overlay = page.getByTestId('drawing-overlay')
  await expect(overlay).toBeVisible()
  async function point(x, y) {
    const box = await overlay.boundingBox()
    const [, , w, h] = (await overlay.getAttribute('viewBox')).split(' ').map(Number)
    await overlay.click({ position: { x: (x / w) * box.width, y: (y / h) * box.height } })
  }
  async function confirm() {
    await page.getByRole('button', { name: '数量を確認', exact: true }).click()
    await expect(page.getByText(/既存の部屋の壁数量からは自動控除しません/)).toBeVisible()
    await page.getByRole('button', { name: '反映する', exact: true }).click()
    await expect(page.locator('.room-form')).toHaveCount(0)
  }
  await page.getByRole('checkbox', { name: '矩形', exact: true }).check()
  await page.getByRole('button', { name: '壁（線）', exact: true }).click()
  await point(100, 100)
  await expect(page.getByRole('button', { name: '確定', exact: true })).toBeDisabled()
  await point(500, 100)
  await page.getByRole('button', { name: '確定', exact: true }).click()
  await expect(page.getByRole('heading', { name: '壁の線を登録', exact: true })).toBeVisible()
  await page.getByLabel('部屋名', { exact: true }).fill('アクセント壁')
  await page.getByRole('combobox', { name: '壁の仕上げ', exact: true }).fill('アクセントクロス')
  await page.getByLabel('壁の単価', { exact: true }).fill('1000')
  await expect(page.getByLabel('床を拾う', { exact: true })).toHaveCount(0)
  await expect(page.locator('.finish-input')).toContainText('9.6 ㎡')
  await confirm()
  await expect(page.getByTestId('quantity-wall')).toContainText('9.6 ㎡')
  const line = overlay.locator('polyline[data-room-id]')
  await expect(line).toHaveCount(1)
  await expect(line).toHaveAttribute('fill', 'none')
  await page.getByRole('button', { name: '壁の線を編集', exact: true }).click()
  await page.getByRole('button', { name: '形状を描き直す', exact: true }).click()
  await expect(page.getByRole('button', { name: '壁（線）', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await point(100, 100)
  await point(500, 100)
  const draft = overlay.locator('polyline[stroke-dasharray="5 3"]')
  const before = (await draft.getAttribute('points')).split(' ').slice(0, 2)
  const box = await overlay.boundingBox()
  await page.mouse.move(box.x + 250, box.y + 200)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(box.x + 280, box.y + 220, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  const after = (await draft.getAttribute('points')).split(' ').slice(0, 2)
  assert.deepEqual(after, before, '右パンで点を追加しない')
  await point(500, 400)
  await page.keyboard.press('Enter')
  await expect(page.locator('.finish-input')).toContainText('16.8 ㎡')
  await confirm()
  await expect(page.getByTestId('quantity-wall')).toContainText('16.8 ㎡')
  await page.getByRole('button', { name: '開口控除', exact: true }).click()
  await page.getByRole('textbox', { name: '開口名', exact: true }).fill('ドア')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByTestId('quantity-wall')).toContainText('15 ㎡')
  await page.getByRole('button', { name: '壁の線を編集', exact: true }).click()
  await page.getByRole('combobox', { name: '壁の仕上げ', exact: true }).fill('養生')
  await page.getByRole('option', { name: /養生プラベニア/ }).click()
  await expect(page.getByLabel('壁の拾い方', { exact: true })).toHaveValue('m')
  await expect(page.locator('.finish-input')).toContainText('7 m')
  await confirm()
  await expect(page.getByTestId('quantity-wall')).toContainText('6.1 m')
  await page.screenshot({ path: 'test-results/wall-lines.png' })
  // Persisted room geometry is an open chain; original area room remains intact.
  const saved = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
  })
  const wall = saved.rooms.find((r) => r.name === 'アクセント壁')
  assert.equal(wall.geometryType, 'wall-line')
  assert.equal(wall.polygon.length, 3)
  assert.equal(saved.items.find((i) => i.roomId !== wall.id).quantity, 33.6)
  await page.getByRole('button', { name: '図面一覧に戻る', exact: true }).click()
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.getByText('アクセント壁', { exact: true })).toHaveCount(0)
  console.log(
    'PASS 壁（線）: 2点1面・3点2面 / 開いた線 / Enter確定・右パン / 再描画 / ㎡・m / 控除 / 既存壁維持 / 床割付対象外'
  )
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
