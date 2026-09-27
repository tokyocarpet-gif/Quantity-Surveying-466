import { useEffect, useRef, useState } from 'react'
import type { CoverSummary } from '../../shared/estimate-cover'
import { estimateMoney } from '../../shared/EstimateDocument'
import { TakeoffDialog } from './takeoff/Dialogs'

export function EstimateCoverDialog({
  row,
  initialKey,
  canNext,
  apply,
  close
}: {
  row: CoverSummary
  initialKey: string
  canNext: boolean
  apply: (
    draft: { name: string; specification: string; note: string },
    next: boolean
  ) => string | void
  close: () => void
}) {
  const [draft, setDraft] = useState({
    name: row.name,
    specification: row.specification,
    note: row.note
  })
  const [error, setError] = useState('')
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>(`[data-cover-key="${initialKey}"]`)?.focus()
  }, [initialKey])
  function submit(next: boolean) {
    const failure = apply(draft, next)
    if (failure) setError(failure)
  }
  return (
    <TakeoffDialog title="表紙の大項目を編集" close={close}>
      <form
        ref={form}
        className="estimate-row-form"
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
          {row.section}
          <span>表紙に表示する内容を編集します。金額は内訳の合計と連動します。</span>
        </p>
        <div className="estimate-row-fields" style={{ gridTemplateColumns: '1fr' }}>
          {(['name', 'specification', 'note'] as const).map((key) => {
            const label = { name: '大項目名', specification: '仕様・規格・寸法', note: '備考' }[key]
            const attrs = {
              'aria-label': `表紙の${label}`,
              'data-cover-key': key,
              value: draft[key],
              maxLength: { name: 120, specification: 400, note: 500 }[key],
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                setDraft((d) => ({ ...d, [key]: e.target.value }))
                setError('')
              }
            }
            return (
              <label key={key}>
                {label}
                {key === 'note' ? <textarea {...attrs} /> : <input {...attrs} />}
              </label>
            )
          })}
          <div className="estimate-row-amount">
            <span>金額（内訳から自動計算）</span>
            <strong>
              {estimateMoney(row.amount)}
              {row.amount === null ? '' : ' 円'}
            </strong>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="estimate-row-actions">
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
