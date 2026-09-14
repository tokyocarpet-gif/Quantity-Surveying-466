import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
export async function exerciseSummary(page, application, temporary) {
  // Mouse-created geometry can differ slightly from nominal coordinates; compare the stored net value.
  const expectedWall = await page.evaluate(async () => {
    const workspace = await window.sekisan.workspace()
    const state = await window.sekisan.readTakeoff({
      drawingId: workspace.data.drawings[0].id,
      pageNumber: 1
    })
    if (!state.ok) throw new Error(state.error)
    const wall = state.data.items.find((i) => i.category === 'wall')
    return (
      (wall.fixedQuantity ?? wall.quantity) -
      state.data.deductions
        .filter((d) => d.targetItemId === wall.id)
        .reduce((n, d) => n + d.quantity, 0)
    ).toFixed(1)
  })
  await page.getByRole('button', { name: '数量集計', exact: true }).click()
  const ready = () => expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await ready()
  await expect(page.getByTestId('summary-row')).toHaveCount(4)
  await expect(page.getByTestId('summary-total-floor')).toHaveText('15.0 ㎡')
  await expect(page.getByTestId('summary-total-wall')).toHaveText(`${expectedWall} ㎡`)
  await expect(page.getByTestId('summary-total-amount')).toHaveText('67,500 円')
  for (const name of ['仕上げ別', '部屋別', '図面別', '部屋×仕上げ']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await ready()
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByTestId('summary-total-amount')).toHaveText('67,500 円')
  }
  await page.screenshot({ path: 'test-results/12-summary.png' })
  await page.getByLabel('確認事項で絞り込み').selectOption('missing-price')
  await ready()
  await expect(page.getByTestId('summary-row')).toHaveCount(3)
  await page.getByRole('button', { name: '条件を解除', exact: true }).click()
  await expect(page.getByLabel('確認事項で絞り込み')).toHaveValue('all')
  await expect(page.getByTestId('summary-row')).toHaveCount(4)
  await ready()
  const drawingId = await page
    .getByLabel('集計する図面')
    .locator('option')
    .nth(1)
    .getAttribute('value')
  await page.getByLabel('集計する図面').selectOption(drawingId)
  await ready()
  await page.getByLabel('集計するページ').selectOption('2')
  await ready()
  await expect(page.getByTestId('summary-row')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '表示中の集計をCSV保存', exact: true })
  ).toBeDisabled()
  await page.getByLabel('集計するページ').selectOption('1')
  await expect(page.getByTestId('summary-row')).toHaveCount(4)
  await ready()
  await page.getByLabel('集計する部位').selectOption('floor')
  await ready()
  await expect(page.getByTestId('summary-row')).toHaveCount(1)
  await page.getByLabel('集計を検索').fill('存在しない材料')
  await ready()
  await expect(page.getByTestId('summary-row')).toHaveCount(0)
  await page.getByLabel('集計を検索').fill('')
  await expect(page.getByTestId('summary-row')).toHaveCount(1)
  await ready()
  await expect(page.getByTestId('summary-row').locator('td strong')).toHaveText('会議室')
  await expect(page.getByLabel('集計する部屋').locator('option').nth(1)).toHaveText('会議室')
  await page.getByTestId('summary-row').locator('td').nth(5).click()
  await expect(page.getByRole('heading', { name: '仕上げ・単価を編集', exact: true })).toBeVisible()
  await page.getByLabel('集計の仕上げ材', { exact: true }).fill('キャンセルする材料')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByTestId('summary-row')).not.toContainText('キャンセルする材料')
  await page
    .getByTestId('summary-row')
    .getByRole('button', { name: /の仕上げ・単価を編集$/ })
    .click()
  const material = page.getByLabel('集計の仕上げ材', { exact: true })
  await expect(material).toBeEnabled()
  await material.fill('タイル')
  await page.getByRole('option', { name: /タイルカーペット/ }).click()
  const chosen = await page.getByLabel('集計の仕上げ材', { exact: true }).inputValue()
  assert.ok(chosen)
  await page.getByLabel('集計の単価', { exact: true }).fill('5000')
  await page.screenshot({ path: 'test-results/14-summary-edit.png' })
  await page.getByRole('button', { name: '保存して反映', exact: true }).click()
  await expect(page.getByRole('heading', { name: '仕上げ・単価を編集', exact: true })).toHaveCount(
    0
  )
  await expect(page.getByTestId('summary-total-amount')).toHaveText('75,000 円')
  await expect(page.getByTestId('summary-row')).toContainText(chosen)
  await page
    .getByTestId('summary-row')
    .getByRole('button', { name: /の内訳$/ })
    .click()
  await expect(page.getByRole('heading', { name: '集計の内訳', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/13-summary-detail.png' })
  await page.getByRole('button', { name: '図面へ', exact: true }).click()
  await expect(page.getByLabel('図面 1ページ', { exact: true })).toBeVisible()
  await expect(page.getByText('図面を読み込んでいます…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '部屋を編集', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '部屋を編集', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '床の単価', exact: true })).toHaveValue('5000')
  await page.getByRole('button', { name: '編集をやめる', exact: true }).click()
  await page.getByRole('button', { name: '集計に戻る', exact: true }).click()
  await ready()
  await expect(page.getByLabel('集計する部位')).toHaveValue('floor')
  await expect(page.getByLabel('集計するページ')).toHaveValue('1')
  await expect(page.getByTestId('summary-row')).toHaveCount(1)
  await page
    .getByTestId('summary-row')
    .getByRole('button', { name: /の仕上げ・単価を編集$/ })
    .click()
  await page.getByLabel('集計の仕上げ材', { exact: true }).fill('タイルカーペット')
  await page.getByLabel('集計の単価', { exact: true }).fill('4500')
  await page.getByRole('button', { name: '保存して反映', exact: true }).click()
  await expect(page.getByTestId('summary-total-amount')).toHaveText('67,500 円')
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  await page.getByRole('button', { name: '表示中の集計をCSV保存', exact: true }).click()
  await ready()
  await expect(page.locator('.summary-notice')).toHaveCount(0)
  const path = join(temporary, '数量集計.csv')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
  await page.getByRole('button', { name: '表示中の集計をCSV保存', exact: true }).click()
  await expect(page.locator('.summary-notice')).toContainText('CSVを保存しました')
  const csv = readFileSync(path, 'utf8')
  assert.ok(csv.startsWith('\ufeff'))
  assert.equal(csv.split('\r\n').length, 3)
  assert.ok(csv.includes(',15.0,"㎡",4500,67500,'))
  assert.ok(csv.includes('1ページ / 全部屋 / 床'))
  await page.getByRole('button', { name: '物件の図面一覧に戻る', exact: true }).click()
}
