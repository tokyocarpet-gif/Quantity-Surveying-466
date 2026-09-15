import { partLabel } from '../../../shared/materials'
import { useEffect, useRef, type ReactNode } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { scaleDenominator, categoryLabels, type TakeoffPreview } from '../../../shared/takeoff'
export const quantityText = (n: number | null): string =>
  n === null ? '—' : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 }).format(n)
export const scaleText = (scale: number | null): string => {
  const n = scaleDenominator(scale)
  return n === null
    ? '縮尺未設定'
    : `約1/${new Intl.NumberFormat('ja-JP', n < 1 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 }).format(n)}`
}
export function TakeoffDialog({
  title,
  children,
  close,
  busy = false
}: {
  title: string
  children: ReactNode
  close: () => void
  busy?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return (
    <dialog
      className="modal takeoff-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) close()
      }}
    >
      <header className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="閉じる" disabled={busy} onClick={close}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  )
}
export function PreviewDialog({
  preview,
  apply,
  close,
  busy,
  error
}: {
  preview: TakeoffPreview
  apply: () => void
  close: () => void
  busy: boolean
  error: string
}): React.JSX.Element {
  return (
    <TakeoffDialog title="数量の変更を確認" close={close} busy={busy}>
      <div className="preview-body">
        <p>内容を確認して「反映する」を押すと保存されます。</p>
        {preview.before.scaleRatio !== preview.after.scaleRatio && (
          <div className="scale-summary">
            縮尺を{preview.before.scaleRatio === null ? '設定' : '変更'}します。指定した2点の実寸：
            <strong>{quantityText(preview.after.calibration?.lengthMm ?? null)} mm</strong>
            <p>縮尺 {scaleText(preview.after.scaleRatio)}（PDF原寸換算）</p>
          </div>
        )}
        {preview.mergeSummary && (
          <div className="scale-summary">
            <strong>{preview.mergeSummary.name} · 統合後の合計</strong>
            {preview.mergeSummary.rows.map((r) => (
              <p key={`${r.category}-${r.unit}`}>
                {partLabel(r.category)}：{quantityText(r.before)} → {quantityText(r.after)} {r.unit}
              </p>
            ))}
            <small>下の明細は今回変更する範囲です。</small>
          </div>
        )}
        <div className="preview-table-scroll">
          <table className="quantity-preview">
            <thead>
              <tr>
                <th>部屋・部位</th>
                <th>変更前</th>
                <th>変更後</th>
                <th>単位</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.itemId}>
                  <td>
                    {row.roomName}
                    <small>
                      {partLabel(row.category)} {row.fixed ? '・数量固定' : ''}
                    </small>
                  </td>
                  <td>
                    {quantityText(row.before)}
                    {row.beforeUnit ? ` ${row.beforeUnit}` : ''}
                  </td>
                  <td className={row.after !== null && row.after < 0 ? 'negative' : ''}>
                    {quantityText(row.after)}
                  </td>
                  <td>{row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.rows.some((r) => r.fixed && r.after !== null) && (
          <p className="fixed-note">
            残る項目の固定数量は、縮尺・高さを変えても入力値を保持します。
          </p>
        )}
        {preview.warnings.map((w) => (
          <div className="form-error" key={w}>
            <AlertTriangle size={16} />
            {w}
          </div>
        ))}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <button className="secondary" disabled={busy} onClick={close}>
          戻る
        </button>
        <button className="primary" disabled={busy} onClick={apply}>
          {busy ? '保存中…' : '反映する'}
        </button>
      </footer>
    </TakeoffDialog>
  )
}
