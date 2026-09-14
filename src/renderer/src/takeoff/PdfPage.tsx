import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Point } from '../../../shared/takeoff'
import { zoomOffset, clampZoom } from '../../../shared/view-navigation'
export interface PdfView {
  width: number
  height: number
  scale: number
}
export function PdfPage({
  pdf,
  pageNumber,
  zoom,
  onZoom,
  resetView,
  overlay,
  crosshair,
  pan,
  fitHeight = false
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
  onZoom: (zoom: number) => void
  resetView: number
  overlay: (view: PdfView) => ReactNode
  crosshair: Point | null
  pan: boolean
  fitHeight?: boolean
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [base, setBase] = useState<{ width: number; height: number } | null>(null)
  const [offset, setOffset] = useState({ x: 24, y: 24 })
  const [rendered, setRendered] = useState(''),
    [error, setError] = useState('')
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const previous = useRef<{
    scale: number
    reset: number
    width: number
    height: number
    fitHeight: boolean
  } | null>(null)
  const zoomRef = useRef(zoom)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{
    x: number
    y: number
    left: number
    top: number
    moved: boolean
    button: number
    pointerId: number
    panning: boolean
  } | null>(null)
  const scale = base
    ? Math.max(
        0.05,
        Math.min(
          (size.width - 48) / base.width,
          fitHeight ? (size.height - 48) / base.height : 2,
          2
        )
      ) * zoom
    : 1
  const view = base ? { ...base, scale } : null
  const key = `${pageNumber}:${scale}`
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setSize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height })
    )
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    void pdf
      .getPage(pageNumber)
      .then((p) => {
        if (!cancelled) {
          const v = p.getViewport({ scale: 1 })
          setBase({ width: v.width, height: v.height })
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber])
  useLayoutEffect(() => {
    zoomRef.current = zoom
    if (!base) return
    if (
      !previous.current ||
      previous.current.reset !== resetView ||
      previous.current.fitHeight !== fitHeight ||
      (fitHeight && previous.current.height !== size.height && zoom === 1 && !anchor.current) ||
      (previous.current.width !== size.width && zoom === 1 && !anchor.current)
    )
      setOffset({ x: (size.width - base.width * scale) / 2, y: 24 })
    else if (previous.current.scale !== scale) {
      const point = anchor.current ?? { x: size.width / 2, y: size.height / 2 }
      const ratio = scale / previous.current.scale
      setOffset((old) => zoomOffset(old, point, ratio))
    }
    previous.current = {
      scale,
      reset: resetView,
      width: size.width,
      height: size.height,
      fitHeight
    }
    anchor.current = null
  }, [scale, zoom, resetView, base, size.width, size.height, fitHeight])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      anchor.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1)
      const next = clampZoom(zoomRef.current * Math.exp(-delta * 0.0015))
      zoomRef.current = next
      onZoom(next)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [onZoom, size.height])
  useEffect(() => {
    if (!base) return
    let cancelled = false
    let task: RenderTask | undefined
    setError('')
    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(24000000 / (viewport.width * viewport.height))
        )
        // Render offscreen so wheel zoom can keep displaying the previous bitmap without flicker.
        const buffer = document.createElement('canvas')
        buffer.width = Math.max(1, Math.floor(viewport.width * ratio))
        buffer.height = Math.max(1, Math.floor(viewport.height * ratio))
        task = page.render({ canvas: buffer, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
        await task.promise
        if (cancelled || !canvas.current) return
        canvas.current.width = buffer.width
        canvas.current.height = buffer.height
        canvas.current.getContext('2d')!.drawImage(buffer, 0, 0)
        setRendered(key)
      })
      .catch((e) => {
        if (!cancelled && e.name !== 'RenderingCancelledException') setError(e.message)
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, base, scale, key])
  // Keep tracking at window level: panning must not depend on SVG pointer capture.
  useEffect(() => {
    const stop = (): void => {
      const pointerId = drag.current?.pointerId
      drag.current = null
      setDragging(false)
      if (pointerId !== undefined && host.current?.hasPointerCapture(pointerId))
        host.current.releasePointerCapture(pointerId)
    }
    const move = (event: PointerEvent): void => {
      const d = drag.current
      if (!d || event.pointerId !== d.pointerId) return
      if (!(event.buttons & (d.button === 2 ? 2 : 1))) {
        stop()
        return
      }
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) > 4) d.moved = true
      if (d.panning) {
        setOffset({ x: d.left + event.clientX - d.x, y: d.top + event.clientY - d.y })
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const end = (event: PointerEvent): void => {
      if (event.pointerId === drag.current?.pointerId) stop()
    }
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', stop)
    }
  }, [])
  return (
    <div
      ref={host}
      className={`pdf-scroll takeoff-scroll ${pan ? 'panning' : ''} ${dragging ? 'dragging' : ''}`}
      aria-busy={rendered !== key && !error}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={(e) => {
        if (e.button !== 0 && e.button !== 2) return
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          left: offset.x,
          top: offset.y,
          moved: false,
          button: e.button,
          pointerId: e.pointerId,
          panning: e.button === 2 || pan
        }
        if (e.button === 2 || pan) {
          // Keep receiving movement and release even outside the drawing viewport.
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          e.stopPropagation()
          e.preventDefault()
        }
      }}
      onPointerUpCapture={(e) => {
        if (drag.current?.moved || drag.current?.panning || e.button === 2) {
          e.stopPropagation()
          e.preventDefault()
        }
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onLostPointerCapture={(e) => {
        if (e.target !== e.currentTarget || !drag.current?.panning) return
        drag.current = null
        setDragging(false)
      }}
    >
      {!rendered && !error && <div className="pdf-status">図面を読み込んでいます…</div>}
      {error && (
        <div className="pdf-error" role="alert">
          {error}
        </div>
      )}
      <div
        className="drawing-surface"
        style={{
          width: view ? view.width * view.scale : undefined,
          height: view ? view.height * view.scale : undefined,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          visibility: !rendered || error ? 'hidden' : 'visible'
        }}
      >
        <canvas ref={canvas} aria-label={`図面 ${pageNumber}ページ`} />
        {view && overlay(view)}
      </div>
      {crosshair && view && !dragging && rendered && !error && (
        <div className="takeoff-crosshair" aria-hidden="true" data-testid="takeoff-crosshair">
          <div
            className="crosshair-horizontal"
            style={{ top: offset.y + crosshair.y * view.scale }}
          />
          <div
            className="crosshair-vertical"
            style={{ left: offset.x + crosshair.x * view.scale }}
          />
        </div>
      )}
    </div>
  )
}
