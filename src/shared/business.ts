import { z } from 'zod'
import { categories, categoryLabels } from './takeoff'
export const companyIdentitySchema = z
  .object({
    constructionLicense: z.string().trim().max(160).default(''),
    fireCertification: z.string().trim().max(160).default(''),
    name: z.string().trim().max(120),
    postalCode: z.string().trim().max(20),
    address: z.string().trim().max(300),
    phone: z.string().trim().max(40),
    fax: z.string().trim().max(40),
    email: z.string().trim().max(120),
    contact: z.string().trim().max(100),
    registrationNumber: z.string().trim().max(40)
  })
  .strict()
export type CompanyIdentity = z.infer<typeof companyIdentitySchema>
export const companySchema = companyIdentitySchema
  .extend({
    estimateValidity: z.string().trim().max(200).default(''),
    paymentTerms: z.string().trim().max(500).default(''),
    otherConditions: z.string().trim().max(1000).default('')
  })
  .strict()
export type Company = z.infer<typeof companySchema>
export const emptyCompany = (): Company => ({
  constructionLicense: '',
  fireCertification: '',
  name: '',
  postalCode: '',
  address: '',
  phone: '',
  fax: '',
  email: '',
  contact: '',
  registrationNumber: '',
  estimateValidity: '',
  paymentTerms: '',
  otherConditions: ''
})
export function companyIssuerLines(c: CompanyIdentity): { kind: string; text: string }[] {
  return [
    { kind: 'permit', text: c.constructionLicense },
    { kind: 'permit', text: c.fireCertification },
    { kind: 'name', text: c.name },
    { kind: 'postal', text: c.postalCode ? `〒${c.postalCode.replace(/^〒\s*/, '')}` : '' },
    { kind: 'address', text: c.address },
    {
      kind: 'phone',
      text: [c.phone ? `TEL ${c.phone}` : '', c.fax ? `FAX ${c.fax}` : '']
        .filter(Boolean)
        .join('　')
    },
    { kind: 'extra', text: c.email },
    { kind: 'extra', text: c.contact ? `担当 ${c.contact}` : '' },
    { kind: 'extra', text: c.registrationNumber ? `登録番号 ${c.registrationNumber}` : '' }
  ].filter((line) => line.text)
}
export function companyIssuer(c: CompanyIdentity): string {
  return companyIssuerLines(c)
    .map((line) => line.text)
    .join('\n')
}
/** Legacy/free-text issuers remain authoritative when their snapshot no longer matches. */
export function structuredIssuer(body: {
  issuer: string
  issuerCompany?: CompanyIdentity
}): CompanyIdentity | undefined {
  return body.issuerCompany && companyIssuer(body.issuerCompany) === body.issuer
    ? body.issuerCompany
    : undefined
}
export function companyConditions(c: Company): string {
  return [
    c.estimateValidity ? `有効期限：${c.estimateValidity}` : '',
    c.paymentTerms ? `支払条件：${c.paymentTerms}` : '',
    c.otherConditions
  ]
    .filter(Boolean)
    .join('\n')
}
export const catalogOptionsSchema = z
  .object({
    parts: z.array(z.string().trim().min(1).max(120)).max(200),
    units: z.array(z.string().trim().min(1).max(20)).max(100)
  })
  .strict()
export const addCatalogOptionSchema = z
  .object({ kind: z.enum(['part', 'unit']), name: z.string().trim().min(1).max(120) })
  .strict()
  .refine((v) => v.kind !== 'unit' || v.name.length <= 20, '単位は20文字以内にしてください。')
export type AddCatalogOption = z.infer<typeof addCatalogOptionSchema>

export function companyIdentity(company: Company): CompanyIdentity {
  return companyIdentitySchema.parse(
    Object.fromEntries(
      Object.keys(companyIdentitySchema.shape).map((key) => [key, company[key as keyof Company]])
    )
  )
}

export const renameCatalogOptionSchema = z
  .object({
    kind: z.enum(['part', 'unit']),
    oldName: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(120)
  })
  .strict()
  .refine(
    (v) => v.kind !== 'unit' || (v.name.length <= 20 && v.oldName.length <= 20),
    '単位は20文字以内にしてください。'
  )
export type RenameCatalogOption = z.infer<typeof renameCatalogOptionSchema>
export function builtinCatalogValues(kind: 'part' | 'unit'): string[] {
  return kind === 'part'
    ? categories.flatMap((c) => [c, categoryLabels[c]])
    : ['㎡', 'm', '式', '個']
}
