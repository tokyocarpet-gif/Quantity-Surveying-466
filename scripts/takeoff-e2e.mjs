import { expect } from '@playwright/test'
import assert from 'node:assert/strict'

async function point(page, x, y) {
  const overlay = page.getByTestId('drawing-overlay')
  await expect(overlay).toBeVisible()
  const rect = await overlay.boundingBox()
  const [, , width, height] = (await overlay.getAttribute('viewBox')).split(' ').map(Number)
  await overlay.click({ position: { x: (x / width) * rect.width, y: (y / height) * rect.height } })
}
async function quantityNear(page, category, expected, unit) {
  const locator = page.getByTestId(`quantity-${category}`)
  await expect(locator).toContainText(unit)
  // Pointer coordinates are quantized by Chromium. Exact geometry is tested separately.
  await expect
    .poll(async () =>
      Math.abs(Number((await locator.innerText()).replaceAll(',', '').split(' ')[0]) - expected)
    )
    .toBeLessThan(0.01)
}
async function confirm(page) {
  if (await page.getByRole('heading', { name: '同名の部屋があります', exact: true }).isVisible())
    await page.getByRole('button', { name: '別の部屋として登録', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数量の変更を確認', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数量の変更を確認', exact: true })).toHaveCount(0)
}
async function state(page) {
  return page.evaluate(async () => {
    const workspace = await window.sekisan.workspace()
    const data = await window.sekisan.readTakeoff({
      drawingId: workspace.data.drawings[0].id,
      pageNumber: 1
    })
    if (!data.ok) throw new Error(data.error)
    return data.data
  })
}
async function scale(page, length) {
  await page.getByRole('button', { name: '縮尺', exact: true }).click()
  await point(page, 100, 100)
  await point(page, 500, 100)
  await page.getByRole('spinbutton', { name: '実寸（mm）', exact: true }).fill(String(length))
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
}
export async function exerciseTakeoff(page) {
  await expect(page.getByRole('button', { name: '部屋', exact: true })).toBeDisabled()
  await scale(page, 4000)
  await page.getByRole('checkbox', { name: '矩形', exact: true }).check()
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  await point(page, 100, 100)
  await point(page, 500, 400)
  await page.getByLabel('部屋名', { exact: true }).fill('会議室')
  await page.getByRole('combobox', { name: '床の仕上げ', exact: true }).fill('タイルカーペット')
  await page.getByRole('spinbutton', { name: '床の単価', exact: true }).fill('4500')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数量の変更を確認' })).toBeVisible()
  assert.equal((await state(page)).rooms.length, 0, 'preview must not persist room')
  await confirm(page)
  await quantityNear(page, 'ceiling', 12, '㎡')
  await quantityNear(page, 'wall', 33.6, '㎡')
  await quantityNear(page, 'baseboard', 14, 'm')
  await quantityNear(page, 'floor', 12, '㎡')
  const beforeZoom = await state(page)
  await page.getByRole('button', { name: '拡大', exact: true }).click()
  await page.getByRole('button', { name: '部屋一覧を折りたたむ', exact: true }).click()
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  assert.deepEqual(await state(page), beforeZoom, 'zoom and panel size do not change quantities')
  await page.getByRole('button', { name: '部屋一覧を開く', exact: true }).click()
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await page.getByRole('button', { name: '開口控除', exact: true }).click()
  await page.getByRole('textbox', { name: '開口名', exact: true }).fill('入口ドア')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await quantityNear(page, 'wall', 31.8, '㎡')
  const beforeHeight = await state(page)
  await page.getByRole('button', { name: '部屋を編集', exact: true }).click()
  await page.getByRole('spinbutton', { name: '天井・壁高さ（mm）', exact: true }).fill('3000')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(page.locator('.quantity-preview')).toContainText('40.2')
  await page.getByRole('button', { name: '戻る', exact: true }).click()
  assert.deepEqual(await state(page), beforeHeight, 'cancel does not mutate saved quantities')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await quantityNear(page, 'wall', 40.2, '㎡')
  await page
    .locator('.quantity-card')
    .filter({ has: page.getByTestId('quantity-floor') })
    .getByRole('button', { name: '数量を固定する', exact: true })
    .click()
  await page.getByRole('spinbutton', { name: '固定する元数量', exact: true }).fill('15')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await scale(page, 8000)
  await quantityNear(page, 'ceiling', 48, '㎡')
  await quantityNear(page, 'wall', 82.2, '㎡')
  await quantityNear(page, 'baseboard', 28, 'm')
  await expect(page.getByTestId('quantity-floor')).toHaveText('15 ㎡')
  const after = await state(page)
  assert.deepEqual(
    after.items.map((i) => i.id),
    beforeHeight.items.map((i) => i.id),
    'IDs survive recalculation'
  )
  assert.equal(after.deductions[0].targetItemId, beforeHeight.deductions[0].targetItemId)
  // A second, identically named room is drawn as a polygon, then redrawn and deleted.
  await page.getByRole('checkbox', { name: '矩形', exact: true }).uncheck()
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  await point(page, 550, 100)
  await point(page, 750, 100)
  await point(page, 700, 250)
  await page.getByTestId('drawing-overlay').press('Enter')
  await page.getByLabel('部屋名', { exact: true }).fill('会議室')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await expect(page.getByTestId('room-card')).toHaveCount(2)
  await quantityNear(page, 'ceiling', 6, '㎡')
  const twoRooms = await state(page)
  assert.deepEqual(
    twoRooms.rooms.map((r) => r.name),
    ['会議室', '会議室（2）']
  )
  assert.notEqual(twoRooms.rooms[0].id, twoRooms.rooms[1].id)
  await page.getByRole('button', { name: '部屋を編集', exact: true }).click()
  await page.getByRole('button', { name: '形状を描き直す', exact: true }).click()
  await page.getByRole('checkbox', { name: '矩形', exact: true }).check()
  await point(page, 550, 100)
  await point(page, 750, 300)
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await quantityNear(page, 'ceiling', 16, '㎡')
  await page.getByRole('button', { name: '部屋と自動数量を削除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数量の変更を確認' })).toBeVisible()
  await page.getByRole('button', { name: '戻る', exact: true }).click()
  assert.equal((await state(page)).rooms.length, 2)
  await page.getByRole('button', { name: '部屋と自動数量を削除', exact: true }).click()
  await confirm(page)
  await verifySavedTakeoff(page)
  await exerciseHeightAndSleeves(page)
  await exerciseMouseAndMasters(page)
  await page.locator('.properties-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  // The optional notification may expire between locating and clicking it.
  await page
    .locator('.toast button')
    .evaluateAll((buttons) => buttons.forEach((button) => button.click()))
  await page.screenshot({ path: 'test-results/05-takeoff.png' })
  await page.getByRole('button', { name: '次のページ', exact: true }).click()
  await expect(page.getByRole('button', { name: '部屋', exact: true })).toBeDisabled()
  await expect(page.getByTestId('room-card')).toHaveCount(0)
  await page.getByRole('button', { name: '前のページ', exact: true }).click()
  await verifySavedTakeoff(page)
}
export async function verifySavedTakeoff(page) {
  await expect(page.getByTestId('room-card')).toHaveCount(1)
  await page.getByTestId('room-card').click()
  await expect(page.getByTestId('quantity-floor')).toHaveText('15 ㎡')
  await quantityNear(page, 'wall', 82.2, '㎡')
  await expect(page.locator('.deduction-card')).toContainText('入口ドア')
}

