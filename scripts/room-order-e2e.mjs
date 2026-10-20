import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const temporary = mkdtempSync(join(tmpdir(), 'room-order-e2e-'))
const env = { ...process.env, SEKISAN_DATA_DIR: join(temporary, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
mkdirSync('test-results', { recursive: true })
let app
try {
  const seed = spawnSync(
    electronPath,
    ['--import', 'tsx', 'scripts/estimate-modern-fixture.ts', temporary],
    {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8'
    }
  )
  assert.equal(seed.status, 0, seed.stderr)
  const f = JSON.parse(readFileSync(join(temporary, 'fixture.json'), 'utf8'))
  app = await electron.launch({ args: ['.'], env })
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForFunction(() => !!window.sekisan)
  const before = await page.evaluate(async (f) => {
    const unwrap = (r) => {
      if (!r.ok) throw new Error(JSON.stringify(r))
      return r.data
    }
    for (const name of ['事務室', '廊下']) {
      const state = unwrap(await window.sekisan.readTakeoff(f.address))
      const { id, drawingId, pageNumber, groupId, ...input } = state.rooms[0]
      input.finishes.floor.specification = '省略する規格500×500×5mm'
      unwrap(
        await window.sekisan.applyTakeoff({
          ...f.address,
          expectedRevision: state.revision,
          change: { kind: 'room', id: crypto.randomUUID(), input: { ...input, name } }
        })
      )
    }
    const state = unwrap(await window.sekisan.readTakeoff(f.address))
    location.hash = `/drawing/${f.address.drawingId}`
    return state
  }, f)
  const ids = before.rooms.map((r) => r.groupId)
  const card = (id) => page.locator(`[data-room-group="${id}"]`)
  const order = () =>
    page.getByTestId('room-card').evaluateAll((cards) => cards.map((c) => c.dataset.roomGroup))
  const read = () =>
    page.evaluate(async (address) => (await window.sekisan.readTakeoff(address)).data, f.address)
  await expect(page.getByTestId('room-card')).toHaveCount(3)
  await card(ids[0]).click()
  const quantities = await card(ids[0]).innerText()
  const lastBox = await card(ids[2]).boundingBox()
  await card(ids[0]).dragTo(card(ids[2]), { targetPosition: { x: 30, y: lastBox.height - 5 } })
  await expect.poll(order).toEqual([ids[1], ids[2], ids[0]])
  await expect(page.getByText('部屋の並び順を保存しました', { exact: true })).toBeVisible()
  await expect(card(ids[0])).toHaveClass(/selected/)
  assert.equal(await card(ids[0]).innerText(), quantities)
  const after = await read()
  assert.deepEqual(after.items, before.items)
  assert.deepEqual(after.deductions, before.deductions)
  assert.deepEqual(
    after.rooms.toSorted((a, b) => a.id.localeCompare(b.id)),
    before.rooms.toSorted((a, b) => a.id.localeCompare(b.id))
  )
  // Upward insertion and a keyboard alternative both save immediately.
  await card(ids[0]).dragTo(card(ids[1]), { targetPosition: { x: 30, y: 3 } })
  await expect.poll(order).toEqual(ids)
  await card(ids[2]).press('Alt+ArrowUp')
  await expect.poll(order).toEqual([ids[0], ids[2], ids[1]])
  await page.screenshot({ path: 'test-results/room-order.png' })
  await app.close()
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForFunction(() => !!window.sekisan)
  await page.evaluate((id) => {
    location.hash = `/drawing/${id}`
  }, f.address.drawingId)
  await expect.poll(order).toEqual([ids[0], ids[2], ids[1]])
  assert.deepEqual((await read()).items, before.items)
  // Summary views and the actual Excel save workflow must use the same order.
  await page.evaluate((id) => {
    location.hash = `/summary/${id}`
  }, f.projectId)
  const summaryOrder = () =>
    page.getByTestId('summary-row').locator('td:first-child strong').allTextContents()
  await expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(summaryOrder).toEqual(['会議室', '廊下', '事務室'])
  await page.getByRole('tab', { name: '部屋別', exact: true }).click()
  await expect(page.getByRole('tab', { name: '部屋別', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(summaryOrder).toEqual(['会議室', '廊下', '事務室'])
  await page.getByRole('tab', { name: '部屋×仕上げ', exact: true }).click()
  await expect(page.getByRole('tab', { name: '部屋×仕上げ', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.locator('.summary-page')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(summaryOrder).toEqual(['会議室', '廊下', '事務室'])
  await page.screenshot({ path: 'test-results/summary-room-order.png' })
  const exportPath = resolve('test-results/summary-order-export.xlsx')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await page.getByRole('button', { name: '表示中の集計をExcel保存', exact: true }).click()
  await expect(page.getByText(/規格は出力せず、規格だけの行は作りません/)).toBeVisible()
  await page.getByRole('button', { name: 'Excelを保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Excelを保存しました')
  const xml = new AdmZip(exportPath).readAsText('xl/worksheets/sheet2.xml')
  const cell = (address) =>
    xml.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?</c>`))?.[0] ?? ''
  for (const [index, name] of ['会議室', '廊下', '事務室'].entries()) {
    assert.ok(cell(`B${index + 4}`).includes(name))
    assert.ok(cell(`D${index + 4}`).includes('床材'))
    assert.ok(cell(`I${index + 4}`).includes('<v>12000</v>'))
  }
  assert.ok(!xml.includes('省略する規格'))
  assert.ok(cell('I25').includes('<v>36000</v>'))
  await page.evaluate((id) => {
    location.hash = `/drawing/${id}`
  }, f.address.drawingId)
  await expect.poll(order).toEqual([ids[0], ids[2], ids[1]])
  // A concurrent update is rejected rather than silently overwriting newer data.
  const current = await read()
  await page.evaluate(
    async ({ address, revision, groupIds }) => {
      const result = await window.sekisan.reorderRooms({
        ...address,
        expectedRevision: revision,
        groupIds
      })
      if (!result.ok) throw new Error(JSON.stringify(result))
    },
    { address: f.address, revision: current.revision, groupIds: ids }
  )
  await card(ids[0]).dragTo(card(ids[1]), { targetPosition: { x: 30, y: 3 } })
  await expect(page.getByRole('alert')).toContainText('ページを開き直して')
  assert.deepEqual(
    (await read()).rooms.map((r) => r.groupId),
    ids
  )
  assert.deepEqual(errors, [])
  console.log(
    'Room order E2E passed: drag down/up, keyboard, persistence, summary views, compact Excel export, quantities, conflict safety.'
  )
} finally {
  if (app) await app.close()
  rmSync(temporary, { recursive: true, force: true })
}
