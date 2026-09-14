import { useState } from 'react'
import { flushSync } from 'react-dom'
import {
  dimensionNumber,
  dimensionUnit,
  dimensionValue,
  type DimensionAxis,
  type RollDimensionType
} from '../../shared/roll-dimensions'

/** Display rounded units without changing the stored dimensions on focus or save. */
export function DimensionInput({
  value,
  onChange,
  type,
  axis,
  label,
  name,
  min,
  max
}: {
  value: number | '' | null
  onChange: (mm: number | '') => void
  type: RollDimensionType
  axis: DimensionAxis
  label: string
  name?: string
  min: number
  max: number
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const present = value !== '' && value !== null
  const unit = dimensionUnit(type, axis)
  return (
    <>
      {name && <input type="hidden" name={name} value={present ? value : ''} />}
      <input
        type="number"
        aria-label={label}
        step="any"
        placeholder="任意"
        min={Math.min(0, dimensionValue(min, type, axis))}
        max={dimensionValue(max, type, axis)}
        value={editing ? text : present ? dimensionNumber(value, type, axis, false) : ''}
        title="クリックすると登録値の桁数で編集できます"
        onFocus={(e) => {
          // Replace the rounded display before the browser selects text for typing.
          flushSync(() => {
            setText(present ? String(dimensionValue(value, type, axis)) : '')
            setEditing(true)
          })
          e.currentTarget.select()
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value === '' ? '' : Number(e.target.value) * (unit === 'm' ? 1000 : 1))
        }}
      />
    </>
  )
}
