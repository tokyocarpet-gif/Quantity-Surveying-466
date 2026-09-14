import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
  Route,
  Routes
} from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { Client, Project, ProjectInput, ProjectStatus } from '../../shared/api'
import { useWorkspace, unwrap } from './store'
import { CompanyDialog } from './CompanyDialog'
import { MaterialManager } from './MaterialManager'
import { EstimatePage, EstimateListPage } from './EstimatePage'
import { SummaryPage } from './SummaryPage'
import { PdfViewer } from './PdfViewer'

const statusLabels: Record<ProjectStatus, string> = {
  active: '進行中',
  completed: '完了',
  archived: '保管'
}
const date = (value: string): string =>
  new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(value)
  )
const bytes = (size: number): string =>
  size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
type ModalState =
  | { type: 'client'; client?: Client }
  | { type: 'project'; project?: Project }
  | { type: 'drawing'; id: string; name: string }
  | { type: 'settings' }
  | null

function Modal({
  title,
  children,
  onClose,
  busy
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="閉じる" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

export function App(): React.JSX.Element {
  const { data, selection, refresh, select } = useWorkspace()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<ModalState>(null)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [masterProject, setMasterProject] = useState<{ id: string | null } | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const navigate = useNavigate()
  useEffect(() => {
    void refresh().catch((e) => setError(e.message))
  }, [refresh])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 8000)
    return () => clearTimeout(timer)
  }, [notice])
  async function run(operation: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました。')
    } finally {
      setBusy(false)
    }
  }
  async function choose(clientId: string | null, projectId: string | null = null): Promise<void> {
    await select({ clientId, projectId })
    setSearch('')
    navigate('/')
  }
  function closeModal(): void {
    setModal(null)
    setError('')
  }
  const client = data?.clients.find((c) => c.id === selection.clientId)
  const project = data?.projects.find((p) => p.id === selection.projectId)
  const projectClient = data?.clients.find((c) => c.id === project?.clientId)
  const projects =
    data?.projects.filter(
      (p) =>
        (!selection.clientId || p.clientId === selection.clientId) &&
        (status === 'all' || p.status === status) &&
        `${p.name} ${p.memo} ${p.assignee} ${data.clients.find((c) => c.id === p.clientId)?.name}`
          .toLowerCase()
          .includes(search.toLowerCase())
    ) ?? []
  const drawings =
    data?.drawings.filter(
      (d) => d.projectId === project?.id && d.name.toLowerCase().includes(search.toLowerCase())
    ) ?? []

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    await run(async () => {
      if (modal?.type === 'client') {
        const name = String(values.get('name') ?? '')
        if (modal.client) await unwrap(window.sekisan.renameClient(modal.client.id, name))
        else {
          const created = await unwrap(window.sekisan.createClient(name))
          await choose(created.id)
        }
      } else if (modal?.type === 'project') {
        const input: ProjectInput = {
          name: String(values.get('name') ?? ''),
          clientId: String(values.get('clientId') ?? ''),
          memo: String(values.get('memo') ?? ''),
          assignee: String(values.get('assignee') ?? ''),
          status: String(values.get('status') ?? 'active') as ProjectStatus
        }
        if (modal.project) {
          await unwrap(window.sekisan.updateProject(modal.project.id, input))
          await choose(input.clientId, modal.project.id)
        } else {
          const created = await unwrap(window.sekisan.createProject(input))
          await choose(created.clientId, created.id)
        }
      } else if (modal?.type === 'drawing')
        await unwrap(window.sekisan.renameDrawing(modal.id, String(values.get('name') ?? '')))
      await refresh()
      setModal(null)
      setNotice('保存しました')
    })
  }
  async function importPdf(): Promise<void> {
    if (!project) return
    await run(async () => {
      const result = await unwrap(window.sekisan.importPdfs(project.id))
      if (!result) return
      await refresh()
      if (result.imported.length) setNotice(`${result.imported.length}件の図面を取り込みました`)
      if (result.failures.length)
        setError(result.failures.map((f) => `${f.name}：${f.message}`).join('\n'))
    })
  }
  async function deleteCurrent(kind: 'client' | 'project' | 'drawing', id: string): Promise<void> {
    await run(async () => {
      const removed = await unwrap(
        kind === 'client'
          ? window.sekisan.deleteClient(id)
          : kind === 'project'
            ? window.sekisan.deleteProject(id)
            : window.sekisan.deleteDrawing(id)
      )
      if (removed) {
        await refresh()
        setNotice('削除しました')
      }
    })
  }
  if (!data)
    return (
      <main className="startup">
        <div className="brand-symbol">
          <LayoutGrid />
        </div>
        <h1>積算管理</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => void run(refresh)}>
              再試行
            </button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={18} /> ワークスペースを開いています…
          </p>
        )}
      </main>
    )

  const home = (
    <>
      <div className="page-top">
        <div>
          <div className="eyebrow">{project ? 'PROJECT / 図面管理' : 'WORKSPACE / 案件管理'}</div>
          <h1>
            {project ? project.name : client ? client.name : 'すべての案件'}
            {project && (
              <span className={`badge ${project.status}`}>{statusLabels[project.status]}</span>
            )}
          </h1>
          <p>
            {project
              ? `${projectClient?.name ?? ''}${project.assignee ? `　／　担当：${project.assignee}` : ''}　／　更新 ${date(project.updatedAt)}`
              : '案件と図面を整理して、積算の準備をはじめましょう。'}
          </p>
        </div>
        <div className="actions">
          {project ? (
            <>
              <button className="secondary" onClick={() => navigate(`/estimates/${project.id}`)}>
                見積一覧
              </button>
              <button className="secondary" onClick={() => navigate(`/summary/${project.id}`)}>
                数量集計
              </button>
              <button className="secondary" onClick={() => setMasterProject({ id: project.id })}>
                仕上げ材マスタ
              </button>
              <button className="secondary" onClick={() => setModal({ type: 'project', project })}>
                <Pencil size={16} />
                案件を編集
              </button>
              <button className="primary" disabled={busy} onClick={() => void importPdf()}>
                <Plus size={18} />
                図面を取り込む
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                setModal(data.clients.length ? { type: 'project' } : { type: 'client' })
              }
            >
              <Plus size={18} />
              {data.clients.length ? '案件を作成' : '顧客を登録'}
            </button>
          )}
        </div>
      </div>
      {!project && (
        <div className="summary">
          <div>
            <span className="summary-icon">
              <Folder size={20} />
            </span>
            <div>
              <span>案件数</span>
              <strong>
                {
                  data.projects.filter(
                    (p) => !selection.clientId || p.clientId === selection.clientId
                  ).length
                }
                <small>件</small>
              </strong>
            </div>
          </div>
          <div>
            <span className="summary-icon green">
              <FolderOpen size={20} />
            </span>
            <div>
              <span>進行中</span>
              <strong>
                {
                  data.projects.filter(
                    (p) =>
                      p.status === 'active' &&
                      (!selection.clientId || p.clientId === selection.clientId)
                  ).length
                }
                <small>件</small>
              </strong>
            </div>
          </div>
          <div>
            <span className="summary-icon">
              <FileText size={20} />
            </span>
            <div>
              <span>登録図面</span>
              <strong>
                {
                  data.drawings.filter(
                    (d) =>
                      !selection.clientId ||
                      data.projects.some(
                        (p) => p.id === d.projectId && p.clientId === selection.clientId
                      )
                  ).length
                }
                <small>枚</small>
              </strong>
            </div>
          </div>
        </div>
      )}
      {project?.memo && (
        <div className="project-memo">
          <span>案件メモ</span>
          <p>{project.memo}</p>
        </div>
      )}
      <section className="collection">
        <div className="collection-toolbar">
          <div className="section-title">
            {project ? '登録図面' : '案件一覧'}
            <span className="count">{project ? drawings.length : projects.length}</span>
          </div>
          <div className="actions">
            <div className="search">
              <Search size={17} />
              <input
                aria-label={project ? '図面を検索' : '案件を検索'}
                placeholder={project ? '図面名で検索' : '案件名・顧客名で検索'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="検索をクリア"
                  onClick={() => setSearch('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {!project && (
              <select
                aria-label="案件の状態で絞り込み"
                className="status-filter"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">すべての状態</option>
                <option value="active">進行中</option>
                <option value="completed">完了</option>
                <option value="archived">保管</option>
              </select>
            )}
          </div>
        </div>
        {project ? (
          drawings.length ? (
            <div className="drawing-grid">
              {drawings.map((drawing) => (
                <article className="drawing-card" key={drawing.id}>
                  <button
                    className="drawing-preview"
                    onClick={() => navigate(`/drawing/${drawing.id}`)}
                  >
                    <div className="paper-icon">
                      <FileText size={45} strokeWidth={1.2} />
                      <span>PDF</span>
                    </div>
                    <span className="preview-open">
                      図面を開く <ArrowUpRight size={15} />
                    </span>
                    <span className="pages">{drawing.pageCount}ページ</span>
                  </button>
                  <div className="drawing-info">
                    <button
                      className="drawing-name"
                      title={drawing.name}
                      onClick={() => navigate(`/drawing/${drawing.id}`)}
                    >
                      {drawing.name}
                    </button>
                    <div className="drawing-meta">
                      <span>
                        {bytes(drawing.byteSize)} · {date(drawing.createdAt)}
                      </span>
                      <details className="menu">
                        <summary aria-label={`${drawing.name}の操作`}>
                          <MoreHorizontal size={18} />
                        </summary>
                        <div className="menu-pop">
                          <button
                            onClick={() =>
                              setModal({ type: 'drawing', id: drawing.id, name: drawing.name })
                            }
                          >
                            <Pencil size={14} />
                            名前を変更
                          </button>
                          <button
                            className="danger-text"
                            disabled={busy}
                            onClick={() => void deleteCurrent('drawing', drawing.id)}
                          >
                            <Trash2 size={14} />
                            削除
                          </button>
                        </div>
                      </details>
                    </div>
                    <div className="drawing-work-actions">
                      <button
                        className="secondary"
                        aria-label={`${drawing.name}の拾い出し`}
                        onClick={() => navigate(`/drawing/${drawing.id}`)}
                      >
                        <Pencil size={15} />
                        拾い出し
                      </button>
                      <button
                        className="primary"
                        aria-label={`${drawing.name}の割り付け`}
                        onClick={() => navigate(`/layout/${drawing.id}`)}
                      >
                        <LayoutGrid size={15} />
                        割り付け
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty drawing-empty">
              <div className="empty-illustration">
                <FileText size={39} strokeWidth={1.2} />
                <span>
                  <Plus size={17} />
                </span>
              </div>
              <h2>{search ? '一致する図面がありません' : 'この案件の図面を追加しましょう'}</h2>
              <p>
                {search
                  ? '別の図面名で検索してください。'
                  : 'PDF図面を取り込むと、ここに一覧で表示されます。\n複数ファイル・複数ページのPDFに対応しています。'}
              </p>
              {!search && (
                <button className="secondary" disabled={busy} onClick={() => void importPdf()}>
                  <Upload size={17} />
                  PDFを選択
                </button>
              )}
              <small>PDF形式 · 1ファイル150MBまで</small>
            </div>
          )
        ) : projects.length ? (
          <div className="project-table">
            <div className="table-head">
              <span>案件名 / 顧客</span>
              <span>状態</span>
              <span>図面</span>
              <span>更新日</span>
              <span />
            </div>
            {projects.map((item) => (
              <button
                className="project-row"
                key={item.id}
                onClick={() => void run(() => choose(item.clientId, item.id))}
              >
                <span className="project-label">
                  <span className="folder-icon">
                    <Folder size={22} strokeWidth={1.5} />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {data.clients.find((c) => c.id === item.clientId)?.name}
                      {item.assignee ? ` ／ 担当：${item.assignee}` : ''}
                    </small>
                  </span>
                </span>
                <span>
                  <span className={`badge ${item.status}`}>{statusLabels[item.status]}</span>
                </span>
                <span className="muted">
                  {data.drawings.filter((d) => d.projectId === item.id).length} 枚
                </span>
                <span className="muted">{date(item.updatedAt)}</span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-illustration">
              <FolderOpen size={39} strokeWidth={1.2} />
              <span>
                <Plus size={17} />
              </span>
            </div>
            <h2>
              {search || status !== 'all'
                ? '条件に一致する案件がありません'
                : '最初の案件を作成しましょう'}
            </h2>
            <p>
              {search || status !== 'all'
                ? '検索条件や状態を変更してください。'
                : data.clients.length
                  ? '顧客に紐づく案件を作成して、図面をまとめて管理できます。'
                  : 'まずは顧客を登録し、工事ごとに案件を作成します。'}
            </p>
            {!search && status === 'all' && (
              <button
                className="secondary"
                onClick={() =>
                  setModal(data.clients.length ? { type: 'project' } : { type: 'client' })
                }
              >
                <Plus size={17} />
                {data.clients.length ? '案件を作成' : '顧客を登録'}
              </button>
            )}
          </div>
        )}
      </section>
      <footer className="page-footer">
        <span>
          <ShieldCheck size={15} />
          データはこの端末に保存されます
        </span>
        {project ? (
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={() => void deleteCurrent('project', project.id)}
          >
            案件を削除
          </button>
        ) : (
          client && (
            <div className="actions">
              <button className="text-button" onClick={() => setModal({ type: 'client', client })}>
                顧客名を変更
              </button>
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => void deleteCurrent('client', client.id)}
              >
                顧客を削除
              </button>
            </div>
          )
        )}
      </footer>
    </>
  )

  return (
    <div className="app-shell" aria-busy={busy}>
      <aside className="sidebar">
        <button className="brand" onClick={() => void run(() => choose(null))}>
          <span className="brand-symbol">
            <LayoutGrid size={23} />
          </span>
          <span>
            積算管理<small>SEKISAN KANRI</small>
          </span>
        </button>
        <div className="workspace-label">ワークスペース</div>
        <button
          className={`nav-item ${!selection.clientId ? 'selected' : ''}`}
          disabled={busy}
          onClick={() => void run(() => choose(null))}
        >
          <LayoutGrid size={18} />
          <span>すべての案件</span>
          <span className="nav-count">{data.projects.length}</span>
        </button>
        <div className="sidebar-section">
          <span>顧客</span>
          <button
            className="icon-button"
            aria-label="顧客を追加"
            disabled={busy}
            onClick={() => setModal({ type: 'client' })}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="client-list">
          {data.clients.map((item) => (
            <button
              className={`nav-item ${selection.clientId === item.id ? 'selected' : ''}`}
              key={item.id}
              disabled={busy}
              onClick={() => void run(() => choose(item.id))}
            >
              <Building2 size={17} />
              <span>{item.name}</span>
              <span className="nav-count">
                {data.projects.filter((p) => p.clientId === item.id).length}
              </span>
            </button>
          ))}
          {!data.clients.length && (
            <div className="sidebar-empty">
              顧客を登録すると
              <br />
              ここに表示されます。
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="backup-tip">
            <HardDrive size={19} />
            <strong>大切なデータを手元に</strong>
            <p>
              図面と案件をまとめて
              <br />
              バックアップできます。
            </p>
            <button onClick={() => setModal({ type: 'settings' })}>
              バックアップを管理 <ChevronRight size={14} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setModal({ type: 'settings' })}>
            <Settings2 size={18} />
            <span>設定・データ管理</span>
          </button>
          <span className="version">
            積算管理 <span>v0.11.2</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <nav aria-label="パンくず">
            <button disabled={busy} onClick={() => void run(() => choose(null))}>
              ワークスペース
            </button>
            {client && (
              <>
                <ChevronRight size={13} />
                <button disabled={busy} onClick={() => void run(() => choose(client.id))}>
                  {client.name}
                </button>
              </>
            )}
            {project && (
              <>
                <ChevronRight size={13} />
                <span>{project.name}</span>
              </>
            )}
          </nav>
          <span className={`save-state ${busy ? 'saving' : ''}`}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <span className="status-dot" />}
            {busy ? '処理中…' : 'ローカル保存'}
          </span>
        </header>
        {error && !modal && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="エラーを閉じる"
              onClick={() => setError('')}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<main className="page">{home}</main>} />
          <Route path="/drawing/:id" element={<DrawingRoute />} />
          <Route path="/layout/:id" element={<DrawingRoute mode="layout" />} />
          <Route path="/estimate/:id" element={<EstimatePage />} />
          <Route path="/estimates/:projectId" element={<EstimateListPage />} />
          <Route path="/summary/:projectId" element={<SummaryPage />} />
          <Route
            path="*"
            element={
              <main className="empty">
                <h1>画面が見つかりません</h1>
                <button className="secondary" onClick={() => navigate('/')}>
                  案件一覧へ
                </button>
              </main>
            }
          />
        </Routes>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button className="icon-button" aria-label="通知を閉じる" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {companyOpen && <CompanyDialog close={() => setCompanyOpen(false)} />}
      {masterProject && (
        <MaterialManager projectId={masterProject.id} close={() => setMasterProject(null)} />
      )}
      {modal && (
        <Modal
          title={
            modal.type === 'client'
              ? modal.client
                ? '顧客名を変更'
                : '顧客を登録'
              : modal.type === 'project'
                ? modal.project
                  ? '案件を編集'
                  : '案件を作成'
                : modal.type === 'drawing'
                  ? '図面名を変更'
                  : '設定・データ管理'
          }
          busy={busy}
          onClose={closeModal}
        >
          {modal.type === 'settings' ? (
            <div className="settings-body">
              <button
                className="secondary wide"
                onClick={() => {
                  setModal(null)
                  setCompanyOpen(true)
                }}
              >
                自社情報を登録・編集
              </button>
              <button
                className="secondary wide"
                onClick={() => {
                  setModal(null)
                  setMasterProject({ id: null })
                }}
              >
                共通の仕上げ材マスタ
              </button>
              <div className="settings-intro">
                <ShieldCheck size={25} />
                <div>
                  <h3>バックアップと復元</h3>
                  <p>顧客・案件・図面・拾い数量・仕上げ材マスタ・設定を保存します。</p>
                </div>
              </div>
              <div className="backup-row">
                <div>
                  <strong>バックアップを保存</strong>
                  <p>
                    {data.lastBackupAt
                      ? `最終保存：${date(data.lastBackupAt)}`
                      : 'バックアップはまだ作成されていません'}
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const path = await unwrap(window.sekisan.createBackup())
                      if (path) {
                        await refresh()
                        setNotice('バックアップを保存しました')
                      }
                    })
                  }
                >
                  <ArrowDownToLine size={17} />
                  保存
                </button>
              </div>
              <div className="backup-row">
                <div>
                  <strong>バックアップから復元</strong>
                  <p>現在のデータを退避してから置き換えます。</p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const path = await unwrap(window.sekisan.restoreBackup())
                      if (path) {
                        await refresh()
                        setSearch('')
                        navigate('/')
                        setNotice('バックアップを復元しました。復元前のデータは退避済みです。')
                      }
                    })
                  }
                >
                  <ArrowUpFromLine size={17} />
                  復元
                </button>
              </div>
              <small className="backup-limit">バックアップ上限：圧縮後256MB / 展開後512MB</small>
              <div className="storage-location">
                <h3>データの保存先</h3>
                <p>{data.dataPath}</p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await unwrap(window.sekisan.openDataFolder())
                    })
                  }
                >
                  <FolderOpen size={16} />
                  保存先フォルダーを開く
                </button>
              </div>
              <div className="stage-note">
                <strong>現在利用できる機能</strong>
                <p>
                  顧客・案件管理、PDF拾い出し・個数拾い、仕上げ材マスタ、自社情報、物件集計・CSV保存、見積編集・版履歴・PDF／Excel出力、バックアップ・復元。床材の割り付け（芯割り・芯跨ぎ・壁寄せ）にも対応しています。CADは今後の開発段階で追加します。
                </p>
              </div>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              {busy && (
                <p role="status" className="muted">
                  処理しています。アプリを閉じずにお待ちください。
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <div className="form-body">
                {modal.type === 'project' && (
                  <label>
                    顧客
                    <select
                      aria-label="顧客"
                      name="clientId"
                      defaultValue={
                        modal.project?.clientId ?? selection.clientId ?? data.clients[0]?.id
                      }
                      required
                    >
                      {data.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {modal.type === 'client'
                    ? '顧客名'
                    : modal.type === 'project'
                      ? '案件名'
                      : '図面名'}
                  <span className="required">必須</span>
                  <input
                    name="name"
                    maxLength={120}
                    required
                    autoFocus
                    defaultValue={
                      modal.type === 'client'
                        ? modal.client?.name
                        : modal.type === 'project'
                          ? modal.project?.name
                          : modal.name
                    }
                    placeholder={
                      modal.type === 'client'
                        ? '例：株式会社 山田建設'
                        : modal.type === 'project'
                          ? '例：本社ビル 3階 内装改修工事'
                          : ''
                    }
                  />
                </label>
                {modal.type === 'project' && (
                  <>
                    <label>
                      担当者<span className="optional">任意</span>
                      <input
                        aria-label="案件の担当者"
                        name="assignee"
                        maxLength={100}
                        defaultValue={modal.project?.assignee ?? ''}
                        placeholder="例：山田 太郎"
                      />
                    </label>
                    <label>
                      状態
                      <select
                        aria-label="状態"
                        name="status"
                        defaultValue={modal.project?.status ?? 'active'}
                      >
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      案件メモ<span className="optional">任意</span>
                      <textarea
                        name="memo"
                        rows={4}
                        maxLength={5000}
                        defaultValue={modal.project?.memo}
                        placeholder="施工場所や工期など、案件の情報を記録できます"
                      />
                    </label>
                  </>
                )}
                {error && (
                  <div className="form-error" role="alert">
                    {error}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="secondary" disabled={busy} onClick={closeModal}>
                  キャンセル
                </button>
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                  {busy ? '保存中…' : '保存する'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}

function DrawingRoute({ mode = 'takeoff' }: { mode?: 'takeoff' | 'layout' }): React.JSX.Element {
  const { id } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const drawing = useWorkspace((state) => state.data?.drawings.find((d) => d.id === id))
  const navigate = useNavigate()
  if (!drawing)
    return (
      <main className="empty">
        <h2>図面が見つかりません</h2>
        <button className="secondary" onClick={() => navigate('/')}>
          案件一覧へ
        </button>
      </main>
    )
  const page = Number(params.get('page') ?? 1)
  const returnTo = location.state?.summaryReturnTo
  return (
    <PdfViewer
      key={`${mode}:${drawing.id}`}
      mode={mode}
      drawing={drawing}
      initialPage={Number.isInteger(page) && page >= 1 && page <= drawing.pageCount ? page : 1}
      initialRoomId={params.get('room')}
      backLabel={
        typeof returnTo === 'string' && returnTo.split('?')[0] === `/summary/${drawing.projectId}`
          ? '集計に戻る'
          : '図面一覧に戻る'
      }
      back={() =>
        navigate(
          typeof returnTo === 'string' && returnTo.split('?')[0] === `/summary/${drawing.projectId}`
            ? returnTo
            : '/'
        )
      }
    />
  )
}
