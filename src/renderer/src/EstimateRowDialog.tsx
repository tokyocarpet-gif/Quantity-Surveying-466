import { useEffect, useRef, useState } from 'react'
import {
  estimateLineSchema,
  calculateEstimate,
  type EstimateBody,
  type EstimateLine
} from '../../shared/estimate'
import { parseEstimateValue } from '../../shared/estimate-edit'
import { partLabel, materialSpecification, type MaterialContext } from '../../shared/materials'
import { estimateMoney } from '../../shared/EstimateDocument'
import { TakeoffDialog } from './takeoff/Dialogs'
import { errorMessage } from './error-message'

export function EstimateRowDialog({
  line,
  body,
  isNew,
  canNext,
  initialKey,
  catalog,
  apply,
  close,
  remove,
  cover = false
}: {
  line: EstimateLine
  body: EstimateBody
  isNew: boolean
  canNext: boolean
  initialKey: string
  catalog: MaterialContext | null
  apply: (line: EstimateLine, next: boolean) => string | void
  close: () => void
  remove?: () => void
  cover?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(line).map(([k, v]) => [
        k,
        k === 'category' ? partLabel(line.category) : String(v ?? '')
      ])
    )
  )
  const [error, setError] = useState('')
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>(`[data-row-key="${initialKey}"]`)?.focus()
  }, [initialKey])
  const converted = () =>
    estimateLineSchema.parse({
      ...line,
      ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, parseEstimateValue(k, v)]))
    })
  let amount: string | null = null
  try {
    amount = calculateEstimate({
      ...body,
      lines: [converted()],
      presentation: undefined,
      detailSheets: undefined,
      expenses: 0,
      coverExtras: []
    }).amounts[0]
  } catch {
    /* Invalid draft is reported on apply. */
  }
  const submit = (next: boolean) => {
    try {
      const failure = apply(converted(), next)
      if (failure) setError(failure)
    } catch (e) {
      setError(errorMessage(e, '入力内容を確認してください。'))
    }
  }
  const field = (key: string, label: string, list?: string) => (
    <label key={key} className={`estimate-row-field-${key}`}>
      {label}
      <input
        aria-label={`${cover ? '表紙の行' : '明細'}の${label}`}
        data-row-key={key}
        autoFocus={key === initialKey}
        value={draft[key] ?? ''}
        list={list}
        inputMode={['quantity', 'unitPrice'].includes(key) ? 'decimal' : undefined}
        onChange={(e) => {
          setDraft((d) => ({ ...d, [key]: e.target.value }))
          setError('')
        }}
        onBlur={() => {
          if (cover || key !== 'specification' || draft.specification === line.specification) return
          const named = catalog?.project.filter((m) => m.name === draft.specification) ?? []
          const material =
            catalog?.project.find(
              (m) => draft.specification === `${m.name}｜${materialSpecification(m)}`
            ) ?? (named.length === 1 ? named[0] : undefined)
          if (material)
            setDraft((d) => ({
              ...d,
              specification: material.name,
              category: partLabel(material.category),
              specification2: materialSpecification(material),
              unit: material.unit,
              unitPrice: String(material.unitPrice ?? '')
            }))
        }}
      />
    </label>
  )
  return (
    <TakeoffDialog
      title={
        cover ? (isNew ? '表紙の行を追加' : '表紙の行を編集') : isNew ? '明細を追加' : '明細を編集'
      }
      close={close}
    >
      <form
        className="estimate-row-form"
        ref={form}
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault()
            const inputs = [
              ...e.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
                'input,textarea'
              )
            ]
            inputs[inputs.indexOf(e.target) + 1]?.focus()
          }
        }}
      >
        <p className="estimate-row-context">
          {cover ? '表紙' : line.section || '工事名未入力'}
          <span>必要な項目だけ変更できます。Tabで次の項目へ移動します。</span>
        </p>
        <div className="estimate-row-fields">
          {field('itemNo', '番号')}
          {field('name', '品名')}
          {!cover && field('category', '部位', 'estimate-parts')}
          {!cover && field('manufacturer', 'メーカー', 'estimate-manufacturers')}
          {field(
            'specification',
            cover ? '仕様・規格・寸法' : '仕様1',
            cover ? undefined : 'estimate-materials'
          )}
          {!cover && field('specification2', '仕様2')}
          {!cover && field('specification3', '仕様3')}
          {field('quantity', '数量')}
          {field('unit', '単位', 'estimate-units')}
          {field('unitPrice', '単価')}
          <div className="estimate-row-amount">
            <span>金額（自動計算）</span>
            <strong>{estimateMoney(amount)} 円</strong>
          </div>
          {!cover && field('room', '部屋')}
          <label className="estimate-row-note">
            備考
            <textarea
              aria-label={cover ? '表紙の行の備考' : '明細の備考'}
              data-row-key="note"
              value={draft.note ?? ''}
              onChange={(e) => {
                setDraft((d) => ({ ...d, note: e.target.value }))
                setError('')
              }}
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!canNext && !cover && (
          <p className="estimate-row-limit">
            この帳票の最後の行です。内訳を増やす場合は「内訳明細書を追加」を押してください。
          </p>
        )}
        <footer className="estimate-row-actions">
          {remove && (
            <button type="button" className="estimate-delete-action" onClick={remove}>
              この明細を削除
            </button>
          )}
          <span className="toolbar-spacer" />
          <button type="button" className="secondary" onClick={close}>
            キャンセル
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!canNext}
            onClick={() => submit(true)}
          >
            反映して次の行
          </button>
          <button type="submit" className="primary">
            反映
          </button>
        </footer>
      </form>
    </TakeoffDialog>
  )
}
