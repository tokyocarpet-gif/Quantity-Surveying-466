import { useState } from 'react'
import type { WallPanel } from '../../../shared/wall-panels'

type Field = 'bottomMm' | 'coverageHeightMm'
type History = Record<Field, number[]>
const key = 'sekisan.wall-range-history.v1'
const valid = (field: Field, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value <= 100000 &&
  (field === 'bottomMm' ? value >= 0 : value > 0)
const normalize = (field: Field, values: unknown[]): number[] =>
  [...new Set(values.filter((v): v is number => valid(field, v)))].slice(0, 20)
function read(): History {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    return {
      bottomMm: normalize('bottomMm', Array.isArray(saved?.bottomMm) ? saved.bottomMm : []),
      coverageHeightMm: normalize(
        'coverageHeightMm',
        Array.isArray(saved?.coverageHeightMm) ? saved.coverageHeightMm : []
      )
    }
  } catch {
    return { bottomMm: [], coverageHeightMm: [] }
  }
}
export function useWallRangeHistory(panels: WallPanel[]) {
  const [history, setHistory] = useState(read)
  return {
    values: {
      bottomMm: normalize('bottomMm', [...history.bottomMm, ...panels.map((p) => p.bottomMm)]),
      coverageHeightMm: normalize('coverageHeightMm', [
        ...history.coverageHeightMm,
        ...panels.map((p) => p.coverageHeightMm)
      ])
    },
    remember(field: Field, text: string) {
      if (!text.trim() || !valid(field, Number(text))) return
      // Store completed input only, never partially typed digits on each keystroke.
      const next = { ...history, [field]: normalize(field, [Number(text), ...history[field]]) }
      setHistory(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* History is optional. */
      }
    }
  }
}
