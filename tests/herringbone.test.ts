import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayout,
  defaultLayout,
  layoutBodySchema,
  type LayoutBody
} from '../src/shared/layout'
import type { Point } from '../src/shared/takeoff'
const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h }
]
const body = (extra: Partial<LayoutBody> = {}): LayoutBody => ({
  ...defaultLayout(),
  widthMm: 150,
  heightMm: 600,
  tilePattern: 'herringbone',
  ...extra
})
const close = (a: number, b: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const rotate = (p: Point, r: number): Point => ({
  x: p.x * Math.cos(r) - p.y * Math.sin(r),
  y: p.x * Math.sin(r) + p.y * Math.cos(r)
})
function disjoint(a: Point[], b: Point[]): boolean {
  // Separating-axis test independent of the generator's clipping/lattice math.
  for (const polygon of [a, b])
    for (let i = 0; i < 2; i++) {
      const p = polygon[i],
        q = polygon[i + 1],
        axis = { x: -(q.y - p.y), y: q.x - p.x }
      const dot = (v: Point) => v.x * axis.x + v.y * axis.y
      const av = a.map(dot),
        bv = b.map(dot)
      if (
        Math.min(Math.max(...av), Math.max(...bv)) - Math.max(Math.min(...av), Math.min(...bv)) <
        1e-5
      )
        return true
    }
  return false
}
test('ヘリンボーンは任意の長方形比率で重複なく敷き詰め、90度の2方向と実寸を維持する', () => {
  for (const [w, l] of [
    [100, 300],
    [150, 350],
    [157, 923],
    [301, 300]
  ]) {
    const result = computeLayout(rect(2000, 1600), 0.001, body({ widthMm: w, heightMm: l }))
    close(result.laidArea, 3.2)
    assert.ok(result.full > 0)
    assert.ok(result.cut > 0)
    const directions = new Set<number>()
    for (const t of result.tiles) {
      const [a, b, c] = t.polygon
      const ab = Math.hypot(b.x - a.x, b.y - a.y),
        bc = Math.hypot(c.x - b.x, c.y - b.y)
      close(Math.min(ab, bc), Math.min(w, l))
      close(Math.max(ab, bc), Math.max(w, l))
      close((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y), 0)
      const long = ab > bc ? { x: b.x - a.x, y: b.y - a.y } : { x: c.x - b.x, y: c.y - b.y }
      directions.add(Math.round((Math.atan2(long.y, long.x) * 180) / Math.PI))
      assert.ok(t.areaMm2 > 0 && t.areaMm2 <= w * l + 1e-6)
    }
    assert.deepEqual(
      [...directions].sort((a, b) => a - b),
      [45, 135]
    )
    for (let i = 0; i < result.tiles.length; i++)
      for (let j = i + 1; j < result.tiles.length; j++)
        assert.ok(disjoint(result.tiles[i].polygon, result.tiles[j].polygon), `overlap ${i}/${j}`)
    const swapped = computeLayout(rect(2000, 1600), 0.001, body({ widthMm: l, heightMm: w }))
    assert.deepEqual(swapped, result, '幅と長さの入力順で必要枚数を変えない')
  }
})
test('目地を含む繰返し面積に対し、実材料面積が一致して隙間も重複も増やさない', () => {
  for (const gapMm of [0, 2, 7.5]) {
    const w = 150,
      l = 350,
      roomW = Math.SQRT2 * (l + gapMm) * 3,
      roomH = Math.SQRT2 * (w + gapMm) * 4
    const result = computeLayout(
      rect(roomW, roomH),
      0.001,
      body({ widthMm: w, heightMm: l, gapMm, offsetX: 37, offsetY: -29 })
    )
    close(result.laidArea, (result.roomArea * w * l) / ((w + gapMm) * (l + gapMm)))
    for (let i = 0; i < result.tiles.length; i++)
      for (let j = i + 1; j < result.tiles.length; j++)
        assert.ok(disjoint(result.tiles[i].polygon, result.tiles[j].polygon))
  }
})
test('1枚と一致する斜めの部屋は真物1枚になり、境界に触れるだけの隣の材料を数えない', () => {
  const polygon = [
    { x: 0, y: -100 },
    { x: 300, y: -100 },
    { x: 300, y: 0 },
    { x: 0, y: 0 }
  ]
    .map((p) => rotate(p, Math.PI / 4))
    .map((p) => ({ x: p.x + 1000, y: p.y + 1000 }))
  const center = {
    x: polygon.reduce((s, p) => s + p.x, 0) / 4,
    y: polygon.reduce((s, p) => s + p.y, 0) / 4
  }
  const result = computeLayout(
    polygon,
    0.001,
    body({ widthMm: 100, heightMm: 300, offsetX: 1000 - center.x, offsetY: 1000 - center.y })
  )
  assert.equal(result.full, 1)
  assert.equal(result.cut, 0)
  close(result.laidArea, 0.03)
})
test('凹形状・逆回り・任意回転・壁基準・移動・専用範囲で面積を保持する', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 1500, y: 0 },
    { x: 1500, y: 500 },
    { x: 500, y: 500 },
    { x: 500, y: 1500 },
    { x: 0, y: 1500 }
  ]
  for (const p of [polygon, [...polygon].reverse()])
    for (const mode of ['wall', 'center'] as const)
      for (const angle of [0, 90, -23, 180]) {
        const b = body({ mode, angle, offsetX: 75, offsetY: -38 })
        const result = computeLayout(p, 0.001, b)
        close(result.laidArea, 1.25)
        const far = computeLayout(
          p.map((v) => ({ x: v.x + 9e6, y: v.y + 9e6 })),
          0.001,
          b
        )
        assert.equal(far.full, result.full)
        assert.equal(far.cut, result.cut)
        close(far.laidArea, 1.25)
        const custom = computeLayout(rect(2000, 2000), 0.001, { ...b, customPolygon: p })
        assert.deepEqual(custom, result)
      }
})
test('正方形・未設定寸法・過密な配置を拒否し、ロール材には適用しない', () => {
  assert.throws(
    () => computeLayout(rect(2000, 2000), 0.001, body({ widthMm: 500, heightMm: 500 })),
    /長方形/
  )
  assert.equal(layoutBodySchema.safeParse(body({ heightMm: null })).success, false)
  assert.throws(
    () => computeLayout(rect(10000, 10000), 0.001, body({ widthMm: 10, heightMm: 20 })),
    /2万枚/
  )
  const b = body({ layoutType: 'sheet', widthMm: 1000, heightMm: 10000 })
  assert.deepEqual(
    computeLayout(rect(2000, 2000), 0.001, b),
    computeLayout(rect(2000, 2000), 0.001, { ...b, tilePattern: 'straight' })
  )
})
