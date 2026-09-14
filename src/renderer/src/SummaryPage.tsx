import { SummaryPdfDialog } from './EstimatePdfDialog'
import { partLabel } from '../../shared/materials'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, RefreshCw, ChevronRight } from 'lucide-react'
import { categories, categoryLabels } from '../../shared/takeoff'
import {
  summaryRequestSchema,
  summaryViews,
  summaryViewLabels,
  summaryCalculationNote,
  formatDecimal,
  formatQuantity,
  summaryScope,
  type SummaryReport,
  type SummaryExport,
  type SummaryRequest,
  type SummaryRow
} from '../../shared/summary'
import { unwrap } from './store'
import { SummaryEditDialog } from './SummaryEditDialog'
import { TakeoffDialog } from './takeoff/Dialogs'
export function SummaryPage(): React.JSX.Element {
  const { projectId = '' } = useParams(),
    navigate = useNavigate(),
    location = useLocation()
  const [params, setParams] = useSearchParams()
  const [report, setReport] = useState<SummaryReport | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0),
    [detail, setDetail] = useState<SummaryRow | null>(null),
    [exporting, setExporting] = useState(false)
  const [pdfRequest, setPdfRequest] = useState<SummaryExport | null>(null)
  const [editing, setEditing] = useState<SummaryRow | null>(null)
  const request = useMemo(
    () =>
      summaryRequestSchema.safeParse({
        projectId,
        view: params.get('view') ?? 'room-finish',
        drawingId: params.get('drawingId'),
        pageNumber: params.has('pageNumber') ? Number(params.get('pageNumber')) : null,
        groupId: params.get('groupId'),
        category: params.get('category'),
        query: params.get('query') ?? '',
        issue: params.get('issue') ?? 'all'
      }),
    [projectId, params]
  )
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError('')
    setDetail(null)
    setNotice('')
    if (!request.success) {
      setError('集計条件を確認してください。条件を解除すると物件全体を表示します。')
      setBusy(false)
      return
    }
    const timer = setTimeout(() => {
      void unwrap(window.sekisan.readSummary(request.data))
        .then((data) => {
          if (!cancelled) setReport(data)
        })
        .catch((e) => {
          if (!cancelled) setError(e.message)
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request, refresh])
  const set = (updates: Partial<SummaryRequest>): void => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next, { replace: true })
  }
  const current = request.success ? request.data : null
  const matches =
    !!report && !!current && JSON.stringify(report.request) === JSON.stringify(current)
  async function exportCsv(): Promise<void> {
    if (!report || !matches || busy) return
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const path = await unwrap(
        window.sekisan.exportSummary({ request: report.request, fingerprint: report.fingerprint })
      )
      if (path) setNotice(`CSVを保存しました：${path}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSVを保存できませんでした。')
    } finally {
      setExporting(false)
    }
  }
  async function createEstimate(): Promise<void> {
    if (!report || busy || exporting || !matches) return
    setExporting(true)
    setError('')
    try {
      const doc = await unwrap(
        window.sekisan.createEstimate({ request: report.request, fingerprint: report.fingerprint })
      )
      navigate(`/estimate/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '見積を作成できませんでした。')
    } finally {
      setExporting(false)
    }
  }
  const rows = report?.rows ?? []
  const disabled = busy || exporting
  return (
    <section className="summary-page" aria-busy={disabled}>
      <header className="summary-header">
        <button
          className="icon-button"
          aria-label="物件の図面一覧に戻る"
          disabled={exporting}
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={21} />
        </button>
        <div>
          <span className="eyebrow">QUANTITY / 物件集計</span>
          <h1>{report?.projectName ?? '数量集計'}</h1>
          <p>{report?.clientName} · 保存済みの拾い数量を集計</p>
        </div>
        <div className="summary-actions">
          <button
            className="secondary"
            disabled={disabled || !matches || !rows.length || !!error}
            onClick={() => void createEstimate()}
          >
            この集計から見積を作成
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw size={15} />
            再集計
          </button>
          <button
            className="primary"
            disabled={disabled || !matches || !rows.length || !!error}
            onClick={() => void exportCsv()}
          >
            <Download size={16} />
            表示中の集計をCSV保存
          </button>
        </div>
      </header>
      <div className="summary-top">
        <div className="summary-metrics" role="region" aria-label="部位別の合計" tabIndex={0}>
          {(
            report?.totals ??
            categories.map((category) => ({
              category,
              quantity: '0.000',
              unit: category === 'baseboard' ? 'm' : '㎡'
            }))
          ).map((t) => (
            <div key={`${t.category}:${t.unit}`}>
              <span>{partLabel(t.category)}</span>
              <strong
                data-testid={`summary-total-${t.category}`}
                className={t.quantity.startsWith('-') ? 'negative' : ''}
              >
                {formatQuantity(t.quantity)}
                <small> {t.unit}</small>
              </strong>
            </div>
          ))}
          <div className="summary-amount">
            <span>
              {report?.missingPriceCount ? '単価設定済み分の参考金額' : '参考金額（税別）'}
            </span>
            <strong data-testid="summary-total-amount">
              {formatDecimal(report?.knownAmount ?? '0')}
              <small> 円</small>
            </strong>
            <small>
              {report?.missingPriceCount
                ? `単価未設定 ${report.missingPriceCount}件を除く`
                : '元明細の金額を合算'}
            </small>
          </div>
        </div>
        <div className="summary-viewbar">
          <div className="summary-tabs" role="tablist" aria-label="集計の表示形式">
            {summaryViews.map((view) => (
              <button
                role="tab"
                aria-selected={current?.view === view}
                className={current?.view === view ? 'active' : ''}
                disabled={exporting}
                key={view}
                onClick={() => set({ view })}
              >
                {summaryViewLabels[view]}
              </button>
            ))}
          </div>
          <button
            className="secondary summary-pdf-button"
            disabled={disabled || !matches || !rows.length || !!error}
            onClick={() => {
              if (report)
                setPdfRequest({ request: report.request, fingerprint: report.fingerprint })
            }}
          >
            集計積算書PDF
          </button>
        </div>
        <div className="summary-filters">
          <label>
            図面
            <select
              aria-label="集計する図面"
              value={current?.drawingId ?? ''}
              disabled={exporting}
              onChange={(e) =>
                set({ drawingId: e.target.value || null, pageNumber: null, groupId: null })
              }
            >
              <option value="">すべての図面</option>
              {report?.drawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            ページ
            <select
              aria-label="集計するページ"
              value={current?.pageNumber ?? ''}
              disabled={exporting || !current?.drawingId}
              onChange={(e) =>
                set({ pageNumber: e.target.value ? Number(e.target.value) : null, groupId: null })
              }
            >
              <option value="">全ページ</option>
              {Array.from(
                {
                  length: report?.drawings.find((d) => d.id === current?.drawingId)?.pageCount ?? 0
                },
                (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}ページ
                  </option>
                )
              )}
            </select>
          </label>
          <label>
            部屋
            <select
              aria-label="集計する部屋"
              value={current?.groupId ?? ''}
              disabled={exporting}
              onChange={(e) => set({ groupId: e.target.value || null })}
            >
              <option value="">すべての部屋</option>
              {report?.rooms
                .filter(
                  (r) =>
                    (!current?.drawingId || r.drawingId === current.drawingId) &&
                    (!current?.pageNumber || r.pageNumber === current.pageNumber)
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            部位
            <select
              aria-label="集計する部位"
              value={current?.category ?? ''}
              disabled={exporting}
              onChange={(e) =>
                set({ category: (e.target.value as SummaryRequest['category']) || null })
              }
            >
              <option value="">すべての部位</option>
              {[...new Set([...categories, ...(report?.categoryOptions ?? [])])].map((c) => (
                <option key={c} value={c}>
                  {partLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            確認事項
            <select
              aria-label="確認事項で絞り込み"
              value={current?.issue ?? 'all'}
              disabled={exporting}
              onChange={(e) => set({ issue: e.target.value as SummaryRequest['issue'] })}
            >
              <option value="all">すべて</option>
              <option value="missing-price">単価未設定</option>
              <option value="negative">負の数量</option>
              <option value="missing-finish">仕上げ未設定</option>
            </select>
          </label>
          <label>
            検索
            <input
              aria-label="集計を検索"
              placeholder="部屋・仕上げ・図面"
              maxLength={120}
              value={params.get('query') ?? ''}
              disabled={exporting}
              onChange={(e) => set({ query: e.target.value })}
            />
          </label>
          <button
            className="text-button"
            disabled={exporting}
            onClick={() =>
              setParams(current?.view ? { view: current.view } : {}, { replace: true })
            }
          >
            条件を解除
          </button>
        </div>
        {report && (
          <div className="summary-scope">
            <span>{busy ? '集計中…' : summaryScope(report)}</span>
            <strong>
              {report.roomCount}部屋 · {report.lines.length}/{report.totalItemCount}明細 ·{' '}
              {rows.length}行
            </strong>
          </div>
        )}
        {!!report &&
          (report.negativeCount > 0 ||
            report.missingPriceCount > 0 ||
            report.missingFinishCount > 0) && (
            <div className="summary-issues" role="status">
              {report.negativeCount > 0 && (
                <span className="negative">負の数量 {report.negativeCount}件</span>
              )}
              {report.missingPriceCount > 0 && (
                <span>単価未設定 {report.missingPriceCount}件（0円とは区別）</span>
              )}
              {report.missingFinishCount > 0 && (
                <span>仕上げ未設定 {report.missingFinishCount}件</span>
              )}
              <span>「確認事項」で対象を絞り込めます。</span>
            </div>
          )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="summary-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <div className={`summary-table-scroll ${busy ? 'loading' : ''}`}>
        <table className="summary-table">
          <thead>
            <tr>
              <th>部屋・図面</th>
              <th>部位</th>
              <th>仕上げ</th>
              <th>元数量</th>
              <th>控除</th>
              <th>正味数量</th>
              <th>単位</th>
              <th>単価（円）</th>
              <th>参考金額（円）</th>
              <th>確認・内訳</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <Fragment key={row.id}>
                {row.section && row.sectionKey !== rows[i - 1]?.sectionKey && (
                  <tr className="summary-section">
                    <th colSpan={10}>{row.section}</th>
                  </tr>
                )}
                <tr
                  data-testid="summary-row"
                  className={current?.view === 'room-finish' ? 'summary-editable-row' : ''}
                  onClick={() => {
                    if (current?.view === 'room-finish' && !disabled && matches) setEditing(row)
                  }}
                >
                  <td>
                    <strong>{row.roomLabel}</strong>
                    <small>{row.location}</small>
                  </td>
                  <td>{partLabel(row.category)}</td>
                  <td>
                    {row.finish || <span className="muted">仕上げ未設定</span>}
                    {row.specification && <small>{row.specification}</small>}
                  </td>
                  <td>{formatQuantity(row.gross)}</td>
                  <td>{formatQuantity(row.deduction)}</td>
                  <td className={row.quantity.startsWith('-') ? 'negative' : 'summary-net'}>
                    {formatQuantity(row.quantity)}
                  </td>
                  <td>{row.unit}</td>
                  <td>
                    {row.unitPrice === null ? (
                      <span className="missing-price">未設定</span>
                    ) : (
                      formatDecimal(String(row.unitPrice))
                    )}
                  </td>
                  <td>{row.amount === null ? '—' : formatDecimal(row.amount)}</td>
                  <td>
                    <div className="summary-row-flags">
                      {row.fixedCount > 0 && <small>固定 {row.fixedCount}</small>}
                      {row.negativeCount > 0 && (
                        <small className="negative">負数 {row.negativeCount}</small>
                      )}
                    </div>
                    {current?.view === 'room-finish' && (
                      <button
                        className="text-button"
                        disabled={disabled || !matches}
                        aria-label={`${row.roomLabel}・${partLabel(row.category)}の仕上げ・単価を編集`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditing(row)
                        }}
                      >
                        仕上げ・単価を編集
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={disabled || !matches}
                      aria-label={`${row.roomLabel}・${row.finish || '仕上げ未設定'}の内訳`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDetail(row)
                      }}
                    >
                      内訳 {row.sourceIds.length}件<ChevronRight size={13} />
                    </button>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && !busy && (
          <div className="panel-empty">
            <h2>
              {report?.totalItemCount
                ? '条件に一致する数量がありません'
                : 'まだ拾い数量がありません'}
            </h2>
            <p>
              {report?.totalItemCount
                ? '絞り込み条件を変更してください。'
                : '図面で部屋を登録すると、ここに数量が表示されます。'}
            </p>
          </div>
        )}
      </div>
      <footer className="summary-footer">
        <p>{summaryCalculationNote}</p>
        <span>
          {report ? `集計日時 ${new Date(report.generatedAt).toLocaleString('ja-JP')}` : ''}
        </span>
      </footer>
      {pdfRequest && <SummaryPdfDialog request={pdfRequest} close={() => setPdfRequest(null)} />}
      {editing && report && (
        <SummaryEditDialog
          row={editing}
          report={report}
          close={() => setEditing(null)}
          saved={(updated) => {
            setReport(updated)
            setEditing(null)
            setDetail(null)
            setError('')
            setNotice('仕上げ・単価を保存し、集計を更新しました。')
          }}
        />
      )}
      {detail && report && (
        <TakeoffDialog title="集計の内訳" close={() => setDetail(null)}>
          <div className="summary-detail">
            <h3>
              {detail.finish || '仕上げ未設定'} · {partLabel(detail.category)}
            </h3>
            <p>
              集計数量 {formatQuantity(detail.quantity)} {detail.unit} / 参考金額{' '}
              {detail.amount === null ? '単価未設定' : `${formatDecimal(detail.amount)}円`}
            </p>
            <div className="summary-detail-scroll">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>元の部屋・図面</th>
                    <th>元数量</th>
                    <th>控除</th>
                    <th>正味数量</th>
                    <th>単価</th>
                    <th>金額</th>
                    <th>確認</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lines
                    .filter((l) => detail.sourceIds.includes(l.id))
                    .map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.roomName}</strong>
                          <small>
                            {l.drawingName} · {l.pageNumber}ページ
                          </small>
                        </td>
                        <td title={`保存値 ${l.rawQuantity}`}>{formatQuantity(l.gross)}</td>
                        <td title={`保存値 ${l.rawDeduction}`}>{formatQuantity(l.deduction)}</td>
                        <td
                          title={`金額計算用数量 ${l.quantity} / 保存値 ${l.rawNet}`}
                          className={l.rawNet < 0 ? 'negative' : ''}
                        >
                          {formatQuantity(l.quantity)} {l.unit}
                        </td>
                        <td>
                          {l.unitPrice === null ? '未設定' : formatDecimal(String(l.unitPrice))}
                        </td>
                        <td>{l.amount === null ? '—' : formatDecimal(l.amount)}</td>
                        <td>
                          {l.fixed && <small>数量固定</small>}
                          <button
                            className="text-button"
                            onClick={() =>
                              navigate(
                                `/drawing/${l.drawingId}?page=${l.pageNumber}${l.source === 'count' ? `&room=${l.id}` : l.roomId ? `&room=${l.roomId}` : ''}`,
                                { state: { summaryReturnTo: location.pathname + location.search } }
                              )
                            }
                          >
                            図面へ
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="panel-description">
              {summaryCalculationNote} 内訳の数量にマウスを重ねると丸め前の保存値を表示します。
            </p>
          </div>
        </TakeoffDialog>
      )}
    </section>
  )
}
