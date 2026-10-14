import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'

const temporary = mkdtempSync(join(tmpdir(), 'roll-seams-e2e-'))
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
  const page = await app.firstWindow(),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const seamInput = (lane = 1, unit = 'm') =>
    page.getByLabel(`帯${lane}の継ぎ1の位置（${unit}）`, { exact: true })
  const seam = (lane) => page.getByRole('slider', { name: `帯${lane}の継ぎ位置1`, exact: true })
  await page.waitForFunction(() => !!window.sekisan)
  await page.evaluate(async (f) => {
    const result = await window.sekisan.changeMaterials({
      kind: 'save',
      id: crypto.randomUUID(),
      input: {
        projectId: f.projectId,
        category: 'floor',
        name: '床材',
        specification: '',
        unitPrice: 1000,
        layoutType: 'sheet',
        tileWidthMm: 2000,
        tileHeightMm: 2500
      }
    })
    if (!result.ok) throw new Error(JSON.stringify(result))
    location.hash = `/layout/${f.address.drawingId}`
  }, f)
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByLabel('割付の材料の種類', { exact: true })).toHaveValue('sheet')
  await expect(page.getByLabel('最大出荷L（m・任意）', { exact: true })).toHaveValue('2.5')
  await expect(
    page.getByRole('checkbox', { name: '最大出荷Lで継ぎ位置を自動配置', exact: true })
  ).toBeChecked()
  await button('壁寄せ 壁から真物').click()
  await page.getByLabel('切りしろ（両端各・mm）', { exact: true }).fill('50')
  await expect(page.getByRole('slider')).toHaveCount(2)
  await expect(seamInput()).toHaveValue('2.4')
  await expect(page.getByTestId('roll-total-length')).toContainText('6.4 m')
  await expect(page.getByTestId('roll-total-area')).toContainText('12.8')
  await seamInput().fill('2')
  await seamInput(2).focus()
  await expect(seam(1)).toHaveAttribute('aria-valuenow', '2000')
  await expect(seam(2)).toHaveAttribute('aria-valuenow', '2400')
  await seamInput().fill('2.8')
  await expect(page.getByRole('alert')).toContainText('最大出荷Lを超えるシート')
  await seamInput().fill('2')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await button('全体表示').click()
  await expect(page.locator('.layout-screen .pdf-scroll')).toHaveAttribute('aria-busy', 'false')
  const line = seam(1).locator('line').first()
  const box = await line.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2 + 10, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(async () => Number(await seam(1).getAttribute('aria-valuenow')))
    .toBeGreaterThan(2000)
  await expect(seam(2)).toHaveAttribute('aria-valuenow', '2400')
  await expect(page.getByLabel('縦の移動量（mm）', { exact: true })).toHaveValue('0')
  await button('ひとつ戻す').click()
  await expect(seam(1)).toHaveAttribute('aria-valuenow', '2000')
  await seam(1).press('ArrowDown')
  await expect(seam(1)).toHaveAttribute('aria-valuenow', '2010')
  await seamInput().fill('2')
  await button('割り付けを保存').click()
  await expect(page.getByText('割り付けを保存しました。', { exact: true })).toBeVisible()
  const roomId = f.takeoff.rooms[0].id
  const saved = await page.evaluate(
    async (id) => (await window.sekisan.readLayout(id)).data,
    roomId
  )
  assert.equal(saved.body.rollSeams[0].positionsMm[0], 2000)
  await page.reload()
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  await expect(seam(1)).toHaveAttribute('aria-valuenow', '2000')
  await expect(seam(2)).toHaveAttribute('aria-valuenow', '2400')
  await seamInput().scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/roll-seams-adjusted.png' })

  // The exported diagram and quantities must use the adjusted, saved joins.
  await button('PDFプレビュー・保存').click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  const pdfPath = join(temporary, 'joins.pdf')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, pdfPath)
  await button('PDFを保存').click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const bytes = readFileSync(pdfPath),
    pages = await inspectPdf(bytes, true)
  assert.match(pages.join(''), /仮の継ぎ位置/)
  assert.match(pages.join(''), /12\.8/)
  assert.match(pages.join(''), /2\.1 m/)
  writeFileSync('test-results/roll-seams.pdf', bytes)
  await page.screenshot({ path: 'test-results/roll-seams-pdf.png' })
  await button('閉じる').click()
  await button('継ぎ位置を自動に戻す').click()
  await expect(seam(1)).toHaveAttribute('aria-valuenow', '2400')
  await button('ひとつ戻す').click()
  await expect(seam(1)).toHaveAttribute('aria-valuenow', '2000')
  await page.getByLabel('割付の材料の種類', { exact: true }).selectOption('carpet')
  await page.getByLabel('最大出荷L（mm・任意）', { exact: true }).fill('2500')
  await expect(seamInput(1, 'mm')).toHaveValue('2000')
  await seamInput(1, 'mm').fill('1900')
  await expect(seam(2)).toHaveAttribute('aria-valuenow', '2400')
  await page.getByLabel('壁からの回転（°）', { exact: true }).fill('90')
  await expect(
    page.getByText('割付条件が変わったため、継ぎ位置は自動配置に戻っています。', { exact: true })
  ).toBeVisible()
  assert.deepEqual(
    await page.evaluate(
      async (address) => (await window.sekisan.readTakeoff(address)).data,
      f.address
    ),
    f.takeoff
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS 自動継ぎ・材料規格読込・帯別寸法調整・ドラッグ・キーボード・取消・保存再読込・PDF・回転再配置・拾い出し保持'
  )
} finally {
  await app?.close()
  rmSync(temporary, { recursive: true, force: true })
}
