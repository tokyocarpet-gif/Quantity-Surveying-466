import { useState } from 'react'
import {
  companyIdentity,
  companyIdentitySchema,
  companyIssuer,
  type CompanyIdentity
} from '../../shared/business'
import { CompanyBlock, companyBlockCss } from '../../shared/CompanyBlock'
import { CompanyFields, advanceCompanyField } from './CompanyFields'
import { TakeoffDialog } from './takeoff/Dialogs'
import { unwrap } from './store'
export function EstimateIssuerDialog({
  initial,
  close,
  apply
}: {
  initial: CompanyIdentity
  close: () => void
  apply: (identity: CompanyIdentity) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <TakeoffDialog title="見積の会社情報" close={close} busy={busy}>
      <form
        className="summary-edit-form company-form"
        onKeyDown={advanceCompanyField}
        onSubmit={(e) => {
          e.preventDefault()
          try {
            const parsed = companyIdentitySchema.parse(value)
            if (companyIssuer(parsed).length > 1600) throw new Error('会社情報が長すぎます。')
            apply(parsed)
          } catch (e) {
            setError(e instanceof Error ? e.message : '入力内容を確認してください。')
          }
        }}
      >
        <p className="panel-description">
          この見積に表示する会社情報です。自社情報の登録内容は変更しません。
        </p>
        <div>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                setValue(companyIdentity(await unwrap(window.sekisan.readCompany())))
              } catch (e) {
                setError(e instanceof Error ? e.message : '自社情報を読み込めませんでした。')
              } finally {
                setBusy(false)
              }
            }}
          >
            登録済みの自社情報を読み込む
          </button>
        </div>
        <CompanyFields value={value} change={setValue} busy={busy} prefix="見積の会社情報の" />
        <div className="company-preview">
          <h3>見積書での表示</h3>
          <style>{companyBlockCss}</style>
          <CompanyBlock company={value} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="summary-edit-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={busy}>
            この見積に反映
          </button>
        </div>
      </form>
    </TakeoffDialog>
  )
}
