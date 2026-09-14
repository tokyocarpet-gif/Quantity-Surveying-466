import { create } from 'zustand'
import type { Result, Selection, Workspace } from '../../shared/api'
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}
interface State {
  data: Workspace | null
  selection: Selection
  error: string | null
  refresh(): Promise<void>
  select(selection: Selection): Promise<void>
}
export const useWorkspace = create<State>((set) => ({
  data: null,
  selection: { clientId: null, projectId: null },
  error: null,
  refresh: async () => {
    const data = await unwrap(window.sekisan.workspace())
    set({ data, selection: data.selection, error: null })
  },
  select: async (selection) => {
    await unwrap(window.sekisan.saveSelection(selection))
    set({ selection })
  }
}))
