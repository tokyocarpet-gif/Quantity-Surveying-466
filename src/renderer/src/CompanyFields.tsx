import { type CompanyIdentity } from '../../shared/business'
export const companyFields = [
  {
    key: 'constructionLicense',
    label: '建設業許可',
    placeholder: '例：東京都知事許可（般2）第12226号',
    max: 160
  },
  {
    key: 'fireCertification',
    label: '消防庁認定',
    placeholder: '例：消防庁認定第12703号',
    max: 160
  },
  { key: 'name', label: '会社名', placeholder: '例：東京カーペット加工 株式会社', max: 120 },
  { key: 'postalCode', label: '郵便番号', placeholder: '例：130-0012', max: 20 },
  { key: 'address', label: '住所', placeholder: '例：東京都墨田区太平4-6-6', max: 300 },
  { key: 'phone', label: '電話番号', placeholder: '例：03-3625-4169', max: 40 },
  { key: 'fax', label: 'FAX', placeholder: '例：03-3626-2669', max: 40 },
  { key: 'email', label: 'メールアドレス', placeholder: '', max: 120 },
  { key: 'contact', label: '担当者', placeholder: '', max: 100 },
  {
    key: 'registrationNumber',
    label: '登録番号',
    placeholder: '例：Tから始まる適格請求書発行事業者番号',
    max: 40
  }
] as const
export function CompanyFields({
  value,
  change,
  busy,
  prefix = '自社の'
}: {
  value: CompanyIdentity
  change: (value: CompanyIdentity) => void
  busy?: boolean
  prefix?: string
}): React.JSX.Element {
  return (
    <>
      {companyFields.map(({ key, label, placeholder, max }) => (
        <label key={key} className={['name', 'address'].includes(key) ? 'company-wide' : ''}>
          {label}
          <input
            aria-label={`${prefix}${label}`}
            value={value[key]}
            placeholder={placeholder}
            maxLength={max}
            disabled={busy}
            onChange={(e) => change({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
    </>
  )
}
export function advanceCompanyField(e: React.KeyboardEvent<HTMLFormElement>): void {
  if (
    e.key !== 'Enter' ||
    e.nativeEvent.isComposing ||
    e.keyCode === 229 ||
    !(e.target instanceof HTMLInputElement)
  )
    return
  e.preventDefault()
  const controls = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      'input:not(:disabled),textarea:not(:disabled),button[type="submit"]'
    )
  ]
  controls[controls.indexOf(e.target) + 1]?.focus()
}
