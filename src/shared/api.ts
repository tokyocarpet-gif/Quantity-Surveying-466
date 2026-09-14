import type { LayoutPdfRequest } from './layout-pdf'
import type { LayoutDoc, LayoutSave } from './layout'
import type { PdfPreview } from './pdf'
import type { Company, AddCatalogOption } from './business'
import type {
  EstimatePdfRequest,
  EstimateDoc,
  EstimateRead,
  EstimateSave,
  EstimateListItem
} from './estimate'
import type { SummaryRequest, SummaryReport, SummaryExport, SummaryEdit } from './summary'
import type { MaterialContext, MaterialChange } from './materials'
import type { PageState, TakeoffMutation, TakeoffPreview } from './takeoff'
export type ProjectStatus = 'active' | 'completed' | 'archived'
export interface Client {
  id: string
  name: string
  createdAt: string
}
export interface Project {
  assignee: string
  id: string
  clientId: string
  name: string
  memo: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}
export interface Drawing {
  id: string
  projectId: string
  name: string
  pageCount: number
  byteSize: number
  createdAt: string
}
export interface Selection {
  clientId: string | null
  projectId: string | null
}
export interface Workspace {
  clients: Client[]
  projects: Project[]
  drawings: Drawing[]
  selection: Selection
  dataPath: string
  lastBackupAt: string | null
}
export interface ProjectInput {
  assignee?: string
  clientId: string
  name: string
  memo: string
  status: ProjectStatus
}
export interface ImportResult {
  imported: Drawing[]
  failures: { name: string; message: string }[]
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
export interface AppApi {
  readLayout(roomId: string): Promise<Result<LayoutDoc | null>>
  saveLayout(input: LayoutSave): Promise<Result<LayoutDoc>>
  previewLayoutPdf(input: LayoutPdfRequest): Promise<Result<PdfPreview>>
  previewSummaryPdf(input: SummaryExport): Promise<Result<PdfPreview>>
  previewEstimatePdf(input: EstimatePdfRequest): Promise<Result<PdfPreview>>
  saveEstimateXlsx(input: EstimatePdfRequest): Promise<Result<string | null>>
  savePdfPreview(token: string): Promise<Result<string | null>>
  closePdfPreview(token: string): Promise<Result<void>>
  readCompany(): Promise<Result<Company>>
  saveCompany(input: Company): Promise<Result<Company>>
  addCatalogOption(input: AddCatalogOption): Promise<Result<void>>
  createEstimate(input: SummaryExport): Promise<Result<EstimateDoc>>
  readEstimate(input: EstimateRead): Promise<Result<EstimateDoc>>
  saveEstimate(input: EstimateSave): Promise<Result<EstimateDoc>>
  listEstimates(projectId: string): Promise<Result<EstimateListItem[]>>
  editSummary(input: SummaryEdit): Promise<Result<SummaryReport>>
  readSummary(request: SummaryRequest): Promise<Result<SummaryReport>>
  exportSummary(input: SummaryExport): Promise<Result<string | null>>
  readMaterials(projectId: string | null): Promise<Result<MaterialContext>>
  changeMaterials(change: MaterialChange): Promise<Result<void>>
  readTakeoff(address: { drawingId: string; pageNumber: number }): Promise<Result<PageState>>
  previewTakeoff(input: TakeoffMutation): Promise<Result<TakeoffPreview>>
  applyTakeoff(input: TakeoffMutation): Promise<Result<PageState>>
  workspace(): Promise<Result<Workspace>>
  saveSelection(value: Selection): Promise<Result<void>>
  createClient(name: string): Promise<Result<Client>>
  renameClient(id: string, name: string): Promise<Result<void>>
  deleteClient(id: string): Promise<Result<boolean>>
  createProject(input: ProjectInput): Promise<Result<Project>>
  updateProject(id: string, input: ProjectInput): Promise<Result<void>>
  deleteProject(id: string): Promise<Result<boolean>>
  importPdfs(projectId: string): Promise<Result<ImportResult | null>>
  readPdf(id: string): Promise<Result<Uint8Array>>
  renameDrawing(id: string, name: string): Promise<Result<void>>
  deleteDrawing(id: string): Promise<Result<boolean>>
  createBackup(): Promise<Result<string | null>>
  restoreBackup(): Promise<Result<string | null>>
  openDataFolder(): Promise<Result<void>>
}
declare global {
  interface Window {
    sekisan: AppApi
  }
}
