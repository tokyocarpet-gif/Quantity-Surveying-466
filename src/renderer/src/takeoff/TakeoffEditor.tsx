import { CountForm } from './CountForm'
import { countInputSchema, type CountInput, type CountGroup } from '../../../shared/takeoff'
import { useEffect, useState, type PointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Ruler,
  SquareDashed,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import { MaterialManager } from '../MaterialManager'
import type { MaterialContext } from '../../../shared/materials'
import { axisAssistPoint } from '../../../shared/view-navigation'
import type { Drawing } from '../../../shared/api'
import {
  categories,
  categoryLabels,
  categoryUnits,
  distance,
  geometry,
  netQuantity,
  roomInputOf,
  type SleeveWall,
  type DeductionInput,
  type PageState,
  type Point,
  type Room,
  type TakeoffChange,
  type TakeoffMutation,
  type TakeoffPreview
} from '../../../shared/takeoff'
import { unwrap } from '../store'
import { PdfPage, type PdfView } from './PdfPage'
import { PreviewDialog, quantityText, scaleText, TakeoffDialog } from './Dialogs'
import { SleeveWallDialog } from './SleeveWallDialog'
import { RoomForm } from './RoomForm'

type Tool = 'select' | 'pan' | 'scale' | 'room' | 'sleeve' | 'count' | 'count-remove'
export function TakeoffEditor({
  drawing,
  initialSelectedId = null,
  pdf,
  pageNumber,
  onPage,
  back,
  backLabel = '図面一覧に戻る'
}: {
  drawing: Drawing
  initialSelectedId?: string | null
  pdf: PDFDocumentProxy
  pageNumber: number
  onPage: (page: number) => void
  backLabel?: string
  back: () => void
}): React.JSX.Element {
  const [state, setState] = useState<PageState | null>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const [mode, setMode] = useState<Tool>('select'),
    [rectangle, setRectangle] = useState(false),
    [snap, setSnap] = useState(true)
  const [panReturn, setPanReturn] = useState<Tool | null>(null)
  const [points, setPoints] = useState<Point[]>([]),
    [cursor, setCursor] = useState<Point | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [editor, setEditor] = useState<{ id: string; room: Room | null; polygon: Point[] } | null>(
    null
  )
  const [countEditor, setCountEditor] = useState<{ id: string; input: CountInput } | null>(null)
  const [countDelete, setCountDelete] = useState<string | null>(null)
  const countInputOf = (c: CountGroup): CountInput => ({
    roomId: c.roomId,
    name: c.name,
    category: c.category,
    specification: c.specification,
    unit: c.unit,
    unitPrice: c.unitPrice,
    color: c.color,
    points: c.points
  })
  const [zoom, setZoom] = useState(1)
  const [resetView, setResetView] = useState(0)
  const [masters, setMasters] = useState<MaterialContext>({
    global: [],
    project: [],
    roomNames: [],
    heightHistory: []
  })
  const [mastersLoaded, setMastersLoaded] = useState(false)
  const [sleeve, setSleeve] = useState<{ roomId: string; wall: SleeveWall } | null>(null)
  const [masterOpen, setMasterOpen] = useState(false)
  const [duplicate, setDuplicate] = useState<Extract<TakeoffChange, { kind: 'room' }> | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const refreshMasters = (): void => {
    void unwrap(window.sekisan.readMaterials(drawing.projectId))
      .then((data) => {
        setMasters(data)
        setMastersLoaded(true)
      })
      .catch((e) =>
        setError(`仕上げ材マスタを読み込めませんでした。仕上げ材は手入力できます。${e.message}`)
      )
      .finally(() => setMastersLoaded(true))
  }
  useEffect(() => {
    refreshMasters()
  }, [drawing.projectId])
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true)
  const [scaleDialog, setScaleDialog] = useState<[Point, Point] | null>(null)
  const [opening, setOpening] = useState<{ id: string; input: DeductionInput } | null>(null)
  const [fixed, setFixed] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ input: TakeoffMutation; data: TakeoffPreview } | null>(
    null
  )
  const [navigation, setNavigation] = useState<(() => void) | null>(null)
  const selected = state?.rooms.find((r) => r.id === selectedId) ?? null
  const selectedItems = categories
    .map((c) =>
      state?.items.find(
        (i) => i.roomId === selectedId && i.category === c && i.source === 'auto-room'
      )
    )
    .filter((i) => !!i)
  const canAddOpening = selectedItems.some(
    (i) => i.category === 'wall' || i.category === 'baseboard'
  )
  const deductions =
    state?.deductions.filter((d) => selectedItems.some((i) => i.id === d.targetItemId)) ?? []
  const selectedCount = state?.counts?.find((c) => c.id === selectedId)
  const savedCount = state?.counts?.find((c) => c.id === countEditor?.id)
  const changed =
    !!editor ||
    points.length > 0 ||
    (!!countEditor &&
      JSON.stringify(countEditor.input) !==
        JSON.stringify(savedCount ? countInputOf(savedCount) : null))
  useEffect(() => {
    let cancelled = false
    void unwrap(window.sekisan.readTakeoff({ drawingId: drawing.id, pageNumber }))
      .then((data) => {
        if (!cancelled) setState(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [drawing.id, pageNumber])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  const clearDrawing = (): void => {
    setPoints([])
    setCursor(null)
    setMode('select')
    setPanReturn(null)
  }
  const leave = (action: () => void): void => {
    if (busy) return
    const proceed = (): void => {
      setCountEditor(null)
      action()
    }
    if (changed) setNavigation(() => proceed)
    else proceed()
  }
  const selectRoom = (room: Room): void =>
    leave(() => {
      setSelectedId(room.id)
      setEditor(null)
      clearDrawing()
      setRightOpen(true)
    })
  const editCount = (c: CountGroup): void =>
    leave(() => {
      setSelectedId(c.id)
      setEditor(null)
      setCountEditor({ id: c.id, input: countInputOf(c) })
      clearDrawing()
      setRightOpen(true)
    })
  const startCount = (): void => {
    setSelectedId(null)
    setEditor(null)
    setCountEditor({
      id: crypto.randomUUID(),
      input: {
        roomId: selected?.id ?? null,
        name: '',
        category: '',
        specification: '',
        unit: '個',
        unitPrice: null,
        color: '#a06532',
        points: []
      }
    })
    setMode('count')
    setPoints([])
    setRightOpen(true)
  }
  const startRoom = (): void => {
    if (!state?.scaleRatio) return
    setError('')
    setMode('room')
    setPoints([])
    setCursor(null)
  }
  const finish = (input = points): void => {
    const polygon = input.filter((p, index) => index === 0 || distance(p, input[index - 1]) > 1e-6)
    if (polygon.length > 2 && distance(polygon[0], polygon.at(-1)!) < 1e-6) polygon.pop()
    try {
      geometry(polygon)
      setEditor((current) =>
        current ? { ...current, polygon } : { id: crypto.randomUUID(), room: null, polygon }
      )
      clearDrawing()
      setRightOpen(true)
      setError('')
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : '部屋を囲んでください。'} 袖壁の往復線は輪郭に含めず、外周で部屋を登録してから「袖壁」で追加してください。`
      )
    }
  }
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest('input,textarea,select,button,dialog') ||
          event.target.isContentEditable)
      )
        return
      if (busy || preview || opening || fixed || scaleDialog || sleeve) return
      if (event.key === 'Enter' && mode === 'room' && !rectangle) {
        event.preventDefault()
        finish()
      }
      if (event.key === 'Escape') {
        clearDrawing()
        setError('')
      }
      if (event.key === 'Backspace' && points.length) {
        event.preventDefault()
        setPoints((p) => p.slice(0, -1))
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        setSnap((s) => !s)
      }
    }
    window.addEventListener('keydown', down)
    return () => {
      window.removeEventListener('keydown', down)
    }
  })
  async function requestPreview(change: TakeoffChange): Promise<void> {
    if (!state || busy) return
    if (change.kind === 'room' && !change.mergeInto && !change.duplicateChoice) {
      const group = state.rooms.find((r) => r.id === change.id)?.groupId ?? change.id
      const matches = state.rooms.filter((r) => r.name === change.input.name && r.groupId !== group)
      if (matches.length) {
        setDuplicate(change)
        setMergeTarget(matches[0].id)
        return
      }
    }
    setBusy(true)
    setError('')
    const input: TakeoffMutation = {
      drawingId: drawing.id,
      pageNumber,
      expectedRevision: state.revision,
      change
    }
    try {
      const data = await unwrap(window.sekisan.previewTakeoff(input))
      setPreview({ input, data })
      setDuplicate(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '数量を計算できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  async function apply(): Promise<void> {
    if (!preview || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await unwrap(window.sekisan.applyTakeoff(preview.input))
      setState(next)
      const change = preview.input.change
      if (change.kind === 'room') {
        setSelectedId(change.id)
        if (state?.rooms.find((r) => r.id === change.id)?.heightMm !== change.input.heightMm)
          setMasters((m) => ({
            ...m,
            heightHistory: [
              change.input.heightMm,
              ...m.heightHistory.filter((h) => h !== change.input.heightMm)
            ].slice(0, 100)
          }))
        refreshMasters()
      }
      if (change.kind === 'deleteRoom') setSelectedId(null)
      if (change.kind === 'count') setSelectedId(change.id)
      if (change.kind === 'deleteCount') setSelectedId(null)
      setCountEditor(null)
      setCountDelete(null)
      setPreview(null)
      setEditor(null)
      setScaleDialog(null)
      setOpening(null)
      setSleeve(null)
      setFixed(null)
      clearDrawing()
      setNotice('数量を保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  function addOpening(): void {
    const item =
      selectedItems.find((i) => i.category === 'wall') ??
      selectedItems.find((i) => i.category === 'baseboard')
    if (!item) return
    setOpening({
      id: crypto.randomUUID(),
      input: { targetItemId: item.id, name: '開口', widthMm: 900, heightMm: 2000, count: 1 }
    })
    setError('')
  }
  function logicalPoint(event: PointerEvent<SVGSVGElement>, dimensions: PdfView): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    const point = {
      x: Math.max(
        0,
        Math.min(dimensions.width, ((event.clientX - rect.left) / rect.width) * dimensions.width)
      ),
      y: Math.max(
        0,
        Math.min(dimensions.height, ((event.clientY - rect.top) / rect.height) * dimensions.height)
      )
    }
    if (snap && mode !== 'count') {
      const candidates = [
        ...(state?.calibration?.points ?? []),
        ...(state?.rooms.flatMap((r) => r.polygon) ?? []),
        ...points
      ]
      const closest = candidates
        .filter((p) => distance(point, p) < 8 / dimensions.scale)
        .sort((a, b) => distance(point, a) - distance(point, b))[0]
      if (closest) return closest
    }
    return ((mode === 'room' && !rectangle) || mode === 'sleeve') && points.length > 0
      ? axisAssistPoint(point, points.at(-1)!, dimensions.scale)
      : point
  }
  function clickDrawing(event: PointerEvent<SVGSVGElement>, dimensions: PdfView): void {
    if (busy || event.button !== 0 || event.detail > 1) return
    if (mode !== 'scale' && mode !== 'room' && mode !== 'sleeve' && mode !== 'count') return
    event.currentTarget.focus({ preventScroll: true })
    const point = logicalPoint(event, dimensions)
    if (mode === 'count' && countEditor) {
      setCountEditor((current) =>
        current &&
        current.input.points.length < 10000 &&
        !current.input.points.some((p) => distance(p, point) < 0.01)
          ? { ...current, input: { ...current.input, points: [...current.input.points, point] } }
          : current
      )
      return
    }
    if (mode === 'sleeve' && selected) {
      if (points.length === 1) {
        if (distance(points[0], point) < 0.01) {
          setError('袖壁の2点は離れた位置を指定してください。')
          return
        }
        setSleeve({
          roomId: selected.id,
          wall: {
            id: crypto.randomUUID(),
            name: '袖壁',
            points: [points[0], point],
            faces: 2,
            heightMm: null,
            includeBaseboard: true
          }
        })
        clearDrawing()
        setError('')
      } else setPoints([point])
      return
    }
    if (mode === 'scale') {
      if (points.length === 1) {
        setScaleDialog([points[0], point])
        setError('')
        setPoints([])
        setMode('select')
      } else setPoints([point])
      return
    }
    if (rectangle && points.length === 1) {
      const a = points[0]
      finish([a, { x: point.x, y: a.y }, point, { x: a.x, y: point.y }])
      return
    }
    if (!rectangle && points.length >= 3 && distance(point, points[0]) < 8 / dimensions.scale) {
      finish()
      return
    }
    if (points.length < 500) setPoints((p) => [...p, point])
  }
  function overlay(dimensions: PdfView): React.JSX.Element {
    const shape = (polygon: Point[]): string => polygon.map((p) => `${p.x},${p.y}`).join(' ')
    let draft = points
    if (cursor && points.length)
      draft =
        rectangle && mode === 'room'
          ? [
              points[0],
              { x: cursor.x, y: points[0].y },
              cursor,
              { x: points[0].x, y: cursor.y },
              points[0]
            ]
          : [...points, cursor]
    return (
      <svg
        className={`takeoff-overlay ${mode === 'room' || mode === 'scale' || mode === 'sleeve' || mode === 'count' ? 'crosshair' : ''}`}
        data-testid="drawing-overlay"
        tabIndex={0}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        aria-label="図面の計測・部屋描画領域"
        onPointerUp={(e) => clickDrawing(e, dimensions)}
        onPointerLeave={() => setCursor(null)}
        onPointerMove={(e) => {
          if (mode === 'room' || mode === 'scale' || mode === 'sleeve' || mode === 'count')
            setCursor(logicalPoint(e, dimensions))
        }}
        onDoubleClick={(e) => {
          if (mode === 'room' && !rectangle) {
            e.preventDefault()
            finish()
          }
        }}
      >
        {state?.rooms.map((room) => (
          <g key={room.id}>
            <polygon
              points={shape(room.polygon)}
              fill={room.color}
              fillOpacity={room.id === selectedId ? 0.2 : 0.09}
              stroke={room.color}
              strokeWidth={room.id === selectedId ? 2.5 : 1.5}
              vectorEffect="non-scaling-stroke"
              data-room-id={room.id}
              onPointerUp={(e) => {
                if (mode === 'select' && e.button === 0) {
                  e.stopPropagation()
                  selectRoom(room)
                }
              }}
            />
            <text
              x={room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length}
              y={room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length}
              textAnchor="middle"
              fontSize={12 / dimensions.scale}
              className="room-map-label"
            >
              {room.name}
            </text>
          </g>
        ))}
        {state?.rooms.flatMap((room) =>
          room.sleeveWalls.map((wall) => (
            <g
              key={wall.id}
              data-testid="sleeve-wall-line"
              data-sleeve-id={wall.id}
              onPointerUp={(e) => {
                if (mode === 'select' && e.button === 0) {
                  e.stopPropagation()
                  selectRoom(room)
                }
              }}
            >
              <line
                x1={wall.points[0].x}
                y1={wall.points[0].y}
                x2={wall.points[1].x}
                y2={wall.points[1].y}
                stroke={room.color}
                strokeWidth="4"
                strokeDasharray="7 3"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={(wall.points[0].x + wall.points[1].x) / 2}
                y={(wall.points[0].y + wall.points[1].y) / 2 - 7 / dimensions.scale}
                fontSize={11 / dimensions.scale}
                textAnchor="middle"
                className="room-map-label"
              >
                {wall.name}（{wall.faces}面）
              </text>
            </g>
          ))
        )}
        {[
          ...(state?.counts ?? []).filter((c) => c.id !== countEditor?.id),
          ...(countEditor
            ? [{ ...countEditor.input, id: countEditor.id, drawingId: drawing.id, pageNumber }]
            : [])
        ].flatMap((group) =>
          group.points.map((point, index) => (
            <g
              key={`${group.id}-${index}`}
              data-testid="count-marker"
              data-count-id={group.id}
              data-point-index={index}
              style={{ cursor: mode === 'count-remove' ? 'pointer' : 'default' }}
              onPointerUp={(e) => {
                if (e.button !== 0) return
                if (mode === 'count-remove' && countEditor?.id === group.id) {
                  e.stopPropagation()
                  setCountEditor((c) =>
                    c
                      ? {
                          ...c,
                          input: {
                            ...c.input,
                            points: c.input.points.filter((_, i) => i !== index)
                          }
                        }
                      : c
                  )
                } else if (mode === 'select') {
                  e.stopPropagation()
                  const saved = state?.counts?.find((c) => c.id === group.id)
                  if (saved) editCount(saved)
                }
              }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={10 / dimensions.scale}
                fill={group.color}
                stroke="white"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={point.x}
                y={point.y}
                dy=".35em"
                textAnchor="middle"
                fontSize={10 / dimensions.scale}
                fill="white"
                pointerEvents="none"
              >
                {index + 1}
              </text>
              <title>
                {group.name} · {index + 1}
              </title>
            </g>
          ))
        )}
        {editor && (
          <polygon
            points={shape(editor.polygon)}
            fill="#207964"
            fillOpacity=".05"
            stroke="#176556"
            strokeWidth="2"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {!!points.length && (
          <>
            <polyline
              points={shape(draft)}
              fill={mode === 'room' ? '#438c7020' : 'none'}
              stroke={mode === 'scale' ? '#b5812e' : '#176556'}
              strokeWidth="2"
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            {points.map((point, i) => (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r={4 / dimensions.scale}
                fill="white"
                stroke="#176556"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
          </>
        )}
      </svg>
    )
  }
  if (!state)
    return (
      <section className="viewer">
        <div className="empty">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button className="secondary" onClick={back}>
                {backLabel}
              </button>
            </>
          ) : (
            <p>数量データを読み込んでいます…</p>
          )}
        </div>
      </section>
    )
  const selectedFixed = state.items.find((i) => i.id === fixed)
  return (
    <section className="viewer takeoff-viewer" aria-busy={busy}>
      <header className="viewer-header">
        <button
          className="icon-button"
          aria-label={backLabel}
          disabled={busy}
          onClick={() => leave(back)}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="viewer-title">
          <h1>{drawing.name}</h1>
          <span>数量拾い出し</span>
        </div>
        <button className="secondary" onClick={() => setMasterOpen(true)} disabled={busy}>
          仕上げ材マスタ
        </button>
        <span className={`scale-badge ${state.scaleRatio ? 'set' : ''}`}>
          {state.scaleRatio ? `縮尺 ${scaleText(state.scaleRatio)}（PDF原寸）` : '縮尺未設定'}
        </span>
        <span className="muted">{notice || (busy ? '処理中…' : '保存済み')}</span>
      </header>
      <div className="takeoff-toolbar">
        <div className="tool-group">
          {(
            [
              { tool: 'select', label: '選択', Icon: MousePointer2 },
              { tool: 'pan', label: 'パン', Icon: Hand },
              { tool: 'scale', label: '縮尺', Icon: Ruler },
              { tool: 'room', label: '部屋', Icon: SquareDashed },
              { tool: 'sleeve', label: '袖壁', Icon: Pencil },
              { tool: 'count', label: '個数', Icon: Plus }
            ] as const
          ).map(({ tool, label, Icon }) => (
            <button
              key={tool}
              className={`tool-button ${mode === tool ? 'active' : ''}`}
              aria-pressed={mode === tool}
              title={
                tool === 'room' && !state.scaleRatio
                  ? '先に縮尺で既知の長さを設定してください'
                  : tool === 'pan'
                    ? '左ドラッグで図面を移動（右ドラッグはどのツールでも利用可能）'
                    : label
              }
              disabled={
                busy ||
                (tool === 'room' && (!state.scaleRatio || !mastersLoaded)) ||
                (tool === 'sleeve' && (!selected || !canAddOpening))
              }
              onClick={() => {
                if (tool === 'pan') {
                  if (mode === 'pan') {
                    setMode(panReturn ?? 'select')
                    setPanReturn(null)
                  } else {
                    setPanReturn(mode)
                    setMode('pan')
                    setCursor(null)
                  }
                  return
                }
                if (
                  mode === 'pan' &&
                  (tool === panReturn || (tool === 'count' && panReturn === 'count-remove'))
                ) {
                  setMode(tool)
                  setPanReturn(null)
                  return
                }
                leave(() => {
                  setPanReturn(null)
                  if (tool === 'count') {
                    startCount()
                    return
                  }
                  setEditor(null)
                  setMode(tool)
                  setPoints([])
                  setCursor(null)
                })
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={rectangle}
              onChange={(e) => {
                setRectangle(e.target.checked)
                setPoints([])
              }}
              disabled={busy}
            />
            矩形
          </label>
          <label className="toolbar-check">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            スナップ
          </label>
        </div>
        <div className="tool-group">
          <button
            className="tool-button"
            disabled={busy || !canAddOpening || !!editor}
            onClick={addOpening}
          >
            <DoorOpen size={17} />
            開口控除
          </button>
          <button
            className="icon-button"
            aria-label="1点戻す"
            disabled={!points.length}
            onClick={() => setPoints((p) => p.slice(0, -1))}
          >
            <Undo2 size={17} />
          </button>
          {mode === 'room' && (
            <button
              className="tool-button"
              disabled={points.length < 3 || rectangle}
              onClick={() => finish()}
            >
              <Check size={16} />
              確定
            </button>
          )}
          {(mode === 'room' || mode === 'scale' || mode === 'sleeve' || mode === 'count') && (
            <button className="icon-button" aria-label="描画を中止" onClick={clearDrawing}>
              <X size={17} />
            </button>
          )}
        </div>
        <div className="page-controls">
          <button
            className="icon-button"
            aria-label="前のページ"
            disabled={pageNumber <= 1 || busy}
            onClick={() => leave(() => onPage(pageNumber - 1))}
          >
            <ChevronLeft size={17} />
          </button>
          <select
            aria-label="PDFのページを選択"
            value={pageNumber}
            disabled={busy}
            onChange={(e) => leave(() => onPage(Number(e.target.value)))}
          >
            {Array.from({ length: drawing.pageCount }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} / {drawing.pageCount} ページ
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="次のページ"
            disabled={pageNumber >= drawing.pageCount || busy}
            onClick={() => leave(() => onPage(pageNumber + 1))}
          >
            <ChevronRight size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="縮小"
            disabled={zoom <= 0.2}
            onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label="拡大"
            disabled={zoom >= 8}
            onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="幅に合わせる"
            onClick={() => {
              setZoom(1)
              setResetView((v) => v + 1)
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      {error && !preview && !scaleDialog && !opening && !fixed && (
        <div className="takeoff-error" role="alert">
          {error}
          <button className="icon-button" aria-label="エラーを閉じる" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <div className="takeoff-layout">
        <aside className={`takeoff-left ${leftOpen ? '' : 'collapsed'}`}>
          <header>
            <h2>
              部屋・個数{' '}
              <span>
                {new Set(state.rooms.map((r) => r.groupId)).size + (state.counts?.length ?? 0)}件
              </span>
            </h2>
            <button
              className="icon-button"
              aria-label={leftOpen ? '部屋一覧を折りたたむ' : '部屋一覧を開く'}
              onClick={() => setLeftOpen((v) => !v)}
            >
              {leftOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
            </button>
          </header>
          {leftOpen && (
            <>
              <button
                className="add-room"
                disabled={!state.scaleRatio || busy || !mastersLoaded}
                onClick={() =>
                  leave(() => {
                    setEditor(null)
                    startRoom()
                  })
                }
              >
                <Plus size={16} />
                部屋を追加
              </button>
              <button className="add-room" disabled={busy} onClick={() => leave(startCount)}>
                <Plus size={16} />
                個数を追加
              </button>
              <div className="takeoff-rooms">
                {state.rooms
                  .filter((r, i, all) => all.findIndex((n) => n.groupId === r.groupId) === i)
                  .map((room) => (
                    <button
                      className={`room-list-card ${room.groupId === selected?.groupId ? 'selected' : ''}`}
                      key={room.id}
                      data-testid="room-card"
                      disabled={busy}
                      onClick={() => selectRoom(room)}
                    >
                      <strong>
                        <span style={{ background: room.color }} />
                        {room.name}
                      </strong>
                      {state.rooms.filter((r) => r.groupId === room.groupId).length > 1 && (
                        <small>
                          統合 · {state.rooms.filter((r) => r.groupId === room.groupId).length}
                          範囲の合計
                        </small>
                      )}
                      <div>
                        {categories.map((c) => {
                          const items = state.items.filter(
                            (i) =>
                              state.rooms.some(
                                (r) => r.id === i.roomId && r.groupId === room.groupId
                              ) &&
                              i.source === 'auto-room' &&
                              i.category === c
                          )
                          if (!items.length) return null
                          const net = items.reduce(
                            (sum, item) => sum + netQuantity(item, state.deductions),
                            0
                          )
                          return (
                            <span key={c}>
                              <span>{categoryLabels[c]}</span>
                              <b className={net < 0 ? 'negative' : ''}>
                                {quantityText(net)} <small>{categoryUnits[c]}</small>
                              </b>
                            </span>
                          )
                        })}
                      </div>
                    </button>
                  ))}
                {(state.counts ?? []).map((c) => (
                  <button
                    className={`room-list-card ${selectedId === c.id ? 'selected' : ''}`}
                    key={c.id}
                    data-testid="count-card"
                    disabled={busy}
                    onClick={() => editCount(c)}
                  >
                    <strong>
                      <span style={{ background: c.color }} />
                      {c.name}
                    </strong>
                    <small>
                      {state.rooms.find((r) => r.id === c.roomId)?.name ?? '部屋未指定'} ·{' '}
                      {c.specification}
                    </small>
                    <div>
                      <span>
                        <span>個数</span>
                        <b>
                          {c.points.length} <small>{c.unit}</small>
                        </b>
                      </span>
                    </div>
                  </button>
                ))}
                {!state.rooms.length && !(state.counts ?? []).length && (
                  <p className="panel-empty">
                    {state.scaleRatio
                      ? '部屋の輪郭を囲んで数量を登録しましょう。'
                      : '最初に「縮尺」で既知の長さを指定してください。'}
                  </p>
                )}
              </div>
              <footer className="room-list-footer">このページの部屋・個数を表示</footer>
            </>
          )}
        </aside>
        <main className="takeoff-center">
          <div className="drawing-hint">
            {mode === 'pan'
              ? '左ドラッグで図面をつかんで移動。右ドラッグでも移動できます。'
              : mode === 'count'
                ? '対象を1点ずつクリックして数えます。右の「個数を確認」から保存します。'
                : mode === 'count-remove'
                  ? '取り消す番号の点をクリックしてください。'
                  : mode === 'sleeve'
                    ? '選択した部屋に加える袖壁の始点・終点をクリックします。外周と分けて拾うため、線が交差しても面積は変わりません。'
                    : mode === 'scale'
                      ? '既知の寸法の始点と終点をクリックしてください。'
                      : mode === 'room'
                        ? rectangle
                          ? '矩形の対角の2点をクリックしてください。'
                          : '頂点をクリック → 始点クリック・「確定」で完了。軸の近くは水平・垂直補助、離すと自由描画。右ドラッグで移動。'
                        : editor
                          ? '右の属性を編集し、数量を確認して保存します。'
                          : 'クリックで部屋・個数を選択・右ドラッグで移動・ホイールでカーソル中心に拡大縮小。'}
          </div>
          <PdfPage
            pdf={pdf}
            pageNumber={pageNumber}
            zoom={zoom}
            onZoom={setZoom}
            resetView={resetView}
            overlay={overlay}
            pan={mode === 'pan'}
            crosshair={
              mode === 'room' || mode === 'scale' || mode === 'sleeve' || mode === 'count'
                ? cursor
                : null
            }
          />
          <div className="drawing-status">
            <span>
              {new Set(state.rooms.map((r) => r.groupId)).size}部屋 · {state.rooms.length}範囲 ·{' '}
              {state.items.length + (state.counts?.length ?? 0)}項目
            </span>
            <span>{changed ? '未保存の編集あり' : `ページ ${pageNumber} の数量を保存済み`}</span>
          </div>
        </main>
        <aside className={`takeoff-right ${rightOpen ? '' : 'collapsed'}`}>
          <header>
            <button
              className="icon-button"
              aria-label={rightOpen ? '属性を折りたたむ' : '属性を開く'}
              onClick={() => setRightOpen((v) => !v)}
            >
              {rightOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
            <h2>属性・数量</h2>
          </header>
          {rightOpen && (
            <div className="properties-scroll">
              {countEditor ? (
                <CountForm
                  value={countEditor.input}
                  onChange={(input) => setCountEditor((c) => (c ? { ...c, input } : null))}
                  masters={masters}
                  rooms={state.rooms}
                  busy={busy}
                  adding={mode === 'count'}
                  removing={mode === 'count-remove'}
                  onAdd={() => setMode('count')}
                  onRemove={() => setMode('count-remove')}
                  undo={() =>
                    setCountEditor((c) =>
                      c
                        ? { ...c, input: { ...c.input, points: c.input.points.slice(0, -1) } }
                        : null
                    )
                  }
                  save={() => {
                    const parsed = countInputSchema.safeParse(countEditor.input)
                    if (parsed.success)
                      void requestPreview({ kind: 'count', id: countEditor.id, input: parsed.data })
                    else setError(parsed.error.issues[0].message)
                  }}
                  cancel={() =>
                    leave(() => {
                      setCountEditor(null)
                      clearDrawing()
                    })
                  }
                  remove={() => setCountDelete(countEditor.id)}
                  saved={!!savedCount}
                />
              ) : selectedCount ? (
                <div className="selected-room-title">
                  <h3>{selectedCount.name}</h3>
                  <p>{selectedCount.specification}</p>
                  <div className="count-total">
                    {selectedCount.points.length} <small>{selectedCount.unit}</small>
                  </div>
                  <button className="secondary wide" onClick={() => editCount(selectedCount)}>
                    個数拾いを編集
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => setCountDelete(selectedCount.id)}
                  >
                    この個数拾いを削除
                  </button>
                </div>
              ) : editor ? (
                <RoomForm
                  key={editor.id}
                  room={editor.room}
                  groupSize={
                    editor.room
                      ? state.rooms.filter((r) => r.groupId === editor.room!.groupId).length
                      : 1
                  }
                  materials={masters.project}
                  roomNames={masters.roomNames}
                  heightHistory={masters.heightHistory}
                  openMaterials={() => setMasterOpen(true)}
                  polygon={editor.polygon}
                  scale={state.scaleRatio}
                  busy={busy || mode === 'room'}
                  save={(input) => void requestPreview({ kind: 'room', id: editor.id, input })}
                  redraw={startRoom}
                  remove={() => void requestPreview({ kind: 'deleteRoom', id: editor.id })}
                  cancel={() => {
                    setEditor(null)
                    clearDrawing()
                  }}
                />
              ) : selected ? (
                <>
                  <div className="selected-room-title">
                    <h3>{selected.name}</h3>
                    {state.rooms.filter((r) => r.groupId === selected.groupId).length > 1 && (
                      <>
                        <p>左の一覧は統合合計です。ここでは範囲ごとの属性・数量を編集します。</p>
                        <select
                          aria-label="統合した部屋の範囲"
                          value={selected.id}
                          onChange={(e) =>
                            selectRoom(state.rooms.find((r) => r.id === e.target.value)!)
                          }
                        >
                          {state.rooms
                            .filter((r) => r.groupId === selected.groupId)
                            .map((r, i) => (
                              <option key={r.id} value={r.id}>
                                範囲 {i + 1} · 高さ {r.heightMm}mm ·{' '}
                                {r.enabledCategories.map((c) => categoryLabels[c]).join('・')}
                              </option>
                            ))}
                        </select>
                      </>
                    )}

                    <p>壁高さ {quantityText(selected.heightMm)} mm</p>
                    <button
                      className="secondary wide"
                      disabled={busy}
                      onClick={() =>
                        setEditor({ id: selected.id, room: selected, polygon: selected.polygon })
                      }
                    >
                      <Pencil size={14} />
                      部屋を編集
                    </button>
                  </div>
                  <h4 className="panel-subheading">正味数量</h4>
                  {selectedItems.map((item) => {
                    const deducted = state.deductions
                      .filter((d) => d.targetItemId === item.id)
                      .reduce((s, d) => s + d.quantity, 0)
                    return (
                      <div className="quantity-card" key={item.id}>
                        <div>
                          <strong>{categoryLabels[item.category]}</strong>
                          <b
                            className={netQuantity(item, state.deductions) < 0 ? 'negative' : ''}
                            data-testid={`quantity-${item.category}`}
                          >
                            {quantityText(netQuantity(item, state.deductions))}
                            <small> {item.unit}</small>
                          </b>
                        </div>
                        <p>
                          {item.finish || '仕上げ未指定'}
                          {item.unitPrice !== null
                            ? ` · ${quantityText(item.unitPrice)} 円/${item.unit}`
                            : ''}
                        </p>
                        <small>
                          元数量 {quantityText(item.fixedQuantity ?? item.quantity)} − 控除{' '}
                          {quantityText(deducted)}
                        </small>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setFixed(item.id)}
                        >
                          {item.fixedQuantity !== null ? '固定数量を編集' : '数量を固定する'}
                        </button>
                      </div>
                    )
                  })}
                  <div className="opening-heading">
                    <h4>袖壁</h4>
                    <button
                      className="text-button"
                      disabled={busy || !canAddOpening}
                      onClick={() => {
                        setMode('sleeve')
                        setPoints([])
                        setCursor(null)
                      }}
                    >
                      線で追加
                    </button>
                  </div>
                  <p className="panel-description">
                    外周に往復線を入れず、厚みのない袖壁を別の線で拾います。
                  </p>
                  {selected.sleeveWalls.map((wall) => (
                    <div className="deduction-card" key={wall.id}>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setError('')
                          setSleeve({ roomId: selected.id, wall })
                        }}
                      >
                        <strong>
                          {wall.name}（{wall.faces}面）
                        </strong>
                        <small>
                          {quantityText(distance(...wall.points) * state.scaleRatio!)} m ·{' '}
                          {wall.heightMm === null
                            ? '部屋と同じ高さ'
                            : `${quantityText(wall.heightMm)} mm`}
                        </small>
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={`${wall.name}の線を削除`}
                        disabled={busy}
                        onClick={() =>
                          void requestPreview({
                            kind: 'room',
                            id: selected.id,
                            input: {
                              ...roomInputOf(selected),
                              sleeveWalls: selected.sleeveWalls.filter((w) => w.id !== wall.id)
                            }
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="opening-heading">
                    <h4>開口控除</h4>
                    <button
                      className="icon-button"
                      aria-label="開口控除を追加"
                      disabled={busy || !canAddOpening}
                      onClick={addOpening}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  {deductions.length ? (
                    deductions.map((d) => (
                      <div className="deduction-card" key={d.id}>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const { id, quantity: _q, unit: _u, ...input } = d
                            setOpening({ id, input })
                          }}
                        >
                          <strong>{d.name}</strong>
                          <small>
                            {
                              categoryLabels[
                                state.items.find((i) => i.id === d.targetItemId)!.category
                              ]
                            }{' '}
                            −{quantityText(d.quantity)} {d.unit}
                          </small>
                        </button>
                        <button
                          className="icon-button danger-text"
                          aria-label={`${d.name}を削除`}
                          disabled={busy}
                          onClick={() => void requestPreview({ kind: 'deleteDeduction', id: d.id })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="panel-description">壁は幅×高さ、巾木は幅を控除します。</p>
                  )}
                  <button
                    className="text-button danger-text delete-room"
                    title="この範囲に保存した割り付けも削除します"
                    disabled={busy}
                    onClick={() => void requestPreview({ kind: 'deleteRoom', id: selected.id })}
                  >
                    <Trash2 size={14} />
                    {state.rooms.filter((r) => r.groupId === selected.groupId).length > 1
                      ? 'この範囲と自動数量を削除'
                      : '部屋と自動数量を削除'}
                  </button>
                </>
              ) : (
                <div className="panel-empty">
                  <Ruler size={25} />
                  <h3>{state.scaleRatio ? '部屋を選択してください' : '縮尺を設定しましょう'}</h3>
                  <p>
                    {state.scaleRatio
                      ? '図面または左の一覧から選択すると、数量と仕上げを確認できます。'
                      : '「縮尺」を選び、図面上の既知の長さを2点で指定します。'}
                  </p>
                  {!state.scaleRatio && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setMode('scale')
                        setPoints([])
                      }}
                    >
                      縮尺を設定
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      {sleeve && state.rooms.find((r) => r.id === sleeve.roomId) && (
        <SleeveWallDialog
          room={state.rooms.find((r) => r.id === sleeve.roomId)!}
          wall={sleeve.wall}
          scale={state.scaleRatio!}
          busy={busy}
          error={error}
          close={() => {
            setSleeve(null)
            setError('')
          }}
          save={(wall) => {
            const room = state.rooms.find((r) => r.id === sleeve.roomId)!
            void requestPreview({
              kind: 'room',
              id: room.id,
              input: {
                ...roomInputOf(room),
                sleeveWalls: room.sleeveWalls.filter((w) => w.id !== wall.id).concat(wall)
              }
            })
          }}
        />
      )}
      {masterOpen && (
        <MaterialManager
          projectId={drawing.projectId}
          close={() => {
            setMasterOpen(false)
            refreshMasters()
          }}
        />
      )}
      {duplicate && (
        <TakeoffDialog title="同名の部屋があります" busy={busy} close={() => setDuplicate(null)}>
          <div className="preview-body">
            <p>
              「{duplicate.input.name}」はこのページに登録済みです。統合して数量を合算しますか？
            </p>
            <p>
              別の部屋として登録すると、部屋名の末尾に（2）などの連番を付けます。統合しても図形・仕上げ・高さ・控除は範囲ごとに保持します。重なる面積・共通の辺は自動で差し引きません。
            </p>
            <label>
              統合先
              <select
                aria-label="統合先の部屋"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
              >
                {state.rooms
                  .filter(
                    (r) =>
                      r.name === duplicate.input.name &&
                      r.groupId !==
                        (state.rooms.find((n) => n.id === duplicate.id)?.groupId ?? duplicate.id)
                  )
                  .filter((r, i, all) => all.findIndex((n) => n.groupId === r.groupId) === i)
                  .map((r, i) => (
                    <option key={r.id} value={r.id}>
                      {r.name}（候補 {i + 1}）
                    </option>
                  ))}
              </select>
            </label>
            {error && <p role="alert">{error}</p>}
          </div>
          <footer className="modal-footer">
            <button className="secondary" disabled={busy} onClick={() => setDuplicate(null)}>
              戻る
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void requestPreview({ ...duplicate, duplicateChoice: 'separate' })}
            >
              別の部屋として登録
            </button>
            <button
              className="primary"
              disabled={busy || !mergeTarget}
              onClick={() => void requestPreview({ ...duplicate, mergeInto: mergeTarget })}
            >
              統合して数量を確認
            </button>
          </footer>
        </TakeoffDialog>
      )}
      {scaleDialog && (
        <TakeoffDialog
          title="2点間の実寸を入力"
          close={() => {
            setScaleDialog(null)
            setError('')
          }}
          busy={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void requestPreview({
                kind: 'scale',
                points: scaleDialog,
                lengthMm: Number(new FormData(e.currentTarget).get('length'))
              })
            }}
          >
            <div className="form-body">
              <p>図面に記載された寸法を入力してください。</p>
              <label>
                実寸（mm）
                <input
                  autoFocus
                  aria-label="実寸（mm）"
                  name="length"
                  type="number"
                  required
                  min="0.001"
                  max="10000000"
                  step="any"
                  placeholder="例：4000"
                  defaultValue={state.calibration?.lengthMm ?? ''}
                />
              </label>
              {error && !preview && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setScaleDialog(null)}
              >
                キャンセル
              </button>
              <button className="primary" disabled={busy}>
                数量を確認
              </button>
            </footer>
          </form>
        </TakeoffDialog>
      )}
      {opening && (
        <TakeoffDialog
          title="開口控除"
          close={() => {
            setOpening(null)
            setError('')
          }}
          busy={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              void requestPreview({
                kind: 'deduction',
                id: opening.id,
                input: {
                  targetItemId: String(f.get('target')),
                  name: String(f.get('name')),
                  widthMm: Number(f.get('width')),
                  heightMm: Number(f.get('height')),
                  count: Number(f.get('count'))
                }
              })
            }}
          >
            <div className="form-body">
              <label>
                控除対象
                <select
                  aria-label="控除対象"
                  name="target"
                  defaultValue={opening.input.targetItemId}
                >
                  {selectedItems
                    .filter((i) => i.category === 'wall' || i.category === 'baseboard')
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {categoryLabels[i.category]}（{i.unit}）
                      </option>
                    ))}
                </select>
              </label>
              <label>
                開口名
                <input
                  aria-label="開口名"
                  name="name"
                  defaultValue={opening.input.name}
                  required
                  maxLength={120}
                />
              </label>
              <div className="opening-dimensions">
                <label>
                  幅（mm）
                  <input
                    aria-label="開口幅（mm）"
                    name="width"
                    type="number"
                    min="1"
                    max="10000000"
                    step="any"
                    required
                    defaultValue={opening.input.widthMm}
                  />
                </label>
                <label>
                  高さ（mm）
                  <input
                    aria-label="開口高さ（mm）"
                    name="height"
                    type="number"
                    min="1"
                    max="10000000"
                    step="any"
                    required
                    defaultValue={opening.input.heightMm}
                  />
                </label>
                <label>
                  箇所数
                  <input
                    aria-label="開口の箇所数"
                    name="count"
                    type="number"
                    min="1"
                    max="10000"
                    required
                    defaultValue={opening.input.count}
                  />
                </label>
              </div>
              <p className="panel-description">
                壁：幅×高さ×箇所数 ／ 巾木：幅×箇所数。巾木の計算には高さを使いません。
              </p>
              {error && !preview && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setOpening(null)}
              >
                キャンセル
              </button>
              <button className="primary" disabled={busy}>
                数量を確認
              </button>
            </footer>
          </form>
        </TakeoffDialog>
      )}
      {selectedFixed && (
        <TakeoffDialog
          title={`${categoryLabels[selectedFixed.category]}の数量を固定`}
          close={() => {
            setFixed(null)
            setError('')
          }}
          busy={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void requestPreview({
                kind: 'fixed',
                itemId: selectedFixed.id,
                quantity: Number(new FormData(e.currentTarget).get('quantity'))
              })
            }}
          >
            <div className="form-body">
              <p>元数量を手入力で固定します。開口控除は固定した数量から差し引きます。</p>
              <label>
                固定する元数量（{selectedFixed.unit}）
                <input
                  aria-label="固定する元数量"
                  name="quantity"
                  type="number"
                  min="0"
                  max="1000000000000"
                  step="any"
                  required
                  defaultValue={selectedFixed.fixedQuantity ?? selectedFixed.quantity}
                />
              </label>
              {selectedFixed.fixedQuantity !== null && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void requestPreview({ kind: 'fixed', itemId: selectedFixed.id, quantity: null })
                  }
                >
                  自動計算に戻す
                </button>
              )}
              {error && !preview && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button type="button" className="secondary" onClick={() => setFixed(null)}>
                キャンセル
              </button>
              <button className="primary" disabled={busy}>
                数量を確認
              </button>
            </footer>
          </form>
        </TakeoffDialog>
      )}
      {countDelete && (
        <TakeoffDialog
          title="個数拾いを削除しますか？"
          close={() => setCountDelete(null)}
          busy={busy}
        >
          <div className="summary-edit-form">
            <p>
              「{state.counts?.find((c) => c.id === countDelete)?.name}
              」のマークと数量を削除します。
            </p>
            <div className="summary-edit-actions">
              <button className="secondary" onClick={() => setCountDelete(null)}>
                キャンセル
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  void requestPreview({ kind: 'deleteCount', id: countDelete })
                  setCountDelete(null)
                }}
              >
                削除内容を確認
              </button>
            </div>
          </div>
        </TakeoffDialog>
      )}
      {preview && (
        <PreviewDialog
          preview={preview.data}
          apply={() => void apply()}
          close={() => {
            setPreview(null)
            setError('')
          }}
          busy={busy}
          error={error}
        />
      )}
      {navigation && (
        <TakeoffDialog title="未保存の編集があります" close={() => setNavigation(null)}>
          <div className="form-body">
            <p>編集中の形状・属性を破棄して移動しますか？保存済みの数量は変わりません。</p>
          </div>
          <footer className="modal-footer">
            <button className="secondary" onClick={() => setNavigation(null)}>
              編集を続ける
            </button>
            <button
              className="primary"
              onClick={() => {
                setEditor(null)
                clearDrawing()
                const action = navigation
                setNavigation(null)
                action()
              }}
            >
              破棄して移動
            </button>
          </footer>
        </TakeoffDialog>
      )}
    </section>
  )
}
