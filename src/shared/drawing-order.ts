import { z } from 'zod'
import { idSchema } from './validation'

export const drawingIdsSchema = z
  .array(idSchema)
  .max(10000)
  .refine((ids) => new Set(ids).size === ids.length, '図面の指定が重複しています。')
export const reorderDrawingsSchema = z
  .object({
    projectId: idSchema,
    expectedIds: drawingIdsSchema,
    drawingIds: drawingIdsSchema
  })
  .strict()
export type ReorderDrawings = z.infer<typeof reorderDrawingsSchema>
export const drawingOrderKey = (projectId: string): string => `drawingOrder:${projectId}`
