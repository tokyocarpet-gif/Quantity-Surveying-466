import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'

export async function exerciseExcel(page, application, temporary) {
  await page.getByRole('button', { name: '見積一覧', exact: true }).click()
  await page.locator('.estimate-card').filter({ hasText: '本社ビル 御見積書' }).click()
  const button = page.getByRole('button', { name: 'Excelを保存', exact: true })
  await page.getByLabel('見積名', { exact: true }).fill('未保存')
  await expect(button).toBeDisabled()
  await page.getByLabel('見積名', { exact: true }).fill('本社ビル 御見積書')
  const path = join(temporary, '見積書.xlsx')
  writeFileSync(path, 'existing')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: path })
  }, path)
  await button.click()
  await expect(button).toBeEnabled()
  assert.equal(readFileSync(path, 'utf8'), 'existing')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async (optionsOrWindow, options) => {
      if ((options ?? optionsOrWindow).filters[0].extensions[0] !== 'xlsx')
        throw new Error('Excel filter missing')
      return { canceled: false, filePath: path }
    }
  }, path)
  await button.click()
  await expect(page.getByText(/Excel帳票を保存しました/)).toBeVisible()
  const bytes = readFileSync(path),
    zip = new AdmZip(bytes)
  assert.match(zip.readAsText('xl/worksheets/sheet1.xml'), /<v>25600<\/v>/)
  assert.match(zip.readAsText('xl/worksheets/sheet2.xml'), /新規ボード下地として/)
  assert.match(zip.readAsText('xl/worksheets/sheet2.xml'), /販売センター内装仕上工事/)
  assert.doesNotMatch(zip.readAsText('xl/worksheets/sheet1.xml'), /消費税|税込/)
  writeFileSync('test-results/estimate-export.xlsx', bytes)
  await page.screenshot({ path: 'test-results/29-excel-export.png' })
  await page.getByLabel('見積の保存履歴', { exact: true }).selectOption('1')
  await button.click()
  await expect(page.getByText(/Excel帳票を保存しました/)).toBeVisible()
  const previous = new AdmZip(readFileSync(path))
  assert.match(previous.readAsText('xl/worksheets/sheet1.xml'), /<v>67500<\/v>/)
  assert.doesNotMatch(previous.readAsText('xl/worksheets/sheet2.xml'), /新規ボード下地として/)
  await expect(page.getByLabel('見積の保存履歴', { exact: true }).locator('option')).toHaveCount(2)
  await page.getByRole('button', { name: '見積一覧へ戻る', exact: true }).click()
  await page.getByRole('button', { name: '案件へ戻る', exact: true }).click()
  const invalid = await page.evaluate(() =>
    window.sekisan.saveEstimateXlsx({ id: crypto.randomUUID(), revision: 1 })
  )
  assert.equal(invalid.ok, false)
  console.log(
    'PASS Excel: 保存・キャンセル・未保存保護・過去版・数量/備考/大項目・税非表示・版履歴維持'
  )
}
