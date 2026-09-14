export interface RollCutPlan {
  rolls: { number: number; usedMm: number; remainingMm: number; sheets: number[] }[]
  assignments: { rollNumber: number; cutOrder: number }[]
}
/** Compare two feasible cut orders; never split a sheet or exceed the stock length. */
export function planRollCuts(lengths: number[], stockMm: number | null) {
  if (lengths.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error('切出し長さ・巻き長さを確認してください。')
  if (stockMm === null) return null
  if (!Number.isFinite(stockMm) || stockMm <= 0) throw new Error('巻き長さを確認してください。')
  if (lengths.some((n) => n > stockMm! + 1e-7)) return null
  function pack(reorder: boolean): RollCutPlan {
    const indices = lengths.map((_, i) => i)
    if (reorder) indices.sort((a, b) => lengths[b] - lengths[a] || a - b)
    const rolls: RollCutPlan['rolls'] = []
    for (const index of indices) {
      const length = lengths[index]
      let roll = reorder ? rolls.find((r) => r.remainingMm + 1e-7 >= length) : rolls.at(-1)
      if (!roll || roll.remainingMm + 1e-7 < length) {
        roll = { number: rolls.length + 1, usedMm: 0, remainingMm: stockMm!, sheets: [] }
        rolls.push(roll)
      }
      roll.sheets.push(index + 1)
      roll.usedMm += length
      roll.remainingMm = Math.max(0, stockMm! - roll.usedMm)
    }
    const assignments: RollCutPlan['assignments'] = []
    let order = 0
    for (const roll of rolls)
      for (const sheet of roll.sheets)
        assignments[sheet - 1] = { rollNumber: roll.number, cutOrder: ++order }
    return { rolls, assignments }
  }
  const regular = pack(false),
    candidate = pack(true)
  return { regular, efficient: candidate.rolls.length < regular.rolls.length ? candidate : regular }
}
