import { ZodError } from 'zod'

/** Show a validation issue, not ZodError.message's JSON representation. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? fallback
  return error instanceof Error ? error.message : fallback
}
