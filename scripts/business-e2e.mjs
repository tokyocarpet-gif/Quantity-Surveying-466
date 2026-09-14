import { expect } from '@playwright/test'
export async function exerciseBusiness(page) {
  await page.getByRole('button', { name: '設定・データ管理', exact: true }).click()
  await page.getByRole('button', { name: '自社情報を登録・編集', exact: true }).click()
  await page.getByLabel('自社の会社名', { exact: true }).fill('自社情報テスト株式会社')
  await page.getByLabel('自社の郵便番号', { exact: true }).fill('100-0001')
  await page.getByLabel('自社の住所', { exact: true }).fill('東京都千代田区')
  await page.getByLabel('自社の電話番号', { exact: true }).fill('03-0000-0000')
  await page.getByLabel('自社の見積有効期限', { exact: true }).fill('発行日から30日間')
  await page.getByLabel('自社の支払条件', { exact: true }).fill('月末締め・翌月末払い')
  await page.getByLabel('自社のその他の基本条件', { exact: true }).fill('工事日程は別途協議')
  await page.getByRole('button', { name: '自社情報を保存', exact: true }).click()
  await expect(page.getByText('自社情報を保存しました。', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/17-company.png' })
  await page.locator('.company-form').getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '仕上げ材マスタ', exact: true }).click()
  await page.getByRole('button', { name: '部位を追加', exact: true }).click()
  await page.getByLabel('追加する部位名', { exact: true }).fill('建具')
  await page.getByRole('button', { name: '追加して保存', exact: true }).click()
  await expect(page.getByLabel('追加する部位名', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '単位を追加', exact: true }).click()
  await page.getByLabel('追加する単位名', { exact: true }).fill('枚')
  await page.getByRole('button', { name: '追加して保存', exact: true }).click()
  await expect(page.getByLabel('追加する単位名', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '共通マスタ', exact: true }).click()
  await page.getByRole('button', { name: '材料を追加', exact: true }).click()
  await page.getByLabel('材料の部位', { exact: true }).selectOption('建具')
  await page.getByLabel('材料名・仕様', { exact: true }).fill('木製建具')
  await page.getByLabel('材料の仕様', { exact: true }).fill('W900×H2100')
  await page.getByLabel('材料の厚み（mm）', { exact: true }).fill('35')
  await page.getByLabel('材料の単位', { exact: true }).selectOption('枚')
  await page.getByLabel('材料の単価', { exact: true }).fill('12000')
  await page.getByRole('button', { name: '材料を保存', exact: true }).click()
  await expect(page.locator('.master-list')).toContainText('W900×H2100')
  await page.getByRole('button', { name: '物件マスタ', exact: true }).click()
  await page.getByRole('button', { name: '共通から選ぶ', exact: true }).click()
  await page.getByRole('checkbox', { name: '建具・木製建具を選択', exact: true }).check()
  await page.getByRole('button', { name: '選択した1件を物件へ取り込む', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '建具・木製建具を編集', exact: true })
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/18-custom-material.png' })
  await page
    .locator('dialog .modal-footer')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await page.evaluate(async () => {
    const workspace = await window.sekisan.workspace()
    const result = await window.sekisan.changeMaterials({
      kind: 'save',
      id: crypto.randomUUID(),
      input: {
        projectId: workspace.data.drawings[0].projectId,
        category: '建具',
        name: '木製建具',
        specification: 'W750×H2100',
        unit: '枚',
        unitPrice: 9000
      }
    })
    if (!result.ok) throw new Error(JSON.stringify(result))
  })
}
