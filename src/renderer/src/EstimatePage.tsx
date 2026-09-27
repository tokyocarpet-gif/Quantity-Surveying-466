import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MaterialManager } from './MaterialManager'
import { ArrowLeft } from 'lucide-react'
import type { EstimateListItem } from '../../shared/estimate'
import { formatDecimal } from '../../shared/summary'
import { unwrap, useWorkspace } from './store'
export { EstimateEditor as EstimatePage } from './EstimateEditor'
export function EstimateListPage(): React.JSX.Element {
  const { projectId = '' } = useParams(),
    navigate = useNavigate()
  const project = useWorkspace((s) => s.data?.projects.find((p) => p.id === projectId))
  const [masterOpen, setMasterOpen] = useState(false)
  const [list, setList] = useState<EstimateListItem[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void unwrap(window.sekisan.listEstimates(projectId))
      .then((data) => {
        if (!cancelled) setList(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])
  return (
    <section className="estimate-page">
      <header className="summary-header">
        <button className="icon-button" aria-label="案件へ戻る" onClick={() => navigate('/')}>
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">保存した見積</span>
          <h1>{project?.name ?? '見積一覧'}</h1>
        </div>
        <button className="secondary" onClick={() => setMasterOpen(true)}>
          マスタ
        </button>
        <button className="primary" onClick={() => navigate(`/summary/${projectId}`)}>
          集計から見積を作成
        </button>
      </header>
      <main className="estimate-content">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p>読み込み中…</p>
        ) : list.length ? (
          <div className="estimate-list">
            {list.map((e) => (
              <button
                className="estimate-card"
                key={e.id}
                onClick={() => navigate(`/estimate/${e.id}`)}
              >
                <strong>{e.title}</strong>
                <span>
                  {e.number} · 第{e.revision}版
                </span>
                <b>{e.total === null ? '単価未設定' : `${formatDecimal(e.total)}円`}</b>
                <small>保存 {new Date(e.updatedAt).toLocaleString('ja-JP')}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="panel-empty">
            <h2>保存した見積はありません</h2>
            <p>数量集計で対象を絞り込み、「この集計から見積を作成」を押してください。</p>
          </div>
        )}
      </main>
      {masterOpen && <MaterialManager projectId={projectId} close={() => setMasterOpen(false)} />}
    </section>
  )
}
