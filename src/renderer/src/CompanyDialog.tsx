import { useEffect, useState } from 'react'
import { companySchema, emptyCompany, type Company } from '../../shared/business'
import { TakeoffDialog } from './takeoff/Dialogs'
import { unwrap } from './store'
export function CompanyDialog({ close }: { close: () => void }): React.JSX.Element {
  const [value, setValue] = useState<Company>(emptyCompany()),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  useEffect(() => {
    let cancelled = false
    void unwrap(window.sekisan.readCompany())
      .then((v) => {
        if (!cancelled) setValue(v)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const labels = {
    name: '会社名',
    postalCode: '郵便番号',
    address: '住所',
    phone: '電話番号',
    fax: 'FAX',
    email: 'メールアドレス',
    contact: '担当者',
    registrationNumber: '登録番号'
  }
  const defaults = [
    {
      key: 'estimateValidity',
      label: '見積有効期限',
      placeholder: '例：発行日から30日間',
      maxLength: 200
    },
    {
      key: 'paymentTerms',
      label: '支払条件',
      placeholder: '例：月末締め・翌月末払い',
      maxLength: 500
    },
    {
      key: 'otherConditions',
      label: 'その他の基本条件',
      placeholder: '例：工事日程は別途協議',
      maxLength: 1000
    }
  ] as const
  return (
    <TakeoffDialog title="自社情報" close={close} busy={busy}>
      <form
        className="summary-edit-form company-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          setNotice('')
          try {
            setValue(await unwrap(window.sekisan.saveCompany(companySchema.parse(value))))
            setNotice('自社情報を保存しました。')
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存できませんでした。')
          } finally {
            setBusy(false)
          }
        }}
      >
        <p className="panel-description">
          会社・連絡先と基本条件を、新しく作成する見積に引き継ぎます。見積ごとにも編集できます。
        </p>
        {Object.entries(labels).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={`自社の${label}`}
              value={value[key as keyof Company]}
              disabled={busy}
              onChange={(e) => {
                setValue({ ...value, [key]: e.target.value })
                setNotice('')
              }}
            />
          </label>
        ))}
        <div className="company-default-heading">
          <h3>見積の基本条件</h3>
          <p className="panel-description">
            未入力の項目は見積に追加しません。保存済みの見積は変更しません。
          </p>
        </div>
        {defaults.map(({ key, label, placeholder, maxLength }) => (
          <label className={key === 'otherConditions' ? 'company-wide' : ''} key={key}>
            {label}
            <textarea
              aria-label={`自社の${label}`}
              value={value[key]}
              placeholder={placeholder}
              maxLength={maxLength}
              rows={2}
              disabled={busy}
              onChange={(e) => {
                setValue({ ...value, [key]: e.target.value })
                setNotice('')
              }}
            />
          </label>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="summary-edit-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            閉じる
          </button>
          <button className="primary" disabled={busy}>
            自社情報を保存
          </button>
        </div>
      </form>
    </TakeoffDialog>
  )
}
