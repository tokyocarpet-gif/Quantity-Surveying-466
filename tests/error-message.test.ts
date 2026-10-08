import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wallpaperSchema } from '../src/shared/wall-layout'
import { errorMessage } from '../src/renderer/src/error-message'

test('入力エラーは内部 JSON ではなく警告文を表示する', () => {
  const result = wallpaperSchema.safeParse({
    widthMm: 0,
    repeatMm: 0,
    horizontalRepeatMm: 0,
    match: 'none',
    stepMm: 0,
    rollLengthMm: null
  })
  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(
    errorMessage(result.error, '入力を確認してください。'),
    'クロスの有効幅を入力してください。'
  )
  assert.equal(
    errorMessage(new Error('保存できませんでした。'), '入力を確認してください。'),
    '保存できませんでした。'
  )
  assert.equal(errorMessage(null, '入力を確認してください。'), '入力を確認してください。')
})
