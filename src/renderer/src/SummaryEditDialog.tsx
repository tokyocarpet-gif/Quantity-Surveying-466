import { materialSpecification, partLabel } from '../../shared/materials'
import { MaterialInput } from './MaterialInput'
import { useEffect, useState } from 'react'
import { categoryLabels } from '../../shared/takeoff'
import type { Material } from '../../shared/materials'
import {
  summaryEditSchema,
  formatQuantity,
  type SummaryRow,
  type SummaryReport
} from '../../shared/summary'
import { TakeoffDialog } from './takeoff/Dialogs'
import { unwrap } from './store'
export function SummaryEditDialog({
  row,
  report,
  close,
  saved
}: {
  row: SummaryRow
  report: SummaryReport
  close: () => void
  saved: (report: SummaryReport) => void
}): React.JSX.Element {
  const [name, setName] = useState(row.finish),
    [price, setPrice] = useState(row.unitPrice === null ? '' : String(row.unitPrice))
  const [specification, setSpecification] = useState(row.specification ?? '')
  const [materials, setMaterials] = useState<Material[]>([]),
    [loading, setLoading] = useState(true),
    [masterError, setMasterError] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void unwrap(window.sekisan.readMaterials(report.request.projectId))
      .then((data) => {
        if (!cancelled)
          setMaterials(
            data.project.filter((m) => m.category === row.category && m.unit === row.unit)
          )
      })
      .catch((e) => {
        if (!cancelled) setMasterError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [report.request.projectId, row.category])
  const dirty =
    name.trim() !== row.finish ||
    specification.trim() !== (row.specification ?? '') ||
    (price === '' ? null : Number(price)) !== row.unitPrice
  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const parsed = summaryEditSchema.safeParse({
      request: report.request,
      fingerprint: report.fingerprint,
      rowId: row.id,
      finish: { name, specification, unitPrice: price === '' ? null : Number(price) }
    })
    if (!parsed.success) {
      setError('仕上げは120文字以内、単価は0〜1,000,000,000円で入力してください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      saved(await unwrap(window.sekisan.editSummary(parsed.data)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <TakeoffDialog title="仕上げ・単価を編集" close={close} busy={busy}>
      <form className="summary-edit-form" onSubmit={(e) => void submit(e)}>
        <div className="summary-edit-context">
          <strong>
            {row.roomLabel} · {partLabel(row.category)}
          </strong>
          <p>{row.location}</p>
          <p>
            正味数量 {formatQuantity(row.quantity)} {row.unit}
          </p>
        </div>
        {masterError && (
          <p className="form-error">
            マスタを読み込めませんでした：{masterError} 手入力で編集できます。
          </p>
        )}
        {!loading && !materials.length && !masterError && (
          <p className="panel-description">
            この部位の物件マスタは未登録です。仕上げ・単価を直接入力できます。
          </p>
        )}
        <label>
          仕上げ材
          <MaterialInput
            label="集計の仕上げ材"
            autoFocus
            value={name}
            materials={materials}
            disabled={busy}
            onChange={setName}
            onSelect={(m) => {
              setName(m.name)
              setSpecification(materialSpecification(m))
              setPrice(m.unitPrice === null ? '' : String(m.unitPrice))
            }}
          />
        </label>
        <label>
          仕様・規格
          <input
            aria-label="集計の仕様・規格"
            value={specification}
            maxLength={400}
            disabled={busy}
            onChange={(e) => setSpecification(e.target.value)}
          />
        </label>
        <label>
          単価（円/{row.unit}）
          <input
            aria-label="集計の単価"
            type="number"
            min="0"
            max="1000000000"
            step="any"
            placeholder="空欄は未設定"
            value={price}
            disabled={busy}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <p className="panel-description">
          この行に含まれる{row.sourceIds.length}
          件の元明細へ反映します。統合した部屋の複数範囲を含む場合は、まとめて変更します。
        </p>
        <p className="panel-description">単価の空欄は未設定、0は0円として保存します。</p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="summary-edit-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={busy || !dirty}>
            {busy ? '保存中…' : '保存して反映'}
          </button>
        </div>
      </form>
    </TakeoffDialog>
  )
}
