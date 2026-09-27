import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { inspectPdf } from './pdf-e2e.mjs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const temporary = mkdtempSync(join(tmpdir(), 'sekisan-wall-panels-'))
const pdfPath = join(temporary, '割り付け範囲.pdf')
const pdf = await PDFDocument.create()
pdf.addPage([842, 595])
writeFileSync(pdfPath, await pdf.save())
const env = { ...process.env, SEKISAN_DATA_DIR: join(temporary, 'data') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
mkdirSync('test-results', { recursive: true })
let application
try {
  application = await electron.launch({ args: ['.'], cwd: resolve('.'), env })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: '顧客を追加', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '顧客を追加', exact: true }).click()
  await page.getByRole('textbox', { name: '顧客名' }).fill('囲い直しテスト')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '案件を作成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '案件名' }).fill('床仕上げ工事')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, pdfPath)
  await page.getByRole('button', { name: '図面を取り込む', exact: true }).click()
  await expect(page.getByRole('button', { name: '割り付け範囲.pdf', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const check = (r) => {
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
    const w = check(await window.sekisan.workspace())
    const address = { drawingId: w.drawings[0].id, pageNumber: 1 }
    const polygon = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 }
    ]
    let state = check(
      await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: 0,
        change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }
      })
    )
    state = check(
      await window.sekisan.applyTakeoff({
        ...address,
        expectedRevision: state.revision,
        change: {
          kind: 'room',
          id: crypto.randomUUID(),
          input: {
            name: '会議室',
            color: '#327e6d',
            heightMm: 2400,
            polygon,
            enabledCategories: ['floor'],
            sleeveWalls: [],
            finishes: Object.fromEntries(
              ['wall', 'floor', 'ceiling', 'baseboard'].map((c) => [
                c,
                { name: '', unitPrice: null }
              ])
            )
          }
        }
      })
    )
  })

  const snapshot = () =>
    page.evaluate(async () => {
      const w = (await window.sekisan.workspace()).data
      return (await window.sekisan.readTakeoff({ drawingId: w.drawings[0].id, pageNumber: 1 })).data
    })
  const before = await snapshot(),
    roomId = before.rooms[0].id
  await page
    .locator('.drawing-card')
    .first()
    .getByRole('button', { name: /の割り付け$/ })
    .click()
  await expect(page.locator('.layout-screen')).toHaveAttribute('aria-busy', 'false')
  const materialIds = await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data,
      ids = [crypto.randomUUID(), crypto.randomUUID()]
    for (const [i, name, width, height] of [
      [0, '壁用タイル', 400, 300],
      [1, 'プラベニア', 910, 1820]
    ]) {
      const r = await window.sekisan.changeMaterials({
        kind: 'save',
        id: ids[i],
        input: {
          projectId: w.projects[0].id,
          category: 'wall',
          name,
          unitPrice: null,
          unit: '㎡',
          layoutType: 'tile',
          tileWidthMm: width,
          tileHeightMm: height,
          tileThicknessMm: i === 0 ? 6 : 2.5
        }
      })
      if (!r.ok) throw Error(r.error)
    }
    return ids
  })
  await page.getByRole('button', { name: '壁材', exact: true }).click()
  await expect(page.locator('.wall-screen')).toHaveAttribute('aria-busy', 'false')
  await page.getByTestId('wall-edge-0').click({ force: true })
  await page.getByLabel('壁材の種類').selectOption('tile')
  await expect(page.getByLabel('材料のW（mm）', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('材料のL（mm）', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '壁の割り付けを保存', exact: true })).toBeDisabled()
  await page.getByLabel('壁の板材・タイル材料').selectOption(materialIds[0])
  await expect(page.getByLabel('材料のW（mm）', { exact: true })).toHaveValue('400')
  const totals = page.getByTestId('wall-panel-totals')
  await expect(totals).toContainText('80枚')
  await expect(totals).toContainText('全形 80枚 ／ カット 0枚')
  const layout = () =>
    page
      .getByRole('img', { name: '壁の展開図' })
      .locator('g[data-panel-number]')
      .evaluateAll((nodes) => nodes.map((n) => n.innerHTML))
  const straight = await layout()
  await page.getByLabel('壁タイルの貼り方').selectOption('half')
  await expect(totals).toContainText('84枚')
  assert.notDeepEqual(await layout(), straight)
  await page.getByLabel('壁タイルの目地幅（mm）').fill('3')
  const half = await layout()
  await page.getByLabel('壁材の割り付け基準').selectOption('tile')
  assert.notDeepEqual(await layout(), half)
  await page.getByLabel('壁材の横移動（mm）').fill('50')
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  await expect(page.getByLabel('壁材の横移動（mm）')).toHaveValue('0')
  // Openings change board geometry, without changing original takeoff quantities.
  await page.getByRole('button', { name: '窓・ドアを追加', exact: true }).click()
  await page.getByLabel('左端から（mm）', { exact: true }).fill('200')
  await expect(totals).toContainText('8.0㎡')
  const side = page.getByLabel('壁材の貼り始め'),
    beforeRight = await layout()
  await side.selectOption('right')
  assert.notDeepEqual(await layout(), beforeRight)
  await expect(page.getByLabel('左端から（mm）', { exact: true })).toHaveValue('200')
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  assert.deepEqual(await layout(), beforeRight)
  await side.selectOption('right')

  await page.getByRole('button', { name: '壁の割り付けを保存', exact: true }).click()
  await expect(page.locator('.wall-screen').getByRole('status')).toContainText('保存しました')
  const readWalls = () =>
    page.evaluate(async () => {
      const w = (await window.sekisan.workspace()).data
      const r = await window.sekisan.readWalls({ drawingId: w.drawings[0].id, pageNumber: 1 })
      if (!r.ok) throw Error(r.error)
      return r.data
    })
  const saved = (await readWalls())[0]
  assert.equal(saved.body.startSide, 'right')
  assert.equal(saved.body.kind, 'tile')
  assert.equal(saved.body.panel.pattern, 'half')
  assert.equal(saved.body.panel.gapMm, 3)
  assert.deepEqual(await snapshot(), before)
  await page.locator('.wall-details').evaluate((e) => (e.scrollTop = 0))
  await page.screenshot({ path: 'test-results/wall-tile.png' })
  // Reload and retain exact board outlines.
  const savedGeometry = await layout()
  await page.getByRole('button', { name: '床材', exact: true }).click()
  await page.getByRole('button', { name: '壁材', exact: true }).click()
  await expect(page.getByLabel('壁材の種類')).toHaveValue('tile')
  assert.deepEqual(await layout(), savedGeometry)
  await expect(side).toHaveValue('right')
  // PDF uses same vector diagram and includes material dimensions and cut schedule.
  const exportPdf = async (label, path) => {
    await page.getByRole('button', { name: '壁のPDFプレビュー・保存', exact: true }).click()
    await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
      timeout: 30000
    })
    await application.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, path)
    await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
    await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
    const text = (await inspectPdf(readFileSync(path), true)).join('')
    assert.match(text, label)
    assert.match(text, /右から/)
    assert.match(text, /必要元材/)
    assert.match(text, /外形/)
    writeFileSync('test-results/' + path.split('/').at(-1), readFileSync(path))
    await page.screenshot({ path: 'test-results/wall-panel-pdf.png' })
    await page.getByRole('button', { name: '閉じる', exact: true }).click()
  }
  await exportPdf(/壁タイル割り付け/, join(temporary, 'wall-tile.pdf'))
  // A separate wall uses the same source edge for protective boards.
  await page.getByTestId('wall-edge-0').click({ force: true })
  await page.getByLabel('壁材の種類').selectOption('protection')
  await expect(page.getByLabel('壁タイルの貼り方')).toHaveCount(0)
  await page.getByLabel('壁の板材・タイル材料').selectOption(materialIds[1])
  await page.getByLabel('壁材の割り付け基準').selectOption('edge')
  await page.getByLabel('養生高さ（mm・空欄は壁上端まで）').fill('900')
  await expect(totals).toContainText('3.6㎡')
  await expect(totals).toContainText('5枚')
  await expect(side).toHaveValue('right')
  await expect(page.getByLabel('壁材の割り付け基準').locator('option:checked')).toHaveText(
    '右下から'
  )
  const rightGeometry = await layout()
  await side.selectOption('left')
  assert.notDeepEqual(await layout(), rightGeometry)
  await side.selectOption('right')
  assert.deepEqual(await layout(), rightGeometry)
  await page.getByRole('button', { name: /材料を90°回転/ }).click()
  await expect(totals).toContainText('3枚')
  await page.getByLabel('施工範囲の床からの高さ（mm）').fill('2000')
  await expect(page.getByRole('alert')).toContainText('高さ内')
  await expect(page.getByRole('button', { name: '壁の割り付けを保存', exact: true })).toBeDisabled()
  await page.getByLabel('施工範囲の床からの高さ（mm）').fill('0')
  // Right pan changes only view, never board placement.
  const overlay = page.getByTestId('wall-plan'),
    box = await overlay.boundingBox(),
    geometry = await layout()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  assert.deepEqual(await layout(), geometry)
  await page.getByRole('button', { name: '壁の割り付けを保存', exact: true }).click()
  await expect(page.locator('.wall-screen').getByRole('status')).toContainText('保存しました')
  let docs = await readWalls()
  assert.equal(docs.length, 2)
  assert.equal(docs[1].body.kind, 'protection')
  assert.equal(docs[1].body.panel.coverageHeightMm, 900)
  await page.locator('.wall-details').evaluate((e) => (e.scrollTop = 0))
  await page.screenshot({ path: 'test-results/wall-protection.png' })
  await exportPdf(/プラベニア/, join(temporary, 'wall-protection.pdf'))
  assert.deepEqual(await snapshot(), before)
  // Batch selection, mixed wall materials, page boundaries, and saved PDF.
  await page.evaluate(async () => {
    const w = (await window.sekisan.workspace()).data
    const address = { drawingId: w.drawings[0].id, pageNumber: 1 }
    const source = (await window.sekisan.readWalls(address)).data[0]
    for (const name of ['まとめ用クロス面', '出力しない面']) {
      const r = await window.sekisan.saveWall({
        ...address,
        id: crypto.randomUUID(),
        expectedRevision: 0,
        body: {
          ...source.body,
          name,
          kind: 'wallpaper',
          panel: undefined,
          materialName: name === '出力しない面' ? '除外材料' : 'まとめクロス',
          material: {
            widthMm: 920,
            repeatMm: 0,
            horizontalRepeatMm: 0,
            match: 'none',
            stepMm: 0,
            rollLengthMm: 50000
          }
        }
      })
      if (!r.ok) throw Error(r.error)
    }
  })
  await page.getByRole('button', { name: '床材', exact: true }).click()
  await page.getByRole('button', { name: '壁材', exact: true }).click()
  await expect(page.locator('.wall-screen')).toHaveAttribute('aria-busy', 'false')
  const batchButton = page.getByRole('button', { name: '壁を選んでまとめてPDF', exact: true })
  await page.getByLabel('壁の名前', { exact: true }).fill('編集中')
  await expect(batchButton).toBeDisabled()
  await page.getByRole('button', { name: 'ひとつ戻す', exact: true }).click()
  await batchButton.click()
  await expect(page.getByRole('dialog', { name: 'PDFにまとめる壁を選択' })).toBeVisible()
  await page.getByRole('button', { name: '選択を解除', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '選択した壁のPDFプレビュー', exact: true })
  ).toBeDisabled()
  await page.getByRole('button', { name: 'すべて選択', exact: true }).click()
  await page.getByRole('checkbox', { name: /出力しない面/ }).uncheck()
  await page.screenshot({ path: 'test-results/wall-batch-selection.png' })
  await page.getByRole('button', { name: '選択した壁のPDFプレビュー', exact: true }).click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await expect(page.getByText('選択した壁 3面の数量一覧・展開図・使用材料 · A4横')).toBeVisible()
  const batchPath = join(temporary, 'wall-batch.pdf')
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, batchPath)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const batchPages = await inspectPdf(readFileSync(batchPath), true)
  assert.match(batchPages[0], /選択面の数量一覧/)
  assert.match(batchPages[0], /19.6/)
  assert.match(batchPages[0], /壁用タイル/)
  assert.match(batchPages[0], /プラベニア/)
  assert.match(batchPages[0], /まとめクロス/)
  assert.doesNotMatch(batchPages.join(''), /出力しない面|除外材料/)
  const tilePage = batchPages.findIndex((p) => p.includes('壁タイル割り付け'))
  const boardPage = batchPages.findIndex((p) => p.includes('プラベニア・板材養生割り付け'))
  const paperPage = batchPages.findIndex((p) => p.includes('壁クロス割り付け'))
  assert.ok(tilePage > 0 && boardPage > tilePage && paperPage > boardPage)
  for (let i = tilePage + 1; i < boardPage; i++)
    assert.match(batchPages[i], /会議室・壁1.*壁用タイル/)
  assert.ok(
    batchPages.every((p) => p.length > 40),
    'No blank pages'
  )
  writeFileSync('test-results/wall-batch.pdf', readFileSync(batchPath))
  await page.screenshot({ path: 'test-results/wall-batch-preview.png' })
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  docs = await readWalls()
  assert.equal(docs.length, 4)
  assert.deepEqual(await snapshot(), before)
  // Switching back keeps the stored wallpaper behavior and discards safely.
  await page.getByLabel('壁材の種類').selectOption('wallpaper')
  await expect(page.getByLabel('クロスの有効幅（mm）')).toBeVisible()
  await page.getByRole('button', { name: '床材', exact: true }).click()
  await page.getByRole('button', { name: '続ける', exact: true }).click()
  assert.deepEqual(await readWalls(), docs)
  console.log(
    'PASS 壁タイル・養生板: 規格未設定/マスタ・通し/馬貼り/目地・中心/移動/Undo・開口・養生高さ・90度回転・右パン・保存再表示・PDF・元数量保持'
  )
} catch (error) {
  console.error(error)
  const page = await application?.firstWindow()
  await page?.screenshot({ path: 'test-results/wall-panels-failure.png' })
  await application?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  )
  throw error
} finally {
  await application?.close()
  rmSync(temporary, { recursive: true, force: true })
}
