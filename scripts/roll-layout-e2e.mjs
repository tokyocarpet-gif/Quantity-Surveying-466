import { exerciseLayoutPdf } from './layout-pdf-e2e.mjs'
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
export async function exerciseRollLayout(page, tileDoc, verifyRightPan, application, temporary) {
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  const editor = page.locator('.layout-screen')
  await expect(editor).toHaveAttribute('aria-busy', 'false')
  const before = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
  })
  await page.getByRole('button', { name: '材料マスタで寸法を設定', exact: true }).click()
  for (const [type, name, width, length, thickness] of [
    ['sheet', '長尺シート試験', '1.82', '20', '2'],
    ['carpet', 'ロールカーペット試験', '3640', '30000', '6']
  ]) {
    await page.getByRole('button', { name: '材料を追加', exact: true }).click()
    await page.getByLabel('材料名・仕様', { exact: true }).fill(name)
    await page.getByLabel('材料の仕様', { exact: true }).fill('品番ROLL')
    await page.getByLabel('材料の種類', { exact: true }).selectOption(type)
    await page
      .getByLabel(`材料のW（${type === 'sheet' ? 'm' : 'mm'}）`, { exact: true })
      .fill(width)
    await page
      .getByLabel(`材料のL（${type === 'sheet' ? 'm' : 'mm'}）`, { exact: true })
      .fill(length)
    await page.getByLabel('材料のT（mm）', { exact: true }).fill(thickness)
    if (type === 'sheet') {
      await expect(page.getByLabel('材料のW（m）', { exact: true })).toHaveValue('1.8')
      await page.getByLabel('材料のW（m）', { exact: true }).focus()
      await expect(page.getByLabel('材料のW（m）', { exact: true })).toHaveValue('1.82')
      await page.getByLabel('材料の種類', { exact: true }).selectOption('carpet')
      await expect(page.getByLabel('材料のW（mm）', { exact: true })).toHaveValue('1820')
      await page.getByLabel('材料の種類', { exact: true }).selectOption('sheet')
      await expect(page.locator('input[name="tileWidthMm"]')).toHaveValue('1820')
    }
    await page.getByRole('button', { name: '材料を保存', exact: true }).click()
    await expect(page.locator('.master-list')).toContainText(name)
  }
  await page
    .locator('.master-body')
    .locator('..')
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await page.getByLabel('割付の材料', { exact: true }).fill('長尺シート試験')
  await page.getByRole('option', { name: /長尺シート試験/ }).click()
  await expect(page.getByLabel('割付の材料の種類', { exact: true })).toHaveValue('sheet')
  await expect(page.getByLabel('割付W（m）', { exact: true })).toHaveValue('1.8')
  await page.getByLabel('割付W（m）', { exact: true }).focus()
  await expect(page.getByLabel('割付W（m）', { exact: true })).toHaveValue('1.82')
  await expect(page.getByLabel('最大出荷L（m・任意）', { exact: true })).toHaveValue('20.0')
  await expect(page.getByLabel('割付の目地幅（mm）', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '壁寄せ 壁から真物', exact: true }).click()
  await page.getByLabel('割付の基準壁', { exact: true }).selectOption('0')
  await page.getByLabel('切りしろ（両端各・mm）', { exact: true }).fill('50')
  const room = before.rooms.find((r) => r.id === tileDoc.roomId)
  const width =
    (Math.max(...room.polygon.map((p) => p.x)) - Math.min(...room.polygon.map((p) => p.x))) *
    before.scaleRatio *
    1000
  const length =
    (Math.max(...room.polygon.map((p) => p.y)) - Math.min(...room.polygon.map((p) => p.y))) *
    before.scaleRatio *
    1000
  const count = Math.ceil(width / 1820),
    cutLength = Math.ceil(length + 100 - 1e-7),
    total = (count * cutLength) / 1000
  const table = page.getByRole('table', { name: 'シートの切り出し一覧', includeHidden: true })
  await expect(table.locator('tbody tr')).toHaveCount(count)
  await expect(page.getByTestId('roll-total-length')).toHaveText(`使用L合計 ${total.toFixed(1)} m`)
  await expect(page.getByTestId('roll-overlay')).toBeVisible()
  const labels = page.getByTestId('roll-sheet-dimensions')
  await expect(labels).toHaveCount(count)
  await expect(labels.first()).toContainText('W 1.8 m')
  await expect(labels.first()).toContainText('L 6.0 m')
  await expect(labels.first()).not.toContainText('切出し')
  await expect(labels.first()).not.toContainText('ロール')
  await expect(page.getByTestId('roll-size-summary')).toContainText(`× ${count}枚`)
  await expect(page.getByTestId('roll-count')).toContainText('L 20.0 m')
  await page.getByLabel('シートの実測寸法線を表示', { exact: true }).uncheck()
  await expect(labels).toHaveCount(0)
  await expect(page.getByTestId('roll-total-length')).toContainText(total.toLocaleString('ja-JP'))
  await page.getByLabel('シートの実測寸法線を表示', { exact: true }).check()
  await expect(labels).toHaveCount(count)
  await page.getByRole('button', { name: '全体表示', exact: true }).click()
  await expect(editor.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: 'test-results/36-sheet-layout.png' })
  await page.locator('.roll-cut-list summary').click()
  await expect(table).toBeVisible()
  await expect
    .poll(async () => {
      const host = await editor.locator('.pdf-scroll').boundingBox()
      const drawing = await editor.locator('.drawing-surface').boundingBox()
      return drawing.height - host.height + 48
    })
    .toBeLessThan(1)
  await expect(editor.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: 'test-results/38-roll-cut-list.png' })
  await page.locator('.roll-cut-list summary').click()
  await page.getByLabel('切りしろ（両端各・mm）', { exact: true }).fill('100')
  await expect(page.getByTestId('roll-total-length')).toHaveText(
    `使用L合計 ${(total + count * 0.1).toFixed(1)} m`
  )
  await page.getByLabel('最大出荷L（m・任意）', { exact: true }).fill('1')
  await expect(page.getByRole('alert')).toContainText('最大出荷Lを超えるシート')
  await expect(labels.first()).toContainText('L 6.0 m')
  await page.getByLabel('最大出荷L（m・任意）', { exact: true }).fill('')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('roll-count')).toContainText('L 未設定')
  await expect(labels.first()).toContainText('L 6.0 m')
  await expect(page.getByRole('button', { name: '割り付けを保存', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '割り付けを保存', exact: true }).click()
  await expect(page.getByText('割り付けを保存しました。', { exact: true })).toBeVisible()
  await editor
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '図面一覧へ', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '割り付けに未保存の変更があります', exact: true })
  ).toHaveCount(0)
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.getByLabel('最大出荷L（m・任意）', { exact: true })).toHaveValue('')
  await page.getByLabel('割付の材料', { exact: true }).fill('ロールカーペット試験')
  await page.getByRole('option', { name: /ロールカーペット試験/ }).click()
  await expect(page.getByLabel('割付の材料の種類', { exact: true })).toHaveValue('carpet')
  await expect(page.getByLabel('割付W（mm）', { exact: true })).toHaveValue('3640')
  await expect(page.getByLabel('最大出荷L（mm・任意）', { exact: true })).toHaveValue('30000')
  await page.getByLabel('切りしろ（両端各・mm）', { exact: true }).fill('50')
  await page.getByRole('button', { name: '敷く方向を90°回転', exact: true }).click()
  await expect(page.getByLabel('壁からの回転（°）', { exact: true })).toHaveValue('90')
  let quantities = await page.getByTestId('roll-total-length').innerText()
  await page.getByLabel('最大出荷L内で切出し順を調整', { exact: true }).check()
  await expect(page.getByTestId('roll-order-comparison')).toContainText('最大Lまでの余裕合計')
  await page.locator('.roll-cut-list summary').click()
  await expect(page.getByTestId('roll-stock-remaining')).toBeVisible()
  await expect(page.getByTestId('roll-stock-remaining')).toContainText('シート 1・2')
  await expect(labels).toHaveCount(2)
  await expect(labels.first()).toContainText('W 3,640 mm')
  await expect(labels.first()).not.toContainText('8,100')
  await expect(labels.first()).toContainText('L 8,000 mm')
  await expect(table.locator('thead')).toContainText('切出し順')
  await expect
    .poll(async () => {
      const host = await editor.locator('.pdf-scroll').boundingBox()
      const drawing = await editor.locator('.drawing-surface').boundingBox()
      return drawing.height - host.height + 48
    })
    .toBeLessThan(1)
  await expect(editor.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: 'test-results/39-roll-cut-order.png' })
  await page.locator('.roll-cut-list summary').click()
  // Closing the list resizes the fitted drawing before starting the pan gesture.
  await expect
    .poll(async () => {
      const host = await editor.locator('.pdf-scroll').boundingBox()
      const drawing = await editor.locator('.drawing-surface').boundingBox()
      const fitted = Math.min((host.width - 48) / 842, (host.height - 48) / 595, 2) * 595
      return Math.abs(drawing.height - fitted)
    })
    .toBeLessThan(0.5)
  await expect(editor.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  await verifyRightPan(page)
  await expect(page.getByTestId('roll-total-length')).toHaveText(quantities)
  await page.screenshot({ path: 'test-results/37-carpet-layout.png' })
  await page.getByLabel('割付W（mm）', { exact: true }).fill('4000')
  await expect(
    page.getByRole('button', { name: 'PDFプレビュー・保存', exact: true })
  ).toBeDisabled()
  await page.getByLabel('割付W（mm）', { exact: true }).fill('2000')
  await expect(page.getByTestId('roll-total-area')).toContainText('88.5')
  await page.getByLabel('カーペットの出荷方法', { exact: true }).selectOption('free')
  await expect(page.getByTestId('roll-total-area')).toContainText('48.6')
  await expect(page.getByTestId('roll-size-summary')).toContainText('W 2,000 mm × L 8,100 mm × 3枚')
  const areaBefore = await page.getByTestId('roll-total-area').innerText()
  await page.getByLabel('最大出荷L（mm・任意）', { exact: true }).fill('100000')
  await expect(page.getByTestId('roll-total-area')).toHaveText(areaBefore)
  await page.getByLabel('最大出荷L（mm・任意）', { exact: true }).fill('30000')
  await page.getByRole('button', { name: '全体表示', exact: true }).click()
  await exerciseLayoutPdf(page, application, temporary, tileDoc.roomId)
  quantities = await page.getByTestId('roll-total-length').innerText()
  await page.getByRole('button', { name: '割り付けを保存', exact: true }).click()
  await expect(page.getByText('割り付けを保存しました。', { exact: true })).toBeVisible()
  const doc = await page.evaluate(
    async (id) => (await window.sekisan.readLayout(id)).data,
    tileDoc.roomId
  )
  assert.equal(doc.body.reorderCuts, true)
  assert.equal(doc.body.layoutType, 'carpet')
  assert.equal(doc.body.widthMm, 2000)
  assert.equal(doc.body.maxWidthMm, 3640)
  assert.equal(doc.body.rollCutMode, 'free')
  assert.equal(doc.body.trimMm, 50)
  assert.equal(doc.body.angle, 90)
  const after = await page.evaluate(
    async (address) => (await window.sekisan.readTakeoff(address)).data,
    { drawingId: before.drawingId, pageNumber: before.pageNumber }
  )
  assert.deepEqual(after, before)
  await editor
    .locator(':scope > .modal-footer')
    .getByRole('button', { name: '図面一覧へ', exact: true })
    .click()
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.getByLabel('割付の材料の種類', { exact: true })).toHaveValue('carpet')
  await expect(page.getByTestId('roll-total-length')).toHaveText(quantities)
  await expect(page.getByLabel('カーペットの出荷方法', { exact: true })).toHaveValue('free')
  await page
    .locator('.layout-screen > .modal-footer')
    .getByRole('button', { name: '図面一覧へ', exact: true })
    .click()
  console.log(
    'PASS ロール割付: シート・カーペットのマスタ / 幅・巻き長さ / 切りしろ・必要数量・巻割り / 巻長超過・未設定 / 90度回転・右パン / 保存・再表示・拾い出し数量保持'
  )
  return doc
}
