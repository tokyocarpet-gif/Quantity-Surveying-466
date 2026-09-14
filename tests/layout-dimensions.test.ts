import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutWallDimensions } from '../src/shared/layout-dimensions'
import { computeLayout, defaultLayout, rotate } from '../src/shared/layout'
const rect = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1500 },
  { x: 0, y: 1500 }
]
const lengths = (result: ReturnType<typeof layoutWallDimensions>) =>
  result.dimensions.map((d) => Math.round(d.distanceMm * 1e6) / 1e6)
test('中心点から四方向の壁までを実寸mmで測り、移動に追従する', () => {
  assert.deepEqual(
    lengths(layoutWallDimensions(rect, { x: 500, y: 750 }, 0, 0.001)),
    [500, 500, 750, 750]
  )
  assert.deepEqual(
    lengths(layoutWallDimensions(rect, { x: 600, y: 700 }, 0, 0.001)),
    [600, 400, 700, 800]
  )
  assert.deepEqual(
    lengths(layoutWallDimensions(rect, { x: 500, y: 750 }, 0, 0.01)),
    [5000, 5000, 7500, 7500]
  )
  const actual = layoutWallDimensions(rect, { x: 500, y: 750 }, 0, 0.001)
  assert.deepEqual(
    actual.dimensions.map((d) => d.wallIndex),
    [3, 1, 0, 2]
  )
})
test('図面と割付を回転しても同じ寸法となり、斜め壁との実交点を測る', () => {
  for (const angle of [Math.PI / 6, Math.PI / 2, -Math.PI / 3]) {
    const moved = (p: { x: number; y: number }) => {
      const r = rotate(p, angle)
      return { x: r.x + 1e5, y: r.y - 2e5 }
    }
    assert.deepEqual(
      lengths(layoutWallDimensions(rect.map(moved), moved({ x: 500, y: 750 }), angle, 0.001)),
      [500, 500, 750, 750]
    )
  }
  const trapezoid = [
    { x: 0, y: 0 },
    { x: 2000, y: 0 },
    { x: 1500, y: 1000 },
    { x: 0, y: 1000 }
  ]
  assert.deepEqual(
    lengths(layoutWallDimensions(trapezoid, { x: 500, y: 500 }, 0, 0.001)),
    [500, 1250, 500, 500]
  )
})
test('凹形状は最初に当たる壁で止まり、部屋外の基準点を寸法表示しない', () => {
  const polygon = [
    [0, 0],
    [1200, 0],
    [1200, 1500],
    [800, 1500],
    [800, 400],
    [400, 400],
    [400, 1500],
    [0, 1500]
  ].map(([x, y]) => ({ x, y }))
  for (const p of [polygon, [...polygon].reverse()]) {
    assert.deepEqual(
      lengths(layoutWallDimensions(p, { x: 200, y: 1000 }, 0, 0.001)),
      [200, 200, 1000, 500]
    )
    assert.deepEqual(layoutWallDimensions(p, { x: 600, y: 1000 }, 0, 0.001), {
      inside: false,
      dimensions: []
    })
  }
})
test('壁上・頂点の起点では内向きの壁まで測り、外向きは0とする', () => {
  assert.deepEqual(
    layoutWallDimensions(rect, { x: 0, y: 0 }, 0, 0.001).dimensions.map((d) => d.wallIndex),
    [3, 1, 0, 2]
  )
  for (const p of [rect, [...rect].reverse()]) {
    assert.deepEqual(lengths(layoutWallDimensions(p, { x: 0, y: 0 }, 0, 0.001)), [0, 1000, 0, 1500])
    assert.deepEqual(
      lengths(layoutWallDimensions(p, { x: 0, y: 750 }, 0, 0.001)),
      [0, 1000, 750, 750]
    )
  }
})
test('芯割り・芯跨ぎ・壁寄せで実際の割付基準点を使用し、移動・回転に追従する', () => {
  for (const raw of [
    defaultLayout(),
    { ...defaultLayout(), axisX: 'tile' as const, axisY: 'tile' as const },
    { ...defaultLayout(), mode: 'wall' as const, wallIndex: 1, offsetX: 100, offsetY: 200 }
  ]) {
    const layout = computeLayout(rect, 0.001, raw)
    const result = layoutWallDimensions(rect, layout.anchor, layout.angle, 0.001)
    assert.deepEqual(
      lengths(result),
      raw.mode === 'wall' ? [100, 1400, 200, 800] : [500, 500, 750, 750]
    )
    for (const d of result.dimensions)
      assert.ok(
        Math.abs(Math.hypot(d.end.x - layout.anchor.x, d.end.y - layout.anchor.y) - d.distanceMm) <
          1e-6
      )
  }
  assert.throws(() => layoutWallDimensions(rect, { x: 0, y: 0 }, 0, 0))
})
