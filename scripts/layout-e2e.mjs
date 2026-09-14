import { exerciseRollLayout } from './roll-layout-e2e.mjs'
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
async function verifyRightPan(page) {
  const host = page.locator('.layout-screen .pdf-scroll')
  await expect(host).toHaveAttribute('aria-busy', 'false')
  const surface = host.locator('.drawing-surface')
  const box = await host.boundingBox(),
    before = await surface.boundingBox()
  const start = { x: box.x + 6, y: box.y + 6 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(start.x + 2, start.y + 1)
  await expect
    .poll(async () => Math.abs((await surface.boundingBox()).x - before.x - 2))
    .toBeLessThan(0.5)
  await expect(host).toHaveClass(/dragging/)
  // Leave the drawing viewport over the sidebar, then release there.
  await page.mouse.move(box.x - 20, start.y + 40, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  await expect
    .poll(async () => Math.abs((await surface.boundingBox()).x - before.x + 26))
    .toBeLessThan(0.5)
  await expect
    .poll(async () => Math.abs((await surface.boundingBox()).y - before.y - 40))
    .toBeLessThan(0.5)
  await expect(host).not.toHaveClass(/dragging/)
  const released = await surface.boundingBox()
  await page.mouse.move(start.x + 40, start.y + 60)
  await expect.poll(async () => (await surface.boundingBox()).x).toBe(released.x)
}
export async function exerciseLayout(page, application, temporary) {
  await expect(page.getByRole('button', { name: '床材を割り付け', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '図面一覧に戻る', exact: true }).click()
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  const editor = page.locator('.layout-screen')
  await expect(page.locator('.takeoff-viewer')).toHaveCount(0)
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(editor).toHaveAttribute('aria-busy', 'false')
  await expect(
    editor.locator('.layout-settings').getByLabel('割り付けの部屋', { exact: true })
  ).toBeVisible()
  await expect(
    editor.locator('.layout-page-header').getByLabel('割り付けの部屋', { exact: true })
  ).toHaveCount(0)
  await expect(page.getByLabel('割付の幅（mm）', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('割付の長さ（mm）', { exact: true })).toHaveValue('')
  await expect(editor.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await expect(page.getByTestId('layout-overlay').locator('g[clip-path] polygon')).toHaveCount(0)
  await verifyRightPan(page)
  await page.getByRole('button', { name: '全体表示', exact: true }).click()
  await page.screenshot({ path: 'test-results/33-layout-empty-dimensions.png' })
  await editor.getByRole('button', { name: '材料マスタで寸法を設定', exact: true }).click()
  await page.getByRole('button', { name: '材料を追加', exact: true }).click()
  await page.getByLabel('材料名・仕様', { exact: true }).fill('割付テスト床タイル')
  await page.getByLabel('材料の仕様', { exact: true }).fill('品番ABC')
  await expect(page.getByRole('button', { name: '500×500', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '規格の寸法を読み取る', exact: true })).toHaveCount(
    0
  )
  await expect(page.getByLabel('材料の目地幅（mm）', { exact: true })).toHaveCount(0)
  await expect(page.locator('.tile-dimensions input')).toHaveCount(3)
  await expect(page.locator('.tile-dimensions input').nth(0)).toHaveAttribute(
    'aria-label',
    '材料の幅（mm）'
  )
  await expect(page.locator('.tile-dimensions input').nth(1)).toHaveAttribute(
    'aria-label',
    '材料の長さ（mm）'
  )
  await expect(page.locator('.tile-dimensions input').nth(2)).toHaveAttribute(
    'aria-label',
    '材料の厚み（mm）'
  )
  await page.getByLabel('材料の幅（mm）', { exact: true }).fill('450')
  await page.getByLabel('材料の長さ（mm）', { exact: true }).fill('900')
  await page.getByLabel('材料の厚み（mm）', { exact: true }).fill('2.5')
  await page.screenshot({ path: 'test-results/30-layout-material.png' })
  await page.getByRole('button', { name: '材料を保存', exact: true }).click()
  await expect(page.locator('.master-list')).toContainText(
    '規格：幅 450 mm × 長さ 900 mm × 厚み 2.5 mm'
  )
  await page.getByRole('button', { name: '材料を追加', exact: true }).click()
  await page.getByLabel('材料名・仕様', { exact: true }).fill('寸法未登録の床材')
  await page.getByRole('button', { name: '材料を保存', exact: true }).click()
  await expect(page.locator('.master-list')).toContainText('寸法未登録の床材')
  await page.getByRole('button', { name: '材料を追加', exact: true }).click()
  await page.getByLabel('材料名・仕様', { exact: true }).fill('幅のみ登録の床材')
  await page.getByLabel('材料の幅（mm）', { exact: true }).fill('450')
  await page.getByRole('button', { name: '材料を保存', exact: true }).click()
  await expect(page.locator('.master-list')).toContainText('幅のみ登録の床材')

  await page
    .locator('.master-body')
    .locator('..')
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await page.getByLabel('割付の材料', { exact: true }).fill('割付テスト')
  await page.getByRole('option', { name: /割付テスト床タイル/ }).click()
  await expect(page.getByLabel('割付の幅（mm）', { exact: true })).toHaveValue('450')
  await expect(page.getByLabel('割付の長さ（mm）', { exact: true })).toHaveValue('900')
  await expect(page.getByLabel('割付の目地幅（mm）', { exact: true })).toHaveValue('0')
  await page.getByLabel('割付の目地幅（mm）', { exact: true }).fill('2')
  await page.getByLabel('割付の材料', { exact: true }).fill('幅のみ登録')
  await page.getByRole('option', { name: /幅のみ登録の床材/ }).click()
  await expect(page.getByLabel('割付の幅（mm）', { exact: true })).toHaveValue('450')
  await expect(page.getByLabel('割付の長さ（mm）', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('割付の目地幅（mm）', { exact: true })).toHaveValue('2')
  await expect(editor.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await page.getByLabel('割付の材料', { exact: true }).fill('寸法未登録')
  await page.getByRole('option', { name: /寸法未登録の床材/ }).click()
  await expect(page.getByLabel('割付の目地幅（mm）', { exact: true })).toHaveValue('2')
  await expect(page.getByLabel('割付の幅（mm）', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('割付の長さ（mm）', { exact: true })).toHaveValue('')
  await expect(editor.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await page.getByLabel('割付の幅（mm）', { exact: true }).fill('300')
  await expect(editor.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await page.getByLabel('割付の長さ（mm）', { exact: true }).fill('600')
  await expect(editor.getByRole('button', { name: '割り付けを保存', exact: true })).toBeEnabled()
  await page.getByLabel('割付の幅（mm）', { exact: true }).fill('')
  await expect(page.getByLabel('割付の幅（mm）', { exact: true })).toHaveValue('')
  await expect(editor.getByRole('button', { name: '割り付けを保存', exact: true })).toBeDisabled()
  await page.getByLabel('割付の材料', { exact: true }).fill('割付テスト')
  await page.getByRole('option', { name: /割付テスト床タイル/ }).click()
  await expect(page.getByLabel('割付の幅（mm）', { exact: true })).toHaveValue('450')
  await expect(page.getByLabel('割付の長さ（mm）', { exact: true })).toHaveValue('900')

  const centerDistances = await page.evaluate(async () => {
    const roomId = document.querySelector('[aria-label="割り付けの部屋"]').value
    const w = (await window.sekisan.workspace()).data
    const state = (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 }))
      .data
    const room = state.rooms.find((r) => r.id === roomId)
    return [
      (Math.max(...room.polygon.map((p) => p.x)) - Math.min(...room.polygon.map((p) => p.x))) *
        state.scaleRatio *
        500,
      (Math.max(...room.polygon.map((p) => p.y)) - Math.min(...room.polygon.map((p) => p.y))) *
        state.scaleRatio *
        500
    ]
  })
  const dimension = (key) => page.getByTestId(`dimension-${key}`).locator('dd')
  const textMm = (n) => n.toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + ' mm'
  await expect(dimension('x-minus')).toHaveText(textMm(centerDistances[0]))
  await expect(dimension('x-plus')).toHaveText(textMm(centerDistances[0]))
  await expect(dimension('y-minus')).toHaveText(textMm(centerDistances[1]))
  await expect(dimension('y-plus')).toHaveText(textMm(centerDistances[1]))
  await page.getByLabel('横の移動量（mm）', { exact: true }).fill('100')
  await expect(dimension('x-minus')).toHaveText(textMm(centerDistances[0] + 100))
  await expect(dimension('x-plus')).toHaveText(textMm(centerDistances[0] - 100))
  await page.getByLabel('寸法線を表示', { exact: true }).uncheck()
  await expect(page.getByTestId('layout-wall-dimensions')).toHaveCount(0)
  await page.getByLabel('寸法線を表示', { exact: true }).check()
  await expect(page.getByTestId('layout-wall-dimensions')).toBeVisible()
  const dimensionHost = editor.locator('.pdf-scroll'),
    dimensionBox = await dimensionHost.boundingBox()
  await page.mouse.move(
    dimensionBox.x + dimensionBox.width / 2,
    dimensionBox.y + dimensionBox.height / 2
  )
  await page.mouse.wheel(0, -100)
  await expect(dimension('x-minus')).toHaveText(textMm(centerDistances[0] + 100))
  await page.getByRole('button', { name: '全体表示', exact: true }).click()
  await page.getByRole('region', { name: '基準点から壁までの寸法' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/35-layout-wall-dimensions.png' })
  await page.getByLabel('横の移動量（mm）', { exact: true }).fill(String(centerDistances[0] * 3))
  await expect(
    page.getByText('基準点が部屋の外にあります。部屋の内側へ移動してください。', { exact: true })
  ).toBeVisible()
  await expect(page.getByTestId('layout-wall-dimensions')).toHaveCount(0)
  await page.getByLabel('横の移動量（mm）', { exact: true }).fill('0')
  await page.getByRole('button', { name: '芯跨ぎ 中心に材料', exact: true }).click()
  await expect(page.getByLabel('割付の横方向の基準', { exact: true })).toHaveValue('tile')
  await page.getByRole('button', { name: '芯割り 中心に目地', exact: true }).click()
  await page.getByRole('button', { name: '壁寄せ 壁から真物', exact: true }).click()
  await page.getByLabel('割付の基準壁', { exact: true }).selectOption('1')
  await page.getByLabel('割付の移動幅', { exact: true }).selectOption('1')
  await page.getByRole('button', { name: '割付を右へ移動', exact: true }).click()
  await expect(page.getByLabel('横の移動量（mm）', { exact: true })).toHaveValue('1')
  const host = editor.locator('.pdf-scroll'),
    overlay = page.getByTestId('layout-overlay')
  await expect(host).toHaveAttribute('aria-busy', 'false')
  const box = await host.boundingBox(),
    before = await overlay.boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  await expect
    .poll(async () => Math.abs((await overlay.boundingBox()).x - before.x - 40))
    .toBeLessThan(1)
  await expect(page.getByLabel('横の移動量（mm）', { exact: true })).toHaveValue('1')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 25, start.y + 12, { steps: 4 })
  await page.mouse.up()
  await expect
    .poll(async () =>
      Number(await page.getByLabel('横の移動量（mm）', { exact: true }).inputValue())
    )
    .not.toBe(1)
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  await expect(page.getByLabel('横の移動量（mm）', { exact: true })).toHaveValue('1')
  await verifyRightPan(page)
  await expect(page.getByLabel('横の移動量（mm）', { exact: true })).toHaveValue('1')
  await overlay.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByLabel('縦の移動量（mm）', { exact: true })).toHaveValue('1')
  await page.getByLabel('壁からの回転（°）', { exact: true }).fill('15')
  await page.screenshot({ path: 'test-results/31-layout-preview.png' })
  await page.getByRole('button', { name: '割り付けを保存', exact: true }).click()
  await expect(page.getByText('割り付けを保存しました。', { exact: true })).toBeVisible()
  const doc = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    const state = (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 }))
      .data
    for (const room of state.rooms) {
      const r = await window.sekisan.readLayout(room.id)
      if (r.data) return r.data
    }
  })
  assert.equal(doc.body.specification, '品番ABC ／ 450×900×2.5 mm')
  assert.equal(doc.body.widthMm, 450)
  assert.equal(doc.body.gapMm, 2)
  assert.equal(doc.body.mode, 'wall')
  assert.equal(doc.body.angle, 15)
  await editor
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '図面一覧へ', exact: true })
    .click()
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.getByLabel('壁からの回転（°）', { exact: true })).toHaveValue('15')
  await page.getByLabel('割り付けのページ', { exact: true }).selectOption('2')
  await expect(
    page.getByRole('heading', { name: 'このページに拾い出した部屋がありません', exact: true })
  ).toBeVisible()
  await expect(page.getByLabel('割り付けの部屋', { exact: true })).toBeDisabled()
  await verifyRightPan(page)
  await page.getByLabel('割り付けのページ', { exact: true }).selectOption('1')
  await expect(page.getByLabel('壁からの回転（°）', { exact: true })).toHaveValue('15')
  await page.getByLabel('横の移動量（mm）', { exact: true }).fill('123')
  await page.getByLabel('割り付けのページ', { exact: true }).selectOption('2')
  await expect(
    page.getByRole('heading', { name: '割り付けに未保存の変更があります', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '編集を続ける', exact: true }).click()
  await expect(page.getByLabel('割り付けのページ', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('横の移動量（mm）', { exact: true })).toHaveValue('123')

  await editor
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '図面一覧へ', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '割り付けに未保存の変更があります', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '破棄して移動', exact: true }).click()
  const finalDoc = await exerciseRollLayout(page, doc, verifyRightPan, application, temporary)
  console.log(
    'PASS 割付: 仕様・幅長さ厚みの自由入力・マスタ選択・割付ごとの目地 / 芯割り・芯跨ぎ・壁寄せ / 右パン・左ドラッグ・1mm移動・回転・戻す / 保存・再表示・未保存破棄'
  )
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の拾い出し$/ })
    .click()
  await expect(page.getByTestId('drawing-overlay')).toBeVisible()
  return finalDoc
}
