import type { LayoutPdfRequest } from '../../shared/layout-pdf'
import type { SummaryExport } from '../../shared/summary'
import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { EstimatePdfRequest } from '../../shared/estimate'
import { TakeoffDialog } from './takeoff/Dialogs'
import { unwrap } from './store'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

function PreviewPage({
  pdf,
  number,
  ready,
  fail,
  label
}: {
  pdf: pdfjs.PDFDocumentProxy
  number: number
  ready: () => void
  fail: (message: string) => void
  label: string
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const callbacks = useRef({ ready, fail })
  callbacks.current = { ready, fail }
  useEffect(() => {
    let cancelled = false
    let rendering: pdfjs.RenderTask | undefined
    void pdf
      .getPage(number)
      .then(async (page) => {
        if (cancelled || !canvas.current) return
        const viewport = page.getViewport({ scale: 1.5 })
        canvas.current.width = viewport.width
        canvas.current.height = viewport.height
        rendering = page.render({ canvas: canvas.current, viewport })
        await rendering.promise
        if (!cancelled) callbacks.current.ready()
      })
      .catch((e) => {
        if (!cancelled) callbacks.current.fail(e.message)
      })
    return () => {
      cancelled = true
      rendering?.cancel()
    }
  }, [pdf, number])
  return <canvas ref={canvas} aria-label={`${label} ${number}ページ`} />
}

export function EstimatePdfDialog({
  request,
  close
}: {
  request: EstimatePdfRequest
  close: () => void
}): React.JSX.Element {
  return <ReportPdfDialog request={{ kind: 'estimate', input: request }} close={close} />
}
export function SummaryPdfDialog({
  request,
  close
}: {
  request: SummaryExport
  close: () => void
}): React.JSX.Element {
  return <ReportPdfDialog request={{ kind: 'summary', input: request }} close={close} />
}
export function LayoutPdfDialog({
  request,
  close
}: {
  request: LayoutPdfRequest
  close: () => void
}): React.JSX.Element {
  return <ReportPdfDialog request={{ kind: 'layout', input: request }} close={close} />
}
function ReportPdfDialog({
  request,
  close
}: {
  request:
    | { kind: 'estimate'; input: EstimatePdfRequest }
    | { kind: 'summary'; input: SummaryExport }
    | { kind: 'layout'; input: LayoutPdfRequest }
  close: () => void
}): React.JSX.Element {
  const summary = request.kind === 'summary'
  const label = request.kind === 'layout' ? '割り付けPDF' : summary ? '集計積算書PDF' : '見積PDF'
  const caption =
    request.kind === 'estimate'
      ? `第${request.input.revision}版 · A4横・表紙＋内訳`
      : request.kind === 'layout'
        ? '選択した部屋の配置と使用材料 · A4横'
        : '表示中の集計 · A4横'
  const requestKey = JSON.stringify(request)
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [token, setToken] = useState(''),
    [number, setNumber] = useState(1)
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false)
  const [rendered, setRendered] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false,
      previewToken = ''
    let task: pdfjs.PDFDocumentLoadingTask | undefined
    setLoading(true)
    setError('')
    setPdf(null)
    setToken('')
    setNumber(1)
    setRendered(false)
    setNotice('')
    void unwrap(
      request.kind === 'estimate'
        ? window.sekisan.previewEstimatePdf(request.input)
        : request.kind === 'layout'
          ? window.sekisan.previewLayoutPdf(request.input)
          : window.sekisan.previewSummaryPdf(request.input)
    )
      .then(async (result) => {
        previewToken = result.token
        if (cancelled) {
          void window.sekisan.closePdfPreview(previewToken)
          return
        }
        setToken(result.token)
        const base = new URL('./pdf/', location.href.split('#')[0])
        task = pdfjs.getDocument({
          data: result.bytes,
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
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      void task?.destroy()
      if (previewToken) void window.sekisan.closePdfPreview(previewToken)
    }
  }, [requestKey, attempt])

  async function save(): Promise<void> {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const path = await unwrap(window.sekisan.savePdfPreview(token))
      if (path) setNotice(`PDFを保存しました：${path}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDFを保存できませんでした。')
    } finally {
      setSaving(false)
    }
  }
  return (
    <TakeoffDialog title={`${label}プレビュー`} close={close} busy={saving}>
      <div className={`estimate-pdf-preview ${summary ? 'summary-pdf-preview' : ''}`}>
        <div className="estimate-pdf-toolbar">
          <span>{caption}</span>
          {pdf && (
            <label>
              ページ
              <select
                aria-label={`${label}のページ`}
                value={number}
                disabled={saving}
                onChange={(e) => {
                  setRendered(false)
                  setNumber(Number(e.target.value))
                }}
              >
                {Array.from({ length: pdf.numPages }, (_, i) => (
                  <option value={i + 1} key={i}>
                    {i + 1} / {pdf.numPages}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="primary"
            disabled={loading || saving || !rendered || !token}
            onClick={() => void save()}
          >
            PDFを保存
          </button>
        </div>
        {notice && (
          <p className="estimate-pdf-message" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
            <button
              className="text-button"
              disabled={loading || saving}
              onClick={() => setAttempt((n) => n + 1)}
            >
              プレビューを作り直す
            </button>
          </p>
        )}
        <div className="estimate-pdf-paper" aria-busy={loading || (!!pdf && !rendered)}>
          {loading && <p role="status">PDFを作成しています…</p>}
          {pdf && (
            <PreviewPage
              pdf={pdf}
              number={number}
              ready={() => setRendered(true)}
              fail={setError}
              label={label}
            />
          )}
        </div>
      </div>
    </TakeoffDialog>
  )
}
