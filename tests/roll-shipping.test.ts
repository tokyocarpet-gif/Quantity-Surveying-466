import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayout,
  defaultLayout,
  layoutBodySchema,
  rollMaterialRows
} from '../src/shared/layout'
import { layoutPrintHtml } from '../src/main/layout-print'
const polygon = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 6000 },
  { x: 0, y: 6000 }
]
const body = {
  ...defaultLayout(),
  layoutType: 'carpet' as const,
  mode: 'wall' as const,
  widthMm: 1820,
  maxWidthMm: 3640,
  heightMm: 20000,
  trimMm: 50
}
test('フリーカットは実使用W×使用L、幅なり出荷は最大W×使用Lで計算する', () => {
  const free = computeLayout(polygon, 0.001, { ...body, rollCutMode: 'free' }).roll!
  const width = computeLayout(polygon, 0.001, body).roll!
  assert.deepEqual(
    free.strips.map((s) => s.cutWidthMm),
    [1820, 1820, 360]
  )
  assert.deepEqual(
    width.strips.map((s) => s.cutWidthMm),
    [3640, 3640, 3640]
  )
  assert.ok(Math.abs(free.requiredArea - 24.4) < 1e-8)
  assert.ok(Math.abs(width.requiredArea - 66.612) < 1e-8)
  assert.equal(free.rollCount, null)
  const rows = rollMaterialRows(free.strips)
  assert.deepEqual(
    rows.map((r) => r.sheets),
    [[1, 2], [3]]
  )
  assert.equal(rows[0].lengthMm, 6100)
  assert.ok(Math.abs(rows.reduce((sum, r) => sum + r.area, 0) - free.requiredArea) < 1e-8)
})
test('最大出荷Lは上限確認に使い、未設定や長い上限へ変更しても使用材料数量を増やさない', () => {
  const normal = computeLayout(polygon, 0.001, body).roll!
  for (const heightMm of [null, 30000, 100000]) {
    const r = computeLayout(polygon, 0.001, { ...body, heightMm }).roll!
    assert.equal(r.requiredArea, normal.requiredArea)
    assert.equal(r.lengthM, normal.lengthM)
  }
  assert.equal(computeLayout(polygon, 0.001, { ...body, heightMm: 6000 }).roll!.overLength, true)
  assert.equal(computeLayout(polygon, 0.001, { ...body, heightMm: 6100 }).roll!.overLength, false)
  assert.throws(() => computeLayout(polygon, 0.001, { ...body, widthMm: 4000 }), /最大出荷W/)
  const sheet = computeLayout(polygon, 0.001, {
    ...body,
    layoutType: 'sheet',
    rollCutMode: 'free'
  }).roll!
  assert.equal(sheet.freeCut, false)
  assert.equal(sheet.requiredArea, normal.requiredArea)
  const { maxWidthMm, rollCutMode, ...old } = body
  assert.equal(layoutBodySchema.parse(old).maxWidthMm, null)
  assert.equal(layoutBodySchema.parse(old).rollCutMode, 'width')
})
test('使用材料PDFは出荷方法・最大寸法・使用寸法と数量を出力し、文字をエスケープする', () => {
  const b = { ...body, rollCutMode: 'free' as const, materialName: '<script>品番</script>' }
  const input = {
    body: b,
    diagram:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX7sAAAAASUVORK5CYII=',
    expectedRevision: 1
  }
  const report = {
    input,
    result: computeLayout(polygon, 0.001, b),
    projectName: '案件<&>',
    roomName: '部屋',
    drawingName: '図面',
    pageNumber: 2,
    company: '会社',
    draft: true
  } as any
  const html = layoutPrintHtml(report)
  assert.ok(html.includes('フリーカット'))
  assert.ok(html.includes('24.4'))
  assert.ok(html.includes('最大出荷 W 3,640 mm'))
  assert.ok(html.includes('L 20,000 mm'))
  assert.ok(html.includes('360 mm'))
  assert.ok(html.includes('図面 · 2ページ'))
  assert.ok(html.includes('未保存'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
  assert.throws(
    () =>
      layoutPrintHtml({ ...report, input: { ...input, diagram: 'data:image/png;base64,AA==' } }),
    /画像/
  )
})
