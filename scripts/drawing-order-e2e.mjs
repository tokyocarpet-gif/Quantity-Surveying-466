import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
const temporary = mkdtempSync(join(tmpdir(), 'drawing-order-e2e-'))
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
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForFunction(() => !!window.sekisan)
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path, path] })
    },
    join(temporary, 'drawing.pdf')
  )
  const before = await page.evaluate(async (f) => {
    const unwrap = (r) => {
      if (!r.ok) throw new Error(JSON.stringify(r))
      return r.data
    }
    const added = unwrap(await window.sekisan.importPdfs(f.projectId)).imported
    const first = unwrap(await window.sekisan.readTakeoff(f.address))
    const { id, drawingId, pageNumber, groupId, ...input } = first.rooms[0]
    for (const [index, drawing] of added.entries()) {
      const address = { drawingId: drawing.id, pageNumber: 1 }
      unwrap(await window.sekisan.renameDrawing(drawing.id, `図面${index + 2}.pdf`))
      unwrap(
        await window.sekisan.applyTakeoff({
          ...address,
          expectedRevision: 0,
          change: {
            kind: 'scale',
            points: first.calibration.points,
            lengthMm: first.calibration.lengthMm
          }
        })
      )
      unwrap(
        await window.sekisan.applyTakeoff({
          ...address,
          expectedRevision: 1,
          change: {
            kind: 'room',
            id: crypto.randomUUID(),
            input: { ...input, name: `部屋${index + 2}` }
          }
        })
      )
    }
    const workspace = unwrap(await window.sekisan.workspace())
    const project = workspace.projects.find((p) => p.id === f.projectId)
    unwrap(
      await window.sekisan.saveSelection({ clientId: project.clientId, projectId: project.id })
    )
    return workspace.drawings.filter((d) => d.projectId === f.projectId).map((d) => d.id)
  }, f)
  await page.reload()
  const order = () =>
    page.getByTestId('drawing-card').evaluateAll((cards) => cards.map((c) => c.dataset.drawingId))
  await expect.poll(order).toEqual(before)
  const cards = page.getByTestId('drawing-card')
  await cards
    .first()
    .getByRole('button', { name: /を並べ替え$/ })
    .dragTo(cards.last())
  const desired = [before[1], before[2], before[0]]
  await expect.poll(order).toEqual(desired)
  await cards
    .first()
    .getByRole('button', { name: /を後へ$/ })
    .click()
  await expect.poll(order).toEqual([before[2], before[1], before[0]])
  await cards
    .first()
    .getByRole('button', { name: /を並べ替え$/ })
    .press('Alt+ArrowDown')
  await expect.poll(order).toEqual(desired)
  await page.screenshot({ path: 'test-results/drawing-order.png' })
  await page.getByPlaceholder('図面名で検索').fill('図面')
  await expect(
    page
      .getByTestId('drawing-card')
      .first()
      .getByRole('button', { name: /を並べ替え$/ })
  ).toBeDisabled()
  await page.getByPlaceholder('図面名で検索').fill('')
  await app.close()
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect.poll(order).toEqual(desired)
  await page.evaluate((id) => {
    location.hash = `/summary/${id}`
  }, f.projectId)
  await expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await expect
    .poll(() => page.getByTestId('summary-row').locator('td:first-child strong').allTextContents())
    .toEqual(['部屋2', '部屋3', '会議室'])
  const exportPath = resolve('test-results/drawing-order-export.xlsx')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await page.getByRole('button', { name: '表示中の集計をExcel保存', exact: true }).click()
  await page.getByRole('button', { name: 'Excelを保存', exact: true }).click()
  await expect(page.locator('.summary-notice')).toContainText('Excelを保存しました')
  const xml = new AdmZip(exportPath).readAsText('xl/worksheets/sheet2.xml')
  assert.ok(xml.indexOf('部屋2') < xml.indexOf('部屋3'))
  assert.ok(xml.indexOf('部屋3') < xml.indexOf('会議室'))
  const after = await page.evaluate(
    async (address) => (await window.sekisan.readTakeoff(address)).data,
    f.address
  )
  assert.deepEqual(after, f.takeoff)
  assert.deepEqual(errors, [])
  console.log(
    'PASS drawing drag, buttons, keyboard, restart, summary, Excel and unchanged quantities.'
  )
} finally {
  if (app) await app.close()
  rmSync(temporary, { recursive: true, force: true })
}
