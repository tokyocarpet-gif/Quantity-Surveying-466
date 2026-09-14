import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dimensionLabel, dimensionValue, dimensionNumber } from '../src/shared/roll-dimensions'
import { materialStandard } from '../src/shared/materials'

test('長尺シートのW・Lはm小数1位、Tはmmを保ち、カーペットはmm整数で表示する', () => {
  assert.equal(dimensionLabel(1820, 'sheet', 'W'), '1.8 m')
  assert.equal(dimensionLabel(6000, 'sheet'), '6.0 m')
  assert.equal(dimensionLabel(2.5, 'sheet', 'T'), '2.5 mm')
  assert.equal(dimensionLabel(2359.9, 'carpet', 'W'), '2,360 mm')
  assert.equal(dimensionLabel(5999.9, 'carpet'), '6,000 mm')
  assert.equal(dimensionNumber(1820, 'sheet', 'W', false), '1.8')
  assert.equal(dimensionValue(1820, 'sheet', 'W'), 1.82)
  const m = { tileWidthMm: 1820, tileHeightMm: 20000, tileThicknessMm: 2.5 }
  assert.equal(materialStandard({ ...m, layoutType: 'sheet' }), 'W 1.8 m × L 20.0 m × T 2.5 mm')
  assert.equal(
    materialStandard({ ...m, layoutType: 'carpet' }),
    'W 1,820 mm × L 20,000 mm × T 3 mm'
  )
  assert.equal(
    materialStandard({ ...m, layoutType: 'sheet', tileHeightMm: null }),
    'W 1.8 m × T 2.5 mm'
  )
  assert.deepEqual(m, { tileWidthMm: 1820, tileHeightMm: 20000, tileThicknessMm: 2.5 })
})
