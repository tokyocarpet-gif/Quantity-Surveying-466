import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
const edit = async (page, label, value) => {
  await page.getByLabel(label, { exact: true }).click()
  await page.locator('.paper-input').fill(value)
  await page.locator('.paper-input').press('Tab')
  if (await page.locator('.paper-input').count()) await page.locator('.paper-input').press('Escape')
}
export async function exerciseEstimate(page) {
  const original = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
  })
  await page.getByRole('button', { name: '数量集計', exact: true }).click()
  await expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await page.getByLabel('集計する部位').selectOption('floor')
  await page.getByRole('button', { name: 'この集計から見積を作成', exact: true }).click()
  await expect(page.getByTestId('estimate-row')).toHaveCount(1)
  await page.getByRole('button',{name:'セル編集に切り替え',exact:true}).click()
  await edit(page, '明細1の数量', '12.34')
  await edit(page, '明細1の単価', '2000')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.getByTestId('estimate-total')).toHaveText('24,600 円')
  await edit(page, '見積名', '本社ビル 御見積書')
  await edit(page, '見積の納期', '9月末・別途打合せ')
  await page.getByRole('button', { name: '見積を保存', exact: true }).click()
  await expect(page.getByText('第2版として保存しました。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '見積一覧へ戻る', exact: true }).click()
  await expect(page.locator('.estimate-card')).toContainText('24,600円')
  await page.getByRole('button', { name: '案件へ戻る', exact: true }).click()
  const after = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
  })
  assert.deepEqual(after, original)
}
export async function verifySavedEstimate(page) {
  await page.getByRole('button', { name: '見積一覧', exact: true }).click()
  await page.locator('.estimate-card').filter({ hasText: '本社ビル 御見積書' }).click()
  await expect(page.getByLabel('明細1の数量', { exact: true })).toHaveText('12.3')
  await page.getByRole('button', { name: '表紙', exact: true }).click()
  await expect(page.getByLabel('見積名', { exact: true })).toHaveText('本社ビル 御見積書')
  await expect(page.getByTestId('estimate-total')).toHaveText('24,600 円')
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByLabel('見積の保存履歴').selectOption('1')
  await expect(page.getByLabel('明細1の単価', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '見積一覧へ戻る', exact: true }).click()
  await page.getByRole('button', { name: '案件へ戻る', exact: true }).click()
}
