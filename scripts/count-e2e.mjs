import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
async function point(page, x, y) {
  const overlay = page.getByTestId('drawing-overlay')
  const box = await overlay.boundingBox()
  const [, , width, height] = (await overlay.getAttribute('viewBox')).split(' ').map(Number)
  await overlay.click({ position: { x: (x / width) * box.width, y: (y / height) * box.height } })
}
async function panWithoutChangingCounts(page, fromMarker = false) {
  const host = await page.locator('.pdf-scroll').boundingBox()
  const surface = page.getByTestId('drawing-overlay')
  const before = await surface.boundingBox()
  const quantity = await page.getByTestId('count-draft-total').innerText()
  const markers = await page.getByTestId('count-marker').count()
  const marker = fromMarker ? await page.getByTestId('count-marker').first().boundingBox() : null
  const start = marker
    ? { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 }
    : { x: host.x + host.width / 2, y: host.y + host.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(start.x + 64, start.y + 36, { steps: 6 })
  await page.mouse.up({ button: 'right' })
  await expect
    .poll(async () => Math.abs((await surface.boundingBox()).x - before.x - 64))
    .toBeLessThan(1)
  await expect
    .poll(async () => Math.abs((await surface.boundingBox()).y - before.y - 36))
    .toBeLessThan(1)
  await expect(page.getByTestId('count-draft-total')).toHaveText(quantity)
  await expect(page.getByTestId('count-marker')).toHaveCount(markers)
  // Drag outside the drawing viewport and release there, then resume normal clicking.
  const moved = await surface.boundingBox(),
    x = host.x + host.width - 20,
    y = host.y + host.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(x + 60, y + 20, { steps: 6 })
  await page.mouse.up({ button: 'right' })
  await expect
    .poll(async () => Math.abs((await surface.boundingBox()).x - moved.x - 60))
    .toBeLessThan(1)
  await expect(page.locator('.pdf-scroll')).not.toHaveClass(/dragging/)
  await expect(page.getByTestId('count-draft-total')).toHaveText(quantity)
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await expect(page.locator('.pdf-scroll')).toHaveAttribute('aria-busy', 'false')
}
export async function exerciseCounts(page) {
  await page.getByRole('button', { name: '図面 サンプル.pdf', exact: true }).click()
  await page.getByRole('button', { name: '次のページ', exact: true }).click()
  await expect(page.getByLabel('図面 2ページ')).toBeVisible()
  await expect(page.getByText('図面を読み込んでいます…')).toHaveCount(0)
  await expect(page.getByText('縮尺未設定', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '個数', exact: true }).click()
  const material = page.getByLabel('個数拾いの名称', { exact: true })
  await expect(material).toHaveValue('')
  await expect(page.getByLabel('個数拾いの部位', { exact: true })).toHaveValue('')
  await panWithoutChangingCounts(page)
  await material.fill('木製')
  await page.getByRole('option', { name: /木製建具.*W900/ }).click()
  await expect(page.getByLabel('個数拾いの単価', { exact: true })).toHaveValue('12000')
  await expect(page.getByLabel('個数拾いの仕様・規格', { exact: true })).toHaveValue(
    'W900×H2100 ／ 厚み 35 mm'
  )
  await material.fill('ルーバー')
  await page.getByLabel('個数拾いの部位', { exact: true }).selectOption('ルーバー')
  await page.getByLabel('個数拾いの単位', { exact: true }).selectOption('本')
  await page.getByLabel('個数拾いの仕様・規格', { exact: true }).fill('W100×H2400')
  await page.getByLabel('個数拾いの単価', { exact: true }).fill('1000')
  await point(page, 160, 150)
  await point(page, 260, 150)
  await point(page, 360, 150)
  await expect(page.getByTestId('count-draft-total')).toHaveText('3 本')
  await panWithoutChangingCounts(page, true)
  await page.getByRole('button', { name: '点を取り消す', exact: true }).click()
  await panWithoutChangingCounts(page, true)
  await page.getByTestId('count-marker').nth(1).click()
  await expect(page.getByTestId('count-draft-total')).toHaveText('2 本')
  await page.getByRole('button', { name: '最後の点を戻す', exact: true }).click()
  await expect(page.getByTestId('count-draft-total')).toHaveText('1 本')
  await page.getByRole('button', { name: '点を追加', exact: true }).click()
  await point(page, 460, 150)
  await page.getByRole('button', { name: '個数を確認', exact: true }).click()
  await expect(page.locator('.quantity-preview')).toContainText('ルーバー')
  await expect(page.locator('.quantity-preview')).toContainText('2')
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByTestId('count-card')).toContainText('2 本')
  await page.screenshot({ path: 'test-results/21-count-picking.png' })
  await page.getByRole('button', { name: 'この個数拾いを削除', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '個数拾いを削除しますか？', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByTestId('count-marker')).toHaveCount(2)
  await page.getByRole('button', { name: '個数拾いを編集', exact: true }).click()
  await page.getByRole('button', { name: '点を追加', exact: true }).click()
  await point(page, 560, 150)
  await page.getByRole('button', { name: '図面一覧に戻る', exact: true }).click()
  await page.getByRole('button', { name: '破棄して移動', exact: true }).click()
  await page.getByRole('button', { name: '数量集計', exact: true }).click()
  await verifySummaryLayout(page)
  await page.getByLabel('集計する部位').selectOption('ルーバー')
  await expect(page.getByTestId('summary-row')).toHaveCount(1)
  await expect(page.getByTestId('summary-row')).toContainText('W100×H2400')
  await expect(page.getByTestId('summary-total-amount')).toHaveText('2,000 円')
  await page.getByRole('button', { name: 'この集計から見積を作成', exact: true }).click()
  await expect(page.getByLabel('明細1の数量', { exact: true })).toHaveValue('2.0')
  await expect(page.getByLabel('明細1の単位', { exact: true })).toHaveValue('本')
  await expect(page.getByTestId('estimate-total')).toHaveText('2,000 円')
  await page.getByLabel('見積名', { exact: true }).fill('個数拾いの見積')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.getByText('第2版として保存しました。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '見積一覧へ戻る', exact: true }).click()
  await page.getByRole('button', { name: '案件へ戻る', exact: true }).click()
}
export async function verifyCounts(page) {
  const counts = await page.evaluate(async () => {
    const w = await window.sekisan.workspace()
    const state = await window.sekisan.readTakeoff({
      drawingId: w.data.drawings[0].id,
      pageNumber: 2
    })
    return state.data
  })
  assert.equal(counts.scaleRatio, null)
  assert.equal(counts.counts.length, 1)
  assert.equal(counts.counts[0].points.length, 2)
  assert.equal(counts.counts[0].unit, '本')
  assert.equal(counts.counts[0].specification, 'W100×H2400')
}

async function verifySummaryLayout(page) {
  await page.getByLabel('集計する部位').selectOption('')
  await expect(page.getByTestId('summary-total-ルーバー')).toHaveText('2.0 本')
  const originalSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const metrics = page.getByRole('region', { name: '部位別の合計', exact: true })
  const checkRow = async () => {
    const rects = await metrics.locator(':scope > div').evaluateAll((cards) =>
      cards.map((c) => {
        const { x, y, width, height } = c.getBoundingClientRect()
        return { x, y, width, height }
      })
    )
    assert.ok(rects.length >= 6)
    assert.ok(
      rects.every((r) => Math.abs(r.y - rects[0].y) < 1),
      '部位別合計は1行で表示'
    )
    for (let i = 1; i < rects.length; i++)
      assert.ok(rects[i].x >= rects[i - 1].x + rects[i - 1].width, 'カードは重ならない')
    assert.ok((await metrics.boundingBox()).height < 130, '合計欄の高さを維持')
  }
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await checkRow()
    await page.screenshot({ path: `test-results/23-summary-totals-${width}.png` })
  }
  const added = await page.evaluate(async () => {
    const w = await window.sekisan.workspace()
    const address = { drawingId: w.data.drawings[0].id, pageNumber: 2 }
    let state = (await window.sekisan.readTakeoff(address)).data
    const ids = []
    for (let i = 0; i < 6; i++) {
      const id = crypto.randomUUID()
      const { id: savedId, drawingId, pageNumber, ...input } = state.counts[0]
      const added = await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: {
          kind: 'count',
          id,
          input: { ...input, category: `追加部位${i + 1}`, name: '集計表示確認' }
        }
      })
      if (!added.ok) throw new Error(added.error)
      state = added.data
      ids.push(id)
    }
    return { address, ids }
  })
  await page.getByRole('button', { name: '再集計', exact: true }).click()
  await expect(page.getByTestId('summary-total-追加部位6')).toBeAttached()
  await checkRow()
  assert.ok(await metrics.evaluate((el) => el.scrollWidth > el.clientWidth), '多部位は横スクロール')
  await metrics.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  await expect(page.getByTestId('summary-total-amount')).toBeInViewport()
  await page.screenshot({ path: 'test-results/24-summary-many-totals.png' })
  await page.evaluate(async ({ address, ids }) => {
    let state = (await window.sekisan.readTakeoff(address)).data
    for (const id of ids) {
      const result = await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: { kind: 'deleteCount', id }
      })
      if (!result.ok) throw new Error(result.error)
      state = result.data
    }
  }, added)
  await page.getByRole('button', { name: '再集計', exact: true }).click()
  await expect(page.getByTestId('summary-total-追加部位6')).toHaveCount(0)
  await page.setViewportSize(originalSize)
}
