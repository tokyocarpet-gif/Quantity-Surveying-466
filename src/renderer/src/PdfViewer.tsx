import { LayoutPage } from './LayoutPage'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Drawing } from '../../shared/api'
import { unwrap } from './store'
import { TakeoffEditor } from './takeoff/TakeoffEditor'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export function PdfViewer({
  drawing,
  initialPage = 1,
  initialRoomId = null,
  back,
  backLabel = '図面一覧に戻る',
  mode = 'takeoff'
}: {
  drawing: Drawing
  initialPage?: number
  initialRoomId?: string | null
  backLabel?: string
  back: () => void
  mode?: 'takeoff' | 'layout'
}): React.JSX.Element {
  const navigate = useNavigate()
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(initialPage)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    let task: pdfjs.PDFDocumentLoadingTask | undefined
    void unwrap(window.sekisan.readPdf(drawing.id))
      .then(async (data) => {
        if (cancelled) return
        const base = new URL('./pdf/', location.href.split('#')[0])
        task = pdfjs.getDocument({
          data,
          cMapUrl: new URL('cmaps/', base).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('standard_fonts/', base).href,
          wasmUrl: new URL('wasm/', base).href
        })
        const loaded = await task.promise
        if (!cancelled) setPdf(loaded)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [drawing.id])
  if (!pdf)
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
            <p>図面を読み込んでいます…</p>
          )}
        </div>
      </section>
    )
  if (mode === 'layout')
    return (
      <LayoutPage
        drawing={drawing}
        pdf={pdf}
        pageNumber={pageNumber}
        onPage={setPageNumber}
        initialRoomId={initialRoomId}
        back={back}
        openTakeoff={() => navigate(`/drawing/${drawing.id}?page=${pageNumber}`)}
      />
    )
  return (
    <TakeoffEditor
      key={`${drawing.id}:${pageNumber}`}
      drawing={drawing}
      initialSelectedId={initialRoomId}
      pdf={pdf}
      pageNumber={pageNumber}
      onPage={setPageNumber}
      back={back}
      backLabel={backLabel}
    />
  )
}
