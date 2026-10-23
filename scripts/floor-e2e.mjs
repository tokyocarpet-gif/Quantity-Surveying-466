import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'

const temporary = mkdtempSync(join(tmpdir(), 'floor-e2e-'))
const env = { ...process.env, SEKISAN_DATA_DIR: join(temporary, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let app
try {
  const seed = spawnSync(
    electronPath,
    ['--import', 'tsx', 'scripts/estimate-modern-fixture.ts', temporary],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }
  )
  assert.equal(seed.status, 0, seed.stderr)
  const f = JSON.parse(readFileSync(join(temporary, 'fixture.json'), 'utf8'))
  app = await electron.launch({ args: ['.'], env })
  let page = await app.firstWindow()
  const errors = []
  const open = async () => {
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForFunction(() => !!window.sekisan)
    await page.evaluate((id) => {
      location.hash = `/drawing/${id}`
    }, f.address.drawingId)
    await expect(page.getByTestId('room-card').first()).toBeVisible()
  }
  await open()
  const read = () =>
    page.evaluate(async (address) => (await window.sekisan.readTakeoff(address)).data, f.address)
  const point = async (x, y) => {
    const overlay = page.getByTestId('drawing-overlay')
    const rect = await overlay.boundingBox()
    const [, , width, height] = (await overlay.getAttribute('viewBox')).split(' ').map(Number)
    await overlay.click({
      position: { x: (x / width) * rect.width, y: (y / height) * rect.height }
    })
  }
  const draw = async (floor) => {
    await page.getByRole('checkbox', { name: '矩形', exact: true }).check()
    await page.getByRole('button', { name: '部屋を追加', exact: true }).click()
    await point(550, 120)
    await point(750, 300)
    await expect(page.getByLabel('部屋の階', { exact: true })).toHaveValue(floor)
  }
  await page.getByLabel('新しい部屋の階', { exact: true }).fill('1階')
  await draw('1階')
  await page.getByLabel('部屋名', { exact: true }).fill('廊下')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByTestId('room-card')).toHaveCount(2)
  await draw('1階')
  await page.getByRole('button', { name: '編集をやめる', exact: true }).click()
  await page.getByLabel('新しい部屋の階', { exact: true }).fill('2階')
  await draw('2階')
  await page.getByLabel('部屋名', { exact: true }).fill('廊下')
  await page.getByRole('button', { name: '数量を確認', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '同名の部屋があります', exact: true })
  ).toHaveCount(0)
  await page.getByRole('button', { name: '反映する', exact: true }).click()
  await expect(page.getByTestId('room-card')).toHaveCount(3)
  const saved = await read()
  assert.deepEqual(
    saved.rooms.map((r) => [r.name, r.floor ?? '']),
    [
      ['会議室', ''],
      ['廊下', '1階'],
      ['廊下', '2階']
    ]
  )
  await page.screenshot({ path: 'test-results/floor-takeoff.png' })
  await app.close()
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  await open()
  await expect(page.getByLabel('新しい部屋の階', { exact: true })).toHaveValue('2階')
  assert.deepEqual(await read(), saved)
  await page.evaluate((id) => {
    location.hash = `/summary/${id}`
  }, f.projectId)
  await expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await expect(
    page.getByTestId('summary-row').filter({ hasText: '1階 廊下' }).first()
  ).toBeVisible()
  await expect(
    page.getByTestId('summary-row').filter({ hasText: '2階 廊下' }).first()
  ).toBeVisible()
  const exportPath = resolve('test-results/floor-export.xlsx')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await page.getByRole('button', { name: '表示中の集計をExcel保存', exact: true }).click()
  await page.getByRole('button', { name: 'Excelを保存', exact: true }).click()
  await expect(page.locator('.summary-notice')).toContainText('Excelを保存しました')
  const xml = new AdmZip(exportPath).readAsText('xl/worksheets/sheet2.xml')
  assert.ok(xml.includes('1階 廊下'))
  assert.ok(xml.includes('2階 廊下'))
  assert.equal((xml.match(/<rowBreaks\b/g) ?? []).length, 1)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: floor defaults, same-name rooms across floors, persistence, summary and Excel.'
  )
} finally {
  if (app) await app.close()
  rmSync(temporary, { recursive: true, force: true })
}
