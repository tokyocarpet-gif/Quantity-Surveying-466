import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zoomOffset, axisAssistPoint, clampZoom } from '../src/shared/view-navigation'
test('カーソル中心の拡大・縮小は同じ論理座標を保持する', () => {
  const offset = { x: -234, y: 57 },
    anchor = { x: 350, y: 240 }
  const scale = 1.5
  for (const ratio of [0.2, 0.8, 1.25, 4]) {
    const next = zoomOffset(offset, anchor, ratio)
    assert.ok(
      Math.abs((anchor.x - next.x) / (scale * ratio) - (anchor.x - offset.x) / scale) < 1e-10
    )
    assert.ok(
      Math.abs((anchor.y - next.y) / (scale * ratio) - (anchor.y - offset.y) / scale) < 1e-10
    )
  }
  assert.equal(clampZoom(0.01), 0.2)
  assert.equal(clampZoom(20), 8)
})
test('軸に近い点だけ補助し、離れた斜めの点はそのまま使う', () => {
  assert.deepEqual(axisAssistPoint({ x: 205, y: 8 }, { x: 5, y: 5 }, 1), { x: 205, y: 5 })
  assert.deepEqual(axisAssistPoint({ x: 8, y: 205 }, { x: 5, y: 5 }, 1), { x: 5, y: 205 })
  assert.deepEqual(axisAssistPoint({ x: 105, y: 65 }, { x: 5, y: 5 }, 1), { x: 105, y: 65 })
  assert.deepEqual(axisAssistPoint({ x: 7, y: 7 }, { x: 5, y: 5 }, 1), { x: 7, y: 7 })
  assert.deepEqual(axisAssistPoint({ x: 205, y: 14 }, { x: 5, y: 5 }, 1), { x: 205, y: 14 })
  // The same screen distance has the same behavior at different display scales.
  assert.deepEqual(axisAssistPoint({ x: 105, y: 6 }, { x: 5, y: 5 }, 4), { x: 105, y: 5 })
  assert.deepEqual(axisAssistPoint({ x: 105, y: 8 }, { x: 5, y: 5 }, 4), { x: 105, y: 8 })
})
