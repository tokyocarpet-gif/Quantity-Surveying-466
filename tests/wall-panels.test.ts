import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { computeWall, wallBodySchema, type WallBody } from '../src/shared/wall-layout'
import { defaultWallPanel, type PanelRect } from '../src/shared/wall-panels'
const base = (): WallBody => ({
  name: '壁',
  materialName: 'タイル',
  points: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 }
  ],
  roomId: null,
  edgeIndex: null,
  scale: 0.001,
  heightMm: 1000,
  material: {
    widthMm: 0,
    repeatMm: 0,
    horizontalRepeatMm: 0,
    match: 'none',
    stepMm: 0,
    rollLengthMm: null
  },
  topTrimMm: 50,
  bottomTrimMm: 50,
  offsetMm: 0,
  openings: [],
  kind: 'tile',
  panel: { ...defaultWallPanel(), widthMm: 500, heightMm: 500 }
})
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const overlap = (a: PanelRect, b: PanelRect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
test('壁タイルは全形・カットと元材枚数、目地を除いた材料面積を計算する', () => {
  const b = base(),
    p = computeWall(b).panel!
  assert.equal(p.full, 4)
  assert.equal(p.cut, 0)
  assert.equal(p.count, 4)
  near(p.laidArea, 1)
  near(p.offcutArea, 0)
  const g = computeWall({ ...b, panel: { ...b.panel!, gapMm: 5 } }).panel!
  assert.equal(g.full, 1)
  assert.equal(g.cut, 3)
  near(g.netArea, 1)
  near(g.laidArea, 0.990025)
  near(g.offcutArea, 0.009975)
  assert.deepEqual(
    g.pieces.map((p) => [p.cutWidthMm, p.cutHeightMm]),
    [
      [500, 500],
      [495, 500],
      [500, 495],
      [495, 495]
    ]
  )
})
test('通し・馬・1/3・1/4、中心基準・移動・90度回転で施工範囲に隙間や重複を作らない', () => {
  const b = base()
  b.points[1].x = 1357
  b.heightMm = 973
  b.panel = { ...b.panel!, widthMm: 300, heightMm: 200 }
  for (const pattern of ['straight', 'half', 'third', 'quarter'] as const)
    for (const alignment of ['edge', 'joint', 'tile'] as const)
      for (const rotate of [false, true]) {
        const p = computeWall({
          ...b,
          panel: { ...b.panel, pattern, alignment, rotate, offsetX: -777, offsetY: 143 }
        }).panel!
        near(p.laidArea, 1.320361)
        near(p.sourceArea - p.laidArea, p.offcutArea)
        const parts = p.pieces.flatMap((p) => p.parts)
        for (let i = 0; i < parts.length; i++)
          for (let j = 0; j < i; j++) near(overlap(parts[i], parts[j]), 0)
      }
  const ordinary = computeWall(base()).panel!,
    half = computeWall({ ...base(), panel: { ...base().panel!, pattern: 'half' } }).panel!
  assert.equal(ordinary.count, 4)
  assert.equal(half.count, 5)
  assert.equal(half.full, 3)
  assert.equal(half.cut, 2)
})
test('開口だけの元材を除外し、切欠き・穴・分割の残る板は1枚として数える', () => {
  const b = base(),
    hole = { id: randomUUID(), name: '窓', xMm: 0, bottomMm: 0, widthMm: 500, heightMm: 500 }
  const full = computeWall({ ...b, openings: [hole] }).panel!
  assert.equal(full.count, 3)
  assert.equal(full.full, 3)
  near(full.laidArea, 0.75)
  const inside = computeWall({
    ...b,
    openings: [{ ...hole, xMm: 100, bottomMm: 100, widthMm: 200, heightMm: 200 }]
  }).panel!
  assert.equal(inside.count, 4)
  assert.equal(inside.cut, 1)
  assert.equal(inside.pieces[0].notched, true)
  assert.equal(inside.pieces[0].parts.length, 4)
  near(inside.laidArea, 0.96)
  near(inside.offcutArea, 0.04)
  const split = computeWall({ ...b, openings: [{ ...hole, xMm: 200, widthMm: 100 }] }).panel!
  assert.equal(split.count, 4)
  assert.equal(split.pieces[0].parts.length, 2)
  near(split.pieces[0].areaMm2, 200000)
  const empty = computeWall({ ...b, openings: [{ ...hole, widthMm: 1000, heightMm: 1000 }] }).panel!
  assert.equal(empty.count, 0)
  near(empty.netArea, 0)
})
test('養生の床からの高さ・範囲と部分開口、材料の縦横で必要枚数が変わる', () => {
  const b = base()
  b.kind = 'protection'
  b.points[1].x = 4000
  b.heightMm = 2400
  b.panel = { ...b.panel!, widthMm: 910, heightMm: 1820, coverageHeightMm: 900 }
  const r = computeWall(b).panel!
  assert.equal(r.count, 5)
  assert.equal(r.full, 0)
  near(r.netArea, 3.6)
  const rotated = computeWall({ ...b, panel: { ...b.panel, rotate: true } }).panel!
  assert.equal(rotated.count, 3)
  const lifted = computeWall({
    ...b,
    panel: { ...b.panel, bottomMm: 600 },
    openings: [
      { id: randomUUID(), name: '窓', xMm: 500, bottomMm: 1200, widthMm: 1000, heightMm: 1000 }
    ]
  }).panel!
  near(lifted.netArea, 3.3)
  near(lifted.laidArea, 3.3)
  assert.ok(lifted.pieces.flatMap((p) => p.parts).every((r) => r.y >= 600 && r.y + r.h <= 1500))
})
test('旧クロスの読込を維持し、未設定・範囲外・過密配置を拒否する', () => {
  const b = base()
  assert.throws(() => computeWall({ ...b, panel: undefined }), /W・L/)
  assert.throws(() => computeWall({ ...b, panel: { ...b.panel!, heightMm: null } }), /W・L/)
  assert.throws(
    () => computeWall({ ...b, panel: { ...b.panel!, coverageHeightMm: 1001 } }),
    /高さ内/
  )
  assert.throws(
    () => computeWall({ ...b, panel: { ...b.panel!, widthMm: 1, heightMm: 1 } }),
    /2万枚/
  )
  assert.throws(
    () => computeWall({ ...b, kind: 'protection', panel: { ...b.panel!, gapMm: 3 } }),
    /目地なし/
  )
  const { kind, panel, ...old } = b
  old.material.widthMm = 920
  assert.equal(wallBodySchema.parse(old).kind, undefined)
  assert.equal(computeWall(old).panel, null)
  assert.equal(computeWall(old).drops.length, 2)
})

test('板材・タイルの右始まりは右に全形を置き、左に端部を残す。横移動は右が正', () => {
  const b = base()
  b.panel = { ...b.panel!, widthMm: 300, heightMm: 400 }
  const left = computeWall(b).panel!,
    right = computeWall({ ...b, startSide: 'right' }).panel!
  assert.deepEqual(
    right.pieces.slice(0, 4).map((p) => [p.parts[0].x, p.cutWidthMm]),
    [
      [700, 300],
      [400, 300],
      [100, 300],
      [0, 100]
    ]
  )
  assert.equal(right.count, left.count)
  assert.equal(right.full, left.full)
  near(right.laidArea, left.laidArea)
  const moved = computeWall({ ...b, startSide: 'right', panel: { ...b.panel, offsetX: 50 } }).panel!
  near(moved.pieces[0].rect.x - right.pieces[0].rect.x, 50)
  assert.deepEqual(computeWall({ ...b, startSide: 'left' }), computeWall(b))
})
test('右始まりの中心基準・ずらし・目地・養生範囲は開口を固定して計算する', () => {
  const b = base()
  b.points[1].x = 1357
  b.heightMm = 1800
  b.openings = [
    { id: randomUUID(), name: '窓', xMm: 131, bottomMm: 457, widthMm: 511, heightMm: 689 }
  ]
  const snapshot = JSON.stringify(b),
    W = 1357
  for (const kind of ['tile', 'protection'] as const)
    for (const pattern of (kind === 'tile'
      ? ['straight', 'half', 'third', 'quarter']
      : ['straight']) as ('straight' | 'half' | 'third' | 'quarter')[])
      for (const alignment of ['edge', 'joint', 'tile'] as const)
        for (const rotate of [false, true]) {
          const panel = {
            ...b.panel!,
            widthMm: 300,
            heightMm: 200,
            pattern,
            alignment,
            rotate,
            gapMm: kind === 'tile' ? 3 : 0,
            offsetX: 73,
            offsetY: -113,
            bottomMm: 200,
            coverageHeightMm: 1400
          }
          const right = computeWall({ ...b, kind, startSide: 'right', panel }).panel!
          const logical = computeWall({
            ...b,
            kind,
            panel: { ...panel, offsetX: -panel.offsetX },
            openings: b.openings.map((o) => ({ ...o, xMm: W - o.xMm - o.widthMm }))
          }).panel!
          near(right.laidArea, logical.laidArea)
          assert.equal(right.count, logical.count)
          const hole = { x: 131, y: 457, w: 511, h: 689 }
          right.pieces.forEach((p, i) => {
            near(p.rect.x, W - logical.pieces[i].rect.x - logical.pieces[i].rect.w)
            for (const part of p.parts) {
              near(overlap(part, hole), 0)
              assert.ok(part.x >= -1e-7 && part.x + part.w <= W + 1e-7)
              assert.ok(part.y >= 200 && part.y + part.h <= 1600 + 1e-7)
            }
          })
        }
  assert.equal(JSON.stringify(b), snapshot)
})
