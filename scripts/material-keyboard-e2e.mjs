import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-material-keys-'))
const env = { ...process.env, SEKISAN_DATA_DIR: temporary }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let application
try {
  application = await electron.launch({ args: ['.'], cwd: resolve('.'), env })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: '顧客を追加', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '顧客を追加', exact: true }).click()
  await page.getByRole('textbox', { name: '顧客名' }).fill('キーボード検証')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '案件を作成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '案件名' }).fill('材料登録確認')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '仕上げ材マスタ', exact: true }).click()
  const field = (name) => page.getByLabel(name, { exact: true })
  const save = page.getByRole('button', { name: '材料を保存', exact: true })
  const context = () =>
    page.evaluate(async () => {
      const workspace = await window.sekisan.workspace()
      const materials = await window.sekisan.readMaterials(workspace.data.projects[0].id)
      if (!materials.ok) throw new Error(materials.error)
      return materials.data
    })
  for (const [scope, type] of [
    ['共通マスタ', 'tile'],
    ['物件マスタ', 'sheet'],
    ['物件マスタ', 'carpet']
  ]) {
    await page.getByRole('button', { name: scope, exact: true }).click()
    const before = await context()
    await page.getByRole('button', { name: '材料を追加', exact: true }).click()
    await field('材料の種類').selectOption(type)
    const name = `Enter検証-${type}`
    await field('材料名・仕様').fill(name)
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      await field('材料名・仕様').dispatchEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ...extra
      })
      await expect(field('材料名・仕様')).toBeFocused()
      assert.deepEqual(await context(), before)
    }
    await field('材料名・仕様').press('Enter')
    await expect(field('材料の仕様')).toBeFocused()
    await field('材料の仕様').fill('品番ABC')
    const labels =
      type === 'tile'
        ? ['材料の幅（mm）', '材料の長さ（mm）', '材料の厚み（mm）']
        : [
            `材料のW（${type === 'sheet' ? 'm' : 'mm'}）`,
            `材料のL（${type === 'sheet' ? 'm' : 'mm'}）`,
            '材料のT（mm）'
          ]
    const values =
      type === 'tile'
        ? ['500', '500', '6']
        : type === 'sheet'
          ? ['1.82', '20', '2']
          : ['3640', '30000', '6']
    await field('材料の仕様').press('Enter')
    for (let i = 0; i < labels.length; i++) {
      await expect(field(labels[i])).toBeFocused()
      await field(labels[i]).fill(values[i])
      await field(labels[i]).press('Enter')
    }
    await expect(field('材料の単価')).toBeFocused()
    await field('材料の単価').fill('1800')
    await page.keyboard.down('Enter')
    await expect(save).toBeFocused()
    await page.keyboard.down('Enter') // Held key must not activate the newly focused save button.
    await page.keyboard.up('Enter')
    await expect(save).toBeVisible()
    assert.deepEqual(await context(), before, 'Enter navigation must not persist the draft')
    await save.click()
    await expect(save).toHaveCount(0)
    const saved = (await context())[scope === '共通マスタ' ? 'global' : 'project'].find(
      (m) => m.name === name
    )
    assert.ok(saved)
    assert.equal(saved.tileWidthMm, type === 'sheet' ? 1820 : Number(values[0]))
    assert.equal(saved.unitPrice, 1800)
    await page.getByRole('button', { name: `床・${name}を編集`, exact: true }).click()
    await field('材料の仕様').fill('編集後')
    await field('材料の仕様').press('Enter')
    await expect(field(labels[0])).toBeFocused()
    assert.equal(
      (await context())[scope === '共通マスタ' ? 'global' : 'project'].find(
        (m) => m.id === saved.id
      ).specification,
      '品番ABC'
    )
    await save.focus()
    await save.press('Enter')
    await expect(save).toHaveCount(0)
    assert.equal(
      (await context())[scope === '共通マスタ' ? 'global' : 'project'].find(
        (m) => m.id === saved.id
      ).specification,
      '編集後'
    )
  }
  await page.getByRole('button', { name: '材料を追加', exact: true }).click()
  await field('材料名・仕様').focus()
  await field('材料名・仕様').press('Tab')
  await expect(field('材料の仕様')).toBeFocused()
  await field('材料の仕様').press('Shift+Tab')
  await expect(field('材料名・仕様')).toBeFocused()
  await save.click()
  await expect(field('材料名・仕様')).toBeFocused()
  await expect(save).toBeVisible() // Required-name validation remains in place.
  await page.getByRole('button', { name: '編集をやめる', exact: true }).click()
  for (const [kind, label, name] of [
    ['部位', '追加する部位名', '家具'],
    ['単位', '追加する単位名', '本']
  ]) {
    const before = await context()
    await page.getByRole('button', { name: `${kind}を追加`, exact: true }).click()
    await field(label).fill(name)
    await field(label).press('Enter')
    const button = page.getByRole('button', { name: '追加して保存', exact: true })
    await expect(button).toBeFocused()
    assert.deepEqual(await context(), before)
    await button.click()
    await expect(field(label)).toHaveCount(0)
  }
  console.log(
    'PASS 材料のEnter移動: 共通・物件 / 追加・編集 / タイル・シート・カーペット / IME・長押し / 保存ボタン・必須入力 / 部位・単位 / Tab維持'
  )
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