async function exerciseMouseAndMasters(page) {
  const initial = await state(page)
  // Wheel anchoring is checked against actual on-screen SVG coordinates.
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  const panHost = await page.locator('.pdf-scroll').boundingBox()
  const panStart = { x: panHost.x + panHost.width * 0.5, y: panHost.y + panHost.height * 0.5 }
  const beforePan = await page.getByTestId('drawing-overlay').boundingBox()
  await page.getByRole('button', { name: 'パン', exact: true }).click()
  await expect(page.getByRole('button', { name: 'パン', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.mouse.move(panStart.x, panStart.y)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(panStart.x + 80, panStart.y + 45, { steps: 8 })
  await page.mouse.up({ button: 'left' })
  const afterPan = await page.getByTestId('drawing-overlay').boundingBox()
  assert.ok(Math.abs(afterPan.x - beforePan.x - 80) < 1, 'pan tool moves with the left button')
  assert.ok(Math.abs(afterPan.y - beforePan.y - 45) < 1)
  assert.deepEqual(await state(page), initial, 'pan tool preserves quantities')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  const host = await page.locator('.pdf-scroll').boundingBox()
  const anchor = { x: host.x + host.width * 0.55, y: host.y + host.height * 0.4 }
  const oldBox = await page.getByTestId('drawing-overlay').boundingBox()
  const logical = {
    x: (anchor.x - oldBox.x) / oldBox.width,
    y: (anchor.y - oldBox.y) / oldBox.height
  }
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -240)
  await expect
    .poll(async () => (await page.getByTestId('drawing-overlay').boundingBox()).width)
    .toBeGreaterThan(oldBox.width * 1.2)
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  const enlarged = await page.getByTestId('drawing-overlay').boundingBox()
  assert.ok(Math.abs(enlarged.x + logical.x * enlarged.width - anchor.x) < 1)
  assert.ok(Math.abs(enlarged.y + logical.y * enlarged.height - anchor.y) < 1)
  await page.mouse.wheel(0, 240)
  await expect
    .poll(async () => (await page.getByTestId('drawing-overlay').boundingBox()).width)
    .toBeLessThan(enlarged.width * 0.9)
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  const reduced = await page.getByTestId('drawing-overlay').boundingBox()
  assert.ok(Math.abs(reduced.x + logical.x * reduced.width - anchor.x) < 1)
  assert.ok(Math.abs(reduced.y + logical.y * reduced.height - anchor.y) < 1)
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(anchor.x + 20, anchor.y + 15, { steps: 5 })
  await page.mouse.up({ button: 'left' })
  const unmoved = await page.getByTestId('drawing-overlay').boundingBox()
  assert.ok(
    Math.abs(unmoved.x - reduced.x) < 1 && Math.abs(unmoved.y - reduced.y) < 1,
    'left drag does not pan'
  )
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(anchor.x + 70, anchor.y + 35, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  const moved = await page.getByTestId('drawing-overlay').boundingBox()
  assert.ok(Math.abs(moved.x - reduced.x - 70) < 1)
  assert.ok(Math.abs(moved.y - reduced.y - 35) < 1)
  assert.deepEqual(await state(page), initial, 'mouse navigation never changes quantities')
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')

  await page.getByRole('button', { name: '仕上げ材マスタ', exact: true }).click()
  await page.getByRole('button', { name: '共通から選ぶ', exact: true }).click()
  await expect(page.locator('.master-list .master-row small')).toHaveText([
    '天井',
    '天井',
    '壁',
    '壁',
    '巾木',
    '巾木',
    '床',
    '床',
    '床'
  ])
  await page.getByRole('checkbox', { name: '床・タイルカーペットを選択', exact: true }).check()
  await page.getByRole('checkbox', { name: '壁・塗装を選択', exact: true }).check()
  await page.getByRole('button', { name: '選択した2件を物件へ取り込む', exact: true }).click()
  await page.getByRole('button', { name: '床・タイルカーペットを編集', exact: true }).click()
  await page.getByRole('spinbutton', { name: '材料の単価', exact: true }).fill('5100')
  await page.getByRole('button', { name: '材料を保存', exact: true }).click()
  await expect(page.locator('.master-list')).toContainText('5,100')
  await page.screenshot({ path: 'test-results/06-material-master.png' })
  await page
    .locator('dialog .modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()

  // Draw an orthogonal polygon by mouse; off-axis clicks must be constrained.
  await page.getByRole('checkbox', { name: '矩形', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'スナップ', exact: true }).uncheck()
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  // A right drag during drawing must pan without creating a vertex.
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(anchor.x + 30, anchor.y, { steps: 5 })
  await page.mouse.up({ button: 'right' })
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await point(page, 550, 100)
  await page.getByRole('button', { name: 'パン', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const beforeResumePan = await page.getByTestId('drawing-overlay').boundingBox()
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(anchor.x + 40, anchor.y + 20, { steps: 5 })
  await page.mouse.up({ button: 'left' })
  const afterResumePan = await page.getByTestId('drawing-overlay').boundingBox()
  assert.ok(Math.abs(afterResumePan.x - beforeResumePan.x - 40) < 1)
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  const surface = await page.getByTestId('drawing-overlay').boundingBox()
  await page.mouse.move(
    surface.x + (surface.width * 730) / 842,
    surface.y + (surface.height * 107) / 595
  )
  await expect(page.getByTestId('takeoff-crosshair')).toBeVisible()
  const viewport = await page.locator('.pdf-scroll').boundingBox()
  const h = await page.locator('.crosshair-horizontal').boundingBox(),
    v = await page.locator('.crosshair-vertical').boundingBox()
  assert.ok(
    Math.abs(h.width - viewport.width) < 1 && Math.abs(v.height - viewport.height) < 1,
    'crosshair spans entire viewport'
  )
  assert.ok(
    Math.abs(h.y - (surface.y + (surface.height * 100) / 595)) < 1,
    'crosshair follows assisted point'
  )
  await page.screenshot({ path: 'test-results/09-full-crosshair.png' })
  await point(page, 730, 107)
  await point(page, 735, 270)
  await point(page, 550, 276)
  await page.getByRole('button', { name: '確定', exact: true }).click()
  await page
    .getByRole('combobox', { name: '部屋名の履歴から選択', exact: true })
    .selectOption('会議室')
  await expect(page.getByLabel('部屋名', { exact: true })).toHaveValue('会議室')
  await page.getByLabel('部屋名', { exact: true }).fill('事務室')
  await page.getByRole('button', { name: '選択を解除', exact: true }).click()
  await page.getByRole('checkbox', { name: '床を拾う', exact: true }).check()
  const materialId = await page.evaluate(async () => {
    const w = await window.sekisan.workspace()
    const m = await window.sekisan.readMaterials(w.data.drawings[0].projectId)
    return m.data.project.find((m) => m.category === 'floor').id
  })
  await page.getByRole('button', { name: '床の仕上げのマスタを開く', exact: true }).click()
  await page.locator(`[data-material-id="${materialId}"]`).click()
  await expect(page.getByRole('spinbutton', { name: '床の単価', exact: true })).toHaveValue('5100')
  await page.screenshot({ path: 'test-results/07-room-selection.png' })
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(page.locator('.quantity-preview')).not.toContainText('会議室')
  await expect(page.locator('.quantity-preview tbody tr')).toHaveCount(1)
  await confirm(page)
  const first = (await state(page)).rooms.find((r) => r.name === '事務室')
  assert.equal(first.polygon.length, 4)
  assert.equal(first.polygon[0].y, first.polygon[1].y)
  assert.equal(first.polygon[1].x, first.polygon[2].x)
  assert.equal(first.polygon[2].y, first.polygon[3].y)
  assert.deepEqual(first.enabledCategories, ['floor'])
  await expect(page.getByTestId('quantity-wall')).toHaveCount(0)
  const beforeMerge = await state(page)
  await page.getByRole('checkbox', { name: '矩形', exact: true }).check()
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  await point(page, 550, 320)
  await point(page, 730, 450)
  await page
    .getByRole('combobox', { name: '部屋名の履歴から選択', exact: true })
    .selectOption('事務室')
  await page.getByRole('button', { name: '選択を解除', exact: true }).click()
  await page.getByRole('checkbox', { name: '床を拾う', exact: true }).check()
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '同名の部屋があります', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '統合して数量を確認', exact: true }).click()
  await expect(page.locator('.scale-summary')).toContainText('統合後の合計')
  await expect(page.locator('.quantity-preview')).not.toContainText('会議室')
  assert.deepEqual(await state(page), beforeMerge, 'merge preview does not persist')
  await confirm(page)
  await expect(page.getByTestId('room-card')).toHaveCount(2)
  await expect(
    page.getByRole('combobox', { name: '統合した部屋の範囲', exact: true })
  ).toBeVisible()
  const merged = await state(page)
  assert.equal(merged.rooms.filter((r) => r.groupId === first.groupId).length, 2)
  await page.screenshot({ path: 'test-results/08-merged-room.png' })
  await page.getByRole('button', { name: 'この範囲と自動数量を削除', exact: true }).click()
  await confirm(page)
  await page.getByTestId('room-card').filter({ hasText: '事務室' }).click()
  await page.getByRole('button', { name: '部屋と自動数量を削除', exact: true }).click()
  await confirm(page)
  await verifySavedTakeoff(page)
  await page.getByRole('combobox', { name: 'PDFのページを選択', exact: true }).selectOption('2')
  await expect(page.getByTestId('room-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '部屋', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: 'PDFのページを選択', exact: true }).selectOption('1')
  await verifySavedTakeoff(page)
}

async function exerciseHeightAndSleeves(page) {
  await verifySavedTakeoff(page)
  await expect(page.locator('.scale-badge')).toContainText('約1/56.69')
  await page.getByRole('button', { name: '拡大', exact: true }).click()
  await expect(page.locator('.scale-badge')).toContainText('約1/56.69')
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  // Select the primary room and draw a zero-width sleeve from its outside edge.
  await page.getByRole('button', { name: '袖壁', exact: true }).click()
  await point(page, 100, 200)
  await point(page, 200, 200)
  await expect(page.getByRole('heading', { name: '袖壁の設定', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '袖壁の面数', exact: true })).toHaveValue('2')
  await page.getByRole('textbox', { name: '袖壁名', exact: true }).fill('入口袖壁')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(page.locator('.quantity-preview')).toContainText('会議室')
  assert.equal((await state(page)).rooms[0].sleeveWalls.length, 0)
  await confirm(page)
  await quantityNear(page, 'wall', 94.2, '㎡')
  await quantityNear(page, 'baseboard', 32, 'm')
  await expect(page.getByTestId('quantity-floor')).toHaveText('15 ㎡')
  await expect(page.getByTestId('sleeve-wall-line')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/10-sleeve-wall.png' })
  await page
    .locator('.deduction-card')
    .filter({ hasText: '入口袖壁' })
    .getByRole('button')
    .first()
    .click()
  await page.getByRole('combobox', { name: '袖壁の面数', exact: true }).selectOption('1')
  await page.getByRole('spinbutton', { name: '袖壁の高さ', exact: true }).fill('1200')
  await page.getByRole('checkbox', { name: '袖壁の巾木も拾う', exact: true }).uncheck()
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await quantityNear(page, 'wall', 84.6, '㎡')
  await quantityNear(page, 'baseboard', 28, 'm')
  await page.getByRole('button', { name: '入口袖壁の線を削除', exact: true }).click()
  await confirm(page)
  await verifySavedTakeoff(page)
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  await point(page, 550, 100)
  await point(page, 700, 250)
  await expect(
    page.getByRole('spinbutton', { name: '天井・壁高さ（mm）', exact: true })
  ).toHaveValue('3000')
  await page.getByRole('combobox', { name: '高さの履歴から選択', exact: true }).selectOption('2400')
  await expect(
    page.getByRole('spinbutton', { name: '天井・壁高さ（mm）', exact: true })
  ).toHaveValue('2400')
  await page.getByRole('spinbutton', { name: '天井・壁高さ（mm）', exact: true }).fill('2700')
  await page.getByLabel('部屋名', { exact: true }).fill('高さ履歴テスト')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await confirm(page)
  await page.getByRole('button', { name: '部屋と自動数量を削除', exact: true }).click()
  await confirm(page)
  // History and last confirmed height survive deleting the source room and changing pages.
  await page.getByRole('combobox', { name: 'PDFのページを選択', exact: true }).selectOption('2')
  await page.getByRole('combobox', { name: 'PDFのページを選択', exact: true }).selectOption('1')
  await page.getByRole('checkbox', { name: '矩形', exact: true }).check()
  await page.getByRole('button', { name: '部屋', exact: true }).click()
  await point(page, 550, 100)
  await point(page, 700, 250)
  await expect(
    page.getByRole('spinbutton', { name: '天井・壁高さ（mm）', exact: true })
  ).toHaveValue('2700')
  await page.screenshot({ path: 'test-results/11-height-history.png' })
  await page.getByRole('button', { name: '編集をやめる', exact: true }).click()
  await verifySavedTakeoff(page)
}
