import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

const storageKey = 'sekisan.wall-workspace.v1'
const defaults = { sidebar: 330, planRatio: 0.36 }
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (Number.isFinite(saved?.sidebar) && Number.isFinite(saved?.planRatio))
      return { sidebar: clamp(saved.sidebar, 260, 640), planRatio: clamp(saved.planRatio, 0, 1) }
  } catch {
    /* Layout preferences are optional. */
  }
  return defaults
}

export function useWallWorkspace() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1000, height: 700 })
  const [preferences, setPreferences] = useState(readPreferences)
  useLayoutEffect(() => {
    const element = ref.current!
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences))
    } catch {
      /* Optional. */
    }
  }, [preferences])
  // Keep both panes reachable even after moving to a smaller display.
  const sidebarMax = Math.max(260, Math.min(640, size.width - 488))
  const height = Math.max(1, size.height - 8)
  const planMin = Math.min(150, height / 2)
  const planMax = Math.max(planMin, height - 220)
  const sidebar = clamp(preferences.sidebar, 260, sidebarMax)
  const plan = clamp(height * preferences.planRatio, planMin, planMax)
  return {
    ref,
    style: {
      '--wall-sidebar-width': `${sidebar}px`,
      '--wall-plan-height': `${plan}px`
    } as CSSProperties,
    sidebar: {
      orientation: 'vertical' as const,
      value: sidebar,
      min: 260,
      max: sidebarMax,
      onChange: (value: number) =>
        setPreferences((p) => ({ ...p, sidebar: clamp(value, 260, sidebarMax) })),
      onReset: () => setPreferences((p) => ({ ...p, sidebar: defaults.sidebar }))
    },
    plan: {
      orientation: 'horizontal' as const,
      value: plan,
      min: planMin,
      max: planMax,
      onChange: (value: number) =>
        setPreferences((p) => ({ ...p, planRatio: clamp(value, planMin, planMax) / height })),
      onReset: () => setPreferences((p) => ({ ...p, planRatio: defaults.planRatio }))
    }
  }
}

export function WallSplitter({
  orientation,
  value,
  min,
  max,
  onChange,
  onReset,
  label,
  controls
}: {
  orientation: 'vertical' | 'horizontal'
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onReset: () => void
  label: string
  controls: string
}) {
  const drag = useRef<{ pointer: number; position: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const vertical = orientation === 'vertical'
  useEffect(() => {
    if (!dragging) return
    const { cursor, userSelect } = document.body.style
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    const stop = () => {
      drag.current = null
      setDragging(false)
    }
    window.addEventListener('blur', stop)
    return () => {
      document.body.style.cursor = cursor
      document.body.style.userSelect = userSelect
      window.removeEventListener('blur', stop)
    }
  }, [dragging, vertical])
  const stop = () => {
    drag.current = null
    setDragging(false)
  }
  return (
    <div
      className="wall-splitter"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-controls={controls}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)}ピクセル`}
      title={`${label}（ドラッグで調整・ダブルクリックで元に戻す）`}
      data-dragging={dragging}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0 || !e.isPrimary) return
        e.preventDefault()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { pointer: e.pointerId, position: vertical ? e.clientX : e.clientY, value }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (!start || start.pointer !== e.pointerId) return
        onChange(start.value + (vertical ? e.clientX : e.clientY) - start.position)
      }}
      onPointerUp={(e) => {
        if (drag.current?.pointer !== e.pointerId) return
        stop()
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        const less = vertical ? 'ArrowLeft' : 'ArrowUp'
        const more = vertical ? 'ArrowRight' : 'ArrowDown'
        if (![less, more, 'Home', 'End', 'Enter'].includes(e.key)) return
        e.preventDefault()
        if (e.key === 'Enter') onReset()
        else
          onChange(
            e.key === 'Home'
              ? min
              : e.key === 'End'
                ? max
                : value + (e.key === less ? -1 : 1) * (e.shiftKey ? 50 : 10)
          )
      }}
    />
  )
}
