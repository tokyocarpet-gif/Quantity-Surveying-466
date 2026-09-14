import { z } from 'zod'
export const companySchema = z
  .object({
    name: z.string().trim().max(120),
    postalCode: z.string().trim().max(20),
    address: z.string().trim().max(300),
    phone: z.string().trim().max(40),
    fax: z.string().trim().max(40),
    email: z.string().trim().max(120),
    contact: z.string().trim().max(100),
    registrationNumber: z.string().trim().max(40),
    estimateValidity: z.string().trim().max(200).default(''),
    paymentTerms: z.string().trim().max(500).default(''),
    otherConditions: z.string().trim().max(1000).default('')
  })
  .strict()
export type Company = z.infer<typeof companySchema>
export const emptyCompany = (): Company => ({
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
export function companyIssuer(c: Company): string {
  return [
    c.name,
    c.postalCode ? `〒${c.postalCode}` : '',
    c.address,
    c.phone ? `TEL ${c.phone}` : '',
    c.fax ? `FAX ${c.fax}` : '',
    c.email,
    c.contact ? `担当 ${c.contact}` : '',
    c.registrationNumber ? `登録番号 ${c.registrationNumber}` : ''
  ]
    .filter(Boolean)
    .join('\n')
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
