import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLayout, defaultLayout, hexagonHeight, layoutBodySchema } from '../src/shared/layout'
const room = [
  { x: 0, y: 0 },
  { x: 2000, y: 0 },
  { x: 2000, y: 1600 },
  { x: 0, y: 1600 }
]
const body = { ...defaultLayout(), tilePattern: 'hexagon' as const, widthMm: 300 }
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
test('正六角形の実寸・隙間なしの面積・回転・凹形状・逆回りを確認', () => {
  for (const polygon of [
    room,
    [...room].reverse(),
    [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 500 },
      { x: 800, y: 500 },
      { x: 800, y: 1600 },
      { x: 0, y: 1600 }
    ]
  ])
    for (const angle of [0, 30, 87, -45]) {
      const r = computeLayout(polygon, 0.001, { ...body, angle, offsetX: 37, offsetY: -28 })
      close(r.laidArea, r.roomArea)
      assert.ok(r.full > 0 && r.cut > 0)
      assert.equal(r.tiles.length, r.full + r.cut)
      for (const tile of r.tiles) {
        assert.equal(tile.polygon.length, 6)
        for (let i = 0; i < 6; i++) {
          const a = tile.polygon[i],
            b = tile.polygon[(i + 1) % 6]
          close(Math.hypot(b.x - a.x, b.y - a.y), 300 / Math.sqrt(3))
        }
      }
    }
})
test('正六角形は重複せず、目地が各隣接辺で指定幅になる', () => {
  for (const gapMm of [0, 3, 15]) {
    const r = computeLayout(room, 0.001, { ...body, gapMm })
    if (gapMm > 0) assert.ok(r.laidArea < r.roomArea)
    for (let i = 0; i < r.tiles.length; i++)
      for (let j = i + 1; j < r.tiles.length; j++) {
        const a = r.tiles[i].polygon,
          b = r.tiles[j].polygon
        let separation = -Infinity
        for (let k = 0; k < 6; k++) {
          const dx = a[(k + 1) % 6].x - a[k].x,
            dy = a[(k + 1) % 6].y - a[k].y
          const length = Math.hypot(dx, dy)
          const project = (p: { x: number; y: number }) => (-dy * p.x + dx * p.y) / length
          const av = a.map(project),
            bv = b.map(project)
          separation = Math.max(
            separation,
            Math.min(...av) - Math.max(...bv),
            Math.min(...bv) - Math.max(...av)
          )
        }
        assert.ok(separation >= gapMm - 1e-6)
      }
  }
})
test('高さは対辺寸法から導出し、過大な枚数を拒否する', () => {
  const parsed = layoutBodySchema.parse({ ...body, heightMm: null })
  close(parsed.heightMm!, hexagonHeight(300))
  assert.deepEqual(layoutBodySchema.parse(parsed), parsed)
  assert.throws(() => computeLayout(room, 1, { ...body, widthMm: 10 }), /2万枚/)
})
