import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayout,
  defaultLayout,
  layoutBodySchema,
  type LayoutBody
} from '../src/shared/layout'
const rect = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h }
]
const body = (extra: Partial<LayoutBody> = {}): LayoutBody => ({
  ...defaultLayout(),
  mode: 'wall',
  widthMm: 500,
  heightMm: 250,
  ...extra
})
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('馬貼り・1/3・1/4は段ごとにずれ、端部の切り物を枚数へ加える', () => {
  for (const [tilePattern, w, h, rw, rh, full, cut] of [
    ['half', 500, 250, 1000, 1000, 6, 4],
    ['third', 300, 300, 900, 900, 7, 4],
    ['quarter', 400, 100, 800, 400, 5, 6]
  ] as const) {
    const b = body({ tilePattern, widthMm: w, heightMm: h })
    const result = computeLayout(rect(rw, rh), 0.001, b)
    assert.equal(result.full, full)
    assert.equal(result.cut, cut)
    close(result.laidArea, (rw * rh) / 1e6)
    const transposed = computeLayout(rect(rh, rw), 0.001, {
      ...b,
      widthMm: h,
      heightMm: w,
      staggerAxis: 'length'
    })
    assert.equal(transposed.full, full)
    assert.equal(transposed.cut, cut)
    close(transposed.laidArea, result.laidArea)
  }
})

test('負の段番号を含む中心基準でも繰り返しが連続し、目地幅を含むピッチでずれる', () => {
  const result = computeLayout(
    rect(2000, 1600),
    0.001,
    body({ mode: 'center', tilePattern: 'third', widthMm: 300, heightMm: 200, gapMm: 6 })
  )
  const starts = new Map<number, number>()
  for (const tile of result.tiles) {
    const p = tile.polygon[0]
    const row = Math.round((p.y - 803) / 206)
    const mod = (((p.x - 1003) % 306) + 306) % 306
    close(mod, (((row % 3) + 3) % 3) * 102)
    starts.set(row, mod)
  }
  assert.ok(starts.has(-1))
  assert.ok(starts.has(0))
  assert.ok(starts.has(1))
  // All interior tiles are disjoint, even where their joints meet.
  for (let i = 0; i < result.tiles.length; i++)
    for (let j = i + 1; j < result.tiles.length; j++) {
      const a = result.tiles[i].polygon,
        b = result.tiles[j].polygon
      const w = Math.min(a[2].x, b[2].x) - Math.max(a[0].x, b[0].x)
      const h = Math.min(a[2].y, b[2].y) - Math.max(a[0].y, b[0].y)
      assert.ok(w <= 1e-8 || h <= 1e-8)
    }
  assert.ok(result.laidArea < result.roomArea)
})

test('ずらし貼りの凹形状・回転・微調整・逆回りでも面積の欠落や重複がない', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 1500, y: 0 },
    { x: 1500, y: 500 },
    { x: 500, y: 500 },
    { x: 500, y: 1500 },
    { x: 0, y: 1500 }
  ]
  for (const tilePattern of ['half', 'third', 'quarter'] as const)
    for (const staggerAxis of ['width', 'length'] as const)
      for (const p of [polygon, [...polygon].reverse()]) {
        const b = body({ tilePattern, staggerAxis, angle: 23, offsetX: -117, offsetY: 81 })
        const result = computeLayout(p, 0.001, b)
        close(result.laidArea, 1.25)
        const translated = computeLayout(
          p.map((v) => ({ x: v.x + 9e6, y: v.y + 9e6 })),
          0.001,
          b
        )
        close(translated.laidArea, 1.25)
        assert.equal(translated.full, result.full)
        assert.equal(translated.cut, result.cut)
      }
})

test('従来の配置は通し貼りとなり、ロール材の数量には貼り方を適用しない', () => {
  const { tilePattern, staggerAxis, ...legacy } = body()
  const parsed = layoutBodySchema.parse(legacy)
  assert.equal(parsed.tilePattern, 'straight')
  assert.equal(parsed.staggerAxis, 'width')
  assert.deepEqual(
    computeLayout(rect(1000, 1000), 0.001, parsed),
    computeLayout(rect(1000, 1000), 0.001, body())
  )
  for (const layoutType of ['sheet', 'carpet'] as const) {
    const b = body({ layoutType, heightMm: 5000 })
    assert.deepEqual(
      computeLayout(rect(1000, 1000), 0.001, b),
      computeLayout(rect(1000, 1000), 0.001, { ...b, tilePattern: 'third', staggerAxis: 'length' })
    )
  }
  assert.throws(() => layoutBodySchema.parse({ ...body(), tilePattern: 'unknown' }))
  assert.throws(
    () =>
      computeLayout(
        rect(10000, 10000),
        0.001,
        body({ widthMm: 10, heightMm: 10, tilePattern: 'half' })
      ),
    /2万枚/
  )
})
