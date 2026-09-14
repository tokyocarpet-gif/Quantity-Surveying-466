import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { partLabel, materialSpecification, type Material } from '../../shared/materials'
import './material-input.css'

// Free typing changes only the name. Choosing a specific master entry adopts its details.
export function MaterialInput({
  value,
  label,
  materials,
  onChange,
  onSelect,
  disabled = false,
  autoFocus = false
}: {
  value: string
  label: string
  materials: Material[]
  onChange: (name: string) => void
  onSelect: (material: Material) => void
  disabled?: boolean
  autoFocus?: boolean
}): React.JSX.Element {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1)
  const normalize = (s: string): string => s.normalize('NFKC').toLocaleLowerCase()
  const options = materials.filter((m) =>
    normalize(`${partLabel(m.category)} ${m.name} ${materialSpecification(m)} ${m.unit}`).includes(
      normalize(query)
    )
  )
  useLayoutEffect(() => {
    const el = popup.current,
      anchor = input.current
    if (!el || !anchor) return
    if (!open || disabled) {
      if (el.matches(':popover-open')) el.hidePopover()
      return
    }
    const position = (): void => {
      const rect = anchor.getBoundingClientRect(),
        width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom - 12,
        above = rect.top - 12
      const down = below >= 180 || below >= above,
        height = Math.min(280, down ? below : above)
      Object.assign(el.style, {
        left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(60, height)}px`,
        top: down ? `${rect.bottom + 4}px` : 'auto',
        bottom: down ? 'auto' : `${window.innerHeight - rect.top + 4}px`
      })
    }
    position()
    el.showPopover()
    const reposition = (event: Event): void => {
      if (!el.contains(event.target as Node)) position()
    }
    // Layout results can resize while typing; keep the choices attached to the field.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    if (anchor.parentElement) observer.observe(anchor.parentElement)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      if (el.matches(':popover-open')) el.hidePopover()
    }
  }, [open, disabled, value])
  useLayoutEffect(() => {
    if (open && active >= 0)
      popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])
  function select(material: Material): void {
    onSelect(material)
    setOpen(false)
    setActive(-1)
  }
  return (
    <div className="material-input">
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open && !disabled}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={
          open && active >= 0 && options[active] ? `${id}-${options[active].id}` : undefined
        }
        value={value}
        maxLength={120}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder="仕上げ材を入力・選択"
        onFocus={() => {
          setQuery('')
          setActive(-1)
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value)
          setQuery(e.target.value)
          setActive(-1)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) {
              setQuery('')
              setOpen(true)
              setActive(-1)
            } else
              setActive((n) =>
                options.length
                  ? (n + (e.key === 'ArrowDown' ? 1 : n < 0 ? 0 : -1) + options.length) %
                    options.length
                  : -1
              )
          }
          if (e.key === 'Enter' && open && active >= 0 && options[active]) {
            e.preventDefault()
            select(options[active])
          }
        }}
      />
      <button
        type="button"
        className="material-input-toggle"
        aria-label={`${label}のマスタを開く`}
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          input.current?.focus()
          setQuery('')
          setActive(-1)
          setOpen(!open)
        }}
      >
        <ChevronDown size={15} />
      </button>
      <div
        ref={popup}
        id={id}
        popover="manual"
        role="listbox"
        aria-label={`${label}のマスタ候補`}
        className="material-options"
      >
        {options.map((m, index) => (
          <button
            type="button"
            role="option"
            aria-selected={active === index}
            id={`${id}-${m.id}`}
            key={m.id}
            tabIndex={-1}
            data-material-id={m.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => select(m)}
            onMouseMove={() => setActive(index)}
          >
            <strong>{m.name}</strong>
            <small>
              {[
                partLabel(m.category),
                materialSpecification(m),
                m.unitPrice === null
                  ? `単価未設定 · ${m.unit}`
                  : `${m.unitPrice.toLocaleString('ja-JP')}円/${m.unit}`
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          </button>
        ))}
        {!options.length && (
          <p>
            {materials.length
              ? '一致する材料はありません。そのまま自由入力できます。'
              : '物件マスタは未登録です。自由入力できます。'}
          </p>
        )}
      </div>
    </div>
  )
}
