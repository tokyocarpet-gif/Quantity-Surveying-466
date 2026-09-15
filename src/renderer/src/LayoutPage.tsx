import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft } from 'lucide-react'
import type { Drawing } from '../../shared/api'
import type { PageState } from '../../shared/takeoff'
import { unwrap } from './store'
import { LayoutEditor } from './takeoff/LayoutEditor'
import { PdfPage } from './takeoff/PdfPage'
import './takeoff/layout.css'

export function LayoutPage({
  drawing,
  pdf,
  pageNumber,
  onPage,
  initialRoomId,
  back,
  openTakeoff
}: {
  drawing: Drawing
  pdf: PDFDocumentProxy
  pageNumber: number
  onPage: (page: number) => void
  initialRoomId: string | null
  back: () => void
  openTakeoff: () => void
}): React.JSX.Element {
  const [state, setState] = useState<PageState | null>(null),
    [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(initialRoomId)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    let active = true
    setError('')
    setState(null)
    setZoom(1)
    void unwrap(window.sekisan.readTakeoff({ drawingId: drawing.id, pageNumber }))
      .then((result) => {
        result = { ...result, rooms: result.rooms.filter((r) => r.geometryType !== 'wall-line') }
        if (active) {
          setState(result)
          setSelectedId(
            result.rooms.some((r) => r.id === initialRoomId)
              ? initialRoomId
              : (result.rooms[0]?.id ?? null)
          )
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [drawing.id, pageNumber, initialRoomId])
  const current = state?.pageNumber === pageNumber ? state : null
  const room = current?.rooms.find((r) => r.id === selectedId)
  const header = (leave: (action: () => void) => void, busy: boolean): React.JSX.Element => (
    <header className="layout-page-header">
      <button
        className="icon-button"
        aria-label="図面一覧に戻る"
        disabled={busy}
        onClick={() => leave(back)}
      >
        <ArrowLeft size={20} />
      </button>
      <div className="layout-page-title">
        <span className="eyebrow">床材の割り付け</span>
        <h1>{drawing.name}</h1>
      </div>
      <label>
        ページ
        <select
          aria-label="割り付けのページ"
          disabled={busy}
          value={pageNumber}
          onChange={(e) => {
            const page = Number(e.target.value)
            leave(() => onPage(page))
          }}
        >
          {Array.from({ length: drawing.pageCount }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1} / {drawing.pageCount}ページ
            </option>
          ))}
        </select>
      </label>
    </header>
  )
  const roomSelection = (leave: (action: () => void) => void, busy: boolean): React.JSX.Element => (
    <div className="layout-room-selection">
      <label>
        部屋
        <select
          aria-label="割り付けの部屋"
          disabled={busy || !current?.rooms.length}
          value={room?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value
            leave(() => setSelectedId(id))
          }}
        >
          {!current?.rooms.length && (
            <option value="">{current ? 'このページに部屋がありません' : '読み込み中…'}</option>
          )}
          {current?.rooms.map((r, i) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {current.rooms.filter((n) => n.name === r.name).length > 1 ? `（範囲 ${i + 1}）` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
  if (room && current?.scaleRatio)
    return (
      <LayoutEditor
        key={`${pageNumber}:${room.id}`}
        room={room}
        scale={current.scaleRatio}
        pdf={pdf}
        pageNumber={pageNumber}
        projectId={drawing.projectId}
        close={back}
        navigation={header}
        roomSelection={roomSelection}
      />
    )
  return (
    <section className="layout-screen">
      {header((action) => action(), false)}
      <div className="layout-empty-body">
        <aside className="layout-settings">{roomSelection((action) => action(), false)}</aside>
        <div className="layout-empty-content">
          <div className="layout-empty-message">
            {error ? (
              <p role="alert">{error}</p>
            ) : !current ? (
              <p>部屋を読み込んでいます…</p>
            ) : (
              <>
                <h2>
                  {current.rooms.length
                    ? '縮尺を設定してください'
                    : 'このページに拾い出した部屋がありません'}
                </h2>
                <p>割り付けは拾い出し画面で保存した部屋と縮尺を使います。</p>
                <button className="primary" onClick={openTakeoff}>
                  拾い出し画面を開く
                </button>
              </>
            )}
          </div>
          <PdfPage
            key={pageNumber}
            pdf={pdf}
            pageNumber={pageNumber}
            zoom={zoom}
            onZoom={setZoom}
            resetView={pageNumber}
            crosshair={null}
            pan={false}
            overlay={() => null}
          />
        </div>
      </div>
    </section>
  )
}
