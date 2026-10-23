import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const temporary = mkdtempSync(join(tmpdir(), 'dimension-e2e-'))
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
    await expect(page.getByTestId('room-card')).toHaveCount(1)
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
  const before = await read()
  await page.getByRole('button', { name: '寸法線', exact: true }).click()
  await point(100, 100)
  await point(500, 100)
  await expect(page.getByTestId('dimension-draft')).toContainText('4,000 mm')
  assert.equal((await read()).dimensionLines, undefined)
  await point(300, 60)
  await expect(page.getByTestId('dimension-line')).toHaveCount(1)
  await expect(page.getByTestId('dimension-line')).toContainText('4,000 mm')
  assert.deepEqual((await read()).items, before.items)
  assert.deepEqual((await read()).rooms, before.rooms)
  // A vertical dimension, then a partially drawn line canceled with Escape.
  await point(500, 100)
  await point(500, 400)
  await point(550, 250)
  await expect(page.getByTestId('dimension-line')).toHaveCount(2)
  await expect(page.getByTestId('dimension-line').nth(1)).toContainText('3,000 mm')
  await point(600, 100)
  await page.getByTestId('drawing-overlay').press('Escape')
  assert.equal((await read()).dimensionLines.length, 2)
  // Move the label/line without moving its measured endpoints.
  await page.getByTestId('dimension-line').first().locator('text').click()
  await page.getByRole('button', { name: '線の位置を変更', exact: true }).click()
  await point(300, 450)
  await expect.poll(async () => (await read()).dimensionLines[0].offset).toBeGreaterThan(300)
  const saved = await read()
  assert.deepEqual(saved.dimensionLines[0].points, [
    before.rooms[0].polygon[0],
    before.rooms[0].polygon[1]
  ])
  await page.getByRole('button', { name: '選択', exact: true }).click()
  const show = page.getByRole('checkbox', { name: /寸法線を表示/ })
  await show.uncheck()
  await expect(page.getByTestId('dimension-line')).toHaveCount(0)
  await show.check()
  await expect(page.getByTestId('dimension-line')).toHaveCount(2)
  await page.getByRole('button', { name: '拡大', exact: true }).click()
  await expect(page.getByTestId('dimension-line').first()).toContainText('4,000 mm')
  assert.deepEqual(await read(), saved)
  await page.getByRole('button', { name: '幅に合わせる', exact: true }).click()
  await page.screenshot({ path: 'test-results/dimension-takeoff.png' })
  await app.close()
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  await open()
  await expect(page.getByTestId('dimension-line')).toHaveCount(2)
  assert.deepEqual(await read(), saved)
  await page.getByTestId('dimension-line').first().locator('text').click()
  await page.getByRole('button', { name: 'この寸法線を削除', exact: true }).click()
  await expect(page.getByTestId('dimension-line')).toHaveCount(1)
  assert.deepEqual((await read()).items, before.items)
  assert.deepEqual((await read()).rooms, before.rooms)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: horizontal/vertical dimensions, offset move, cancellation, visibility, zoom, restart, deletion, quantities unchanged.'
  )
} finally {
  if (app) await app.close()
  rmSync(temporary, { recursive: true, force: true })
}
