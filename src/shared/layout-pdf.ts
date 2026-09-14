import { z } from 'zod'
import { layoutSaveSchema } from './layout'
export const layoutPdfSchema = layoutSaveSchema
  .extend({
    diagram: z
      .string()
      .max(16 * 1024 * 1024)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  })
  .strict()
export type LayoutPdfRequest = z.infer<typeof layoutPdfSchema>
