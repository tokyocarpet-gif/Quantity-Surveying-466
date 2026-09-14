import { z } from 'zod'
z.config(z.locales.ja())
export const idSchema = z.string().uuid()
export const nameSchema = z
  .string()
  .trim()
  .min(1, '名前を入力してください。')
  .max(120, '名前は120文字以内で入力してください。')
export const projectSchema = z
  .object({
    clientId: idSchema,
    assignee: z.string().trim().max(100, '担当者は100文字以内で入力してください。').default(''),
    name: nameSchema,
    memo: z.string().max(5000, 'メモは5000文字以内で入力してください。'),
    status: z.enum(['active', 'completed', 'archived'])
  })
  .strict()
export const selectionSchema = z
  .object({ clientId: idSchema.nullable(), projectId: idSchema.nullable() })
  .strict()
