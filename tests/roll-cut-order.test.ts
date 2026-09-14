import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRollCuts } from '../src/shared/roll-cut-order'
import { computeLayout, defaultLayout, layoutBodySchema } from '../src/shared/layout'
test('6m・6m・4m・4mを10m巻から切り出す場合、巻残りを使って3本から2本にする', () => {
  const plans = planRollCuts([6000, 6000, 4000, 4000], 10000)!
  assert.equal(plans.regular.rolls.length, 3)
  assert.equal(plans.efficient.rolls.length, 2)
  assert.deepEqual(
    plans.efficient.rolls.map((r) => r.sheets),
    [
      [1, 3],
      [2, 4]
    ]
  )
  assert.deepEqual(
    plans.efficient.rolls.map((r) => r.remainingMm),
    [0, 0]
  )
  assert.deepEqual(
    plans.efficient.assignments.map((a) => a.cutOrder),
    [1, 3, 2, 4]
  )
})
test('同じ巻数なら番号順を維持し、巻長不明・長さ超過では割当を作らない', () => {
  const plans = planRollCuts([6100, 6100, 6100], 20000)!
  assert.deepEqual(plans.efficient, plans.regular)
  assert.equal(plans.regular.rolls[0].remainingMm, 1700)
  assert.equal(planRollCuts([10001], 10000), null)
  assert.equal(planRollCuts([100], null), null)
  assert.deepEqual(planRollCuts([], 10000)!.regular.rolls, [])
  assert.throws(() => planRollCuts([NaN], 10000))
  assert.throws(() => planRollCuts([100], 0))
})
test('部屋の段差による切出し長に適用し、配置・切出し長・数量は保持する', () => {
  const polygon = [
    [0, 0],
    [4000, 0],
    [4000, 4000],
    [2000, 4000],
    [2000, 6000],
    [0, 6000]
  ].map(([x, y]) => ({ x, y }))
  const body = {
    ...defaultLayout(),
    layoutType: 'sheet' as const,
    mode: 'wall' as const,
    widthMm: 1000,
    heightMm: 10000
  }
  const regular = computeLayout(polygon, 0.001, body)
  const efficient = computeLayout(polygon, 0.001, { ...body, reorderCuts: true })
  assert.equal(regular.roll!.rollCount, 3)
  assert.equal(efficient.roll!.rollCount, 2)
  assert.deepEqual(
    regular.roll!.strips.map((s) => s.cutLengthMm),
    [6000, 6000, 4000, 4000]
  )
  assert.deepEqual(regular.tiles, efficient.tiles)
  assert.equal(regular.roll!.lengthM, efficient.roll!.lengthM)
  assert.equal(regular.roll!.requiredArea, efficient.roll!.requiredArea)
  assert.deepEqual(
    regular.roll!.strips.map((s) => s.cutLengthMm),
    efficient.roll!.strips.map((s) => s.cutLengthMm)
  )
  const { reorderCuts, ...old } = body
  assert.equal(layoutBodySchema.parse(old).reorderCuts, false)
  for (const radians of [0, Math.PI / 4, -Math.PI / 3]) {
    const rotated = polygon.map(({ x, y }) => ({
      x: 10000 + x * Math.cos(radians) - y * Math.sin(radians),
      y: 10000 + x * Math.sin(radians) + y * Math.cos(radians)
    }))
    for (const reverse of [false, true]) {
      const result = computeLayout(reverse ? [...rotated].reverse() : rotated, 0.001, {
        ...body,
        wallIndex: reverse ? 4 : 0,
        reorderCuts: true
      })
      assert.deepEqual(
        result.roll!.strips.map((s) => s.cutLengthMm),
        [6000, 6000, 4000, 4000]
      )
      assert.equal(result.roll!.rollCount, 2)
    }
  }
})
test('多様な切出し長で重複・欠落・巻長超過を出さず、番号順より巻数を増やさない', () => {
  let state = 721
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
  for (let i = 0; i < 100; i++) {
    const lengths = Array.from({ length: 1 + (next() % 40) }, () => 1 + (next() % 10000))
    const plans = planRollCuts(lengths, 10000)!
    assert.ok(plans.efficient.rolls.length <= plans.regular.rolls.length)
    for (const plan of [plans.regular, plans.efficient]) {
      assert.deepEqual(
        plan.rolls.flatMap((r) => r.sheets).sort((a, b) => a - b),
        lengths.map((_, i) => i + 1)
      )
      assert.deepEqual(
        plan.assignments.map((a) => a.cutOrder).sort((a, b) => a - b),
        lengths.map((_, i) => i + 1)
      )
      for (const roll of plan.rolls) {
        assert.ok(roll.usedMm <= 10000)
        assert.equal(roll.usedMm + roll.remainingMm, 10000)
        assert.equal(
          roll.usedMm,
          roll.sheets.reduce((sum, index) => sum + lengths[index - 1], 0)
        )
        for (const sheet of roll.sheets)
          assert.equal(plan.assignments[sheet - 1].rollNumber, roll.number)
      }
    }
  }
})
