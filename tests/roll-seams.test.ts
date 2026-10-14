import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustRollSeam,
  computeLayout,
  defaultLayout,
  layoutBodySchema,
  type LayoutBody
} from '../src/shared/layout'
const rectangle = (w = 4000, h = 12000) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h }
]
const body: LayoutBody = {
  ...defaultLayout(),
  layoutType: 'sheet' as const,
  mode: 'wall' as const,
  widthMm: 2000,
  heightMm: 9000,
  trimMm: 50
}
const compute = (b = body, p = rectangle()) => computeLayout(p, 0.001, b)
test('最大Lから切りしろを差し引いて仮継ぎし、分割ごとの枚数・使用量・巻割りを計算', () => {
  const r = compute(),
    roll = r.roll!
  assert.deepEqual(
    roll.seams.map((s) => s.positionMm),
    [8900, 8900]
  )
  assert.deepEqual(
    roll.strips.map((s) => s.cutLengthMm),
    [9000, 3200, 9000, 3200]
  )
  assert.equal(roll.strips.length, 4)
  assert.equal(roll.lengthM, 24.4)
  assert.equal(roll.requiredArea, 48.8)
  assert.equal(roll.overLength, false)
  assert.equal(
    r.tiles.reduce((s, t) => s + t.areaMm2, 0),
    48000000
  )
  assert.equal(roll.rollCount, 4)
  assert.equal(roll.efficientCount, 3)
})
test('帯ごとに継ぎを調整・保存しても隣の帯は動かず、上限超過は警告対象', () => {
  const roll = compute().roll!
  const changed = { ...body, ...adjustRollSeam(roll, roll.seams[0].column, 0, 8000) }
  const r = compute(layoutBodySchema.parse(changed)).roll!
  assert.deepEqual(
    r.seams.map((s) => s.positionMm),
    [8000, 8900]
  )
  assert.deepEqual(
    r.strips.map((s) => s.cutLengthMm),
    [8100, 4100, 9000, 3200]
  )
  const over = compute({ ...body, ...adjustRollSeam(roll, roll.seams[0].column, 0, 9500) }).roll!
  assert.ok(over.overLength)
  assert.equal(over.strips[0].cutLengthMm, 9600)
  for (const n of [0, 12000, NaN, Infinity, -1])
    assert.throws(() => adjustRollSeam(roll, roll.seams[0].column, 0, n), /継ぎ位置/)
  const shifted = compute({ ...changed, offsetX: 100 }).roll!
  assert.equal(shifted.staleSeams, true)
  assert.ok(shifted.seams.every((s) => s.positionMm === 8900))
})
test('複数の継ぎを交差させず、未設定・上限ぴったり・切りしろ過大・分割過密を扱う', () => {
  const r = compute(body, rectangle(2000, 27000)).roll!
  assert.deepEqual(
    r.seams.map((s) => s.positionMm),
    [8900, 17800, 26700]
  )
  assert.throws(() => adjustRollSeam(r, r.seams[0].column, 0, 17800))
  assert.equal(compute({ ...body, heightMm: null }).roll!.seams.length, 0)
  assert.equal(compute(body, rectangle(2000, 8900)).roll!.seams.length, 0)
  assert.throws(() => compute({ ...body, heightMm: 100 }), /切りしろ/)
  assert.throws(() => compute({ ...body, heightMm: 101 }), /2,000/)
  assert.equal(compute({ ...body, heightMm: 9000.5 }).roll!.overLength, false)
  const { autoRollSeams, rollSeamSource, rollSeams, ...legacy } = body
  assert.equal(layoutBodySchema.parse(legacy).autoRollSeams, false)
  assert.equal(compute(layoutBodySchema.parse(legacy)).roll!.strips.length, 2)
})
test('回転・凹形状・フリーカットでも分割面積を保持し、数量は各片の寸法から計算', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 12000 },
    { x: 2500, y: 12000 },
    { x: 2500, y: 4000 },
    { x: 1500, y: 4000 },
    { x: 1500, y: 12000 },
    { x: 0, y: 12000 }
  ]
  for (const angle of [0, 31, 90, -45]) {
    const r = compute(
      { ...body, angle, layoutType: 'carpet', rollCutMode: 'free', heightMm: 4500 },
      polygon
    )
    const roll = r.roll!
    assert.ok(Math.abs(r.tiles.reduce((s, t) => s + t.areaMm2, 0) / 1e6 - r.roomArea) < 1e-6)
    assert.ok(roll.strips.every((s) => s.cutLengthMm <= 4500 && Number.isFinite(s.widthMm)))
    assert.equal(
      roll.requiredArea,
      roll.strips.reduce((s, p) => s + p.cutWidthMm * p.cutLengthMm, 0) / 1e6
    )
  }
})
