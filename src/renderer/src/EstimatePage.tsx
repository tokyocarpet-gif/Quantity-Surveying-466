import { EstimatePdfDialog } from './EstimatePdfDialog'
import { MaterialInput } from './MaterialInput'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Plus, ArrowUp, ArrowDown, Trash2, Copy } from 'lucide-react'
import {
  estimateBodySchema,
  calculateEstimate,
  roundingLabels,
  type EstimateDoc,
  type EstimateBody,
  type EstimateLine,
  type EstimateListItem,
  type Rounding
} from '../../shared/estimate'
import { formatDecimal, displayQuantity } from '../../shared/summary'
import { materialSpecification, partLabel, type MaterialContext } from '../../shared/materials'
import { categories } from '../../shared/takeoff'
import { unwrap, useWorkspace } from './store'
import { TakeoffDialog } from './takeoff/Dialogs'
export function EstimateListPage(): React.JSX.Element {
  const { projectId = '' } = useParams(),
    navigate = useNavigate()
  const project = useWorkspace((s) => s.data?.projects.find((p) => p.id === projectId))
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
    </section>
  )
}
export function EstimatePage(): React.JSX.Element {
  const { id = '' } = useParams(),
    navigate = useNavigate()
  const [doc, setDoc] = useState<EstimateDoc | null>(null),
    [body, setBody] = useState<EstimateBody | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [catalog, setCatalog] = useState<MaterialContext | null>(null)
  useEffect(() => {
    let cancelled = false
    if (doc)
      void unwrap(window.sekisan.readMaterials(doc.projectId))
        .then((data) => {
          if (!cancelled) setCatalog(data)
        })
        .catch((e) => {
          if (!cancelled)
            setError(e instanceof Error ? e.message : '物件マスタを読み込めませんでした。')
        })
    return () => {
      cancelled = true
    }
  }, [doc?.projectId])
  const [pdfOpen, setPdfOpen] = useState(false)
  const [deleteLine, setDeleteLine] = useState<EstimateLine | null>(null)
  const [discard, setDiscard] = useState<(() => void) | null>(null),
    [source, setSource] = useState(false)
  function adopt(value: EstimateDoc): void {
    setDoc(value)
    setBody(structuredClone(value.body))
    setError('')
  }
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setBody(null)
    setBusy(true)
    void unwrap(window.sekisan.readEstimate({ id }))
      .then((d) => {
        if (!cancelled) adopt(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])
  if (!doc || !body)
    return (
      <section className="estimate-page">
        <div className="panel-empty">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button className="secondary" onClick={() => navigate('/')}>
                案件一覧へ
              </button>
            </>
          ) : (
            <p>見積を読み込み中…</p>
          )}
        </div>
      </section>
    )
  const partOptions = [
    ...new Set([
      ...categories,
      ...(catalog?.parts ?? []),
      ...(catalog?.project.map((m) => m.category) ?? []),
      ...body.lines.map((l) => l.category)
    ])
  ]
  const sectionOptions = [
    ...new Set([
      ...body.lines.map((l) => l.section.trim()).filter(Boolean),
      '内装仕上工事',
      '諸経費'
    ])
  ]
  const unitOptions = [
    ...new Set([
      '㎡',
      'm',
      '式',
      '個',
      ...(catalog?.units ?? []),
      ...(catalog?.project.map((m) => m.unit) ?? []),
      ...body.lines.map((l) => l.unit)
    ])
  ]
  const historical = doc.revision !== doc.latestRevision,
    dirty = JSON.stringify(body) !== JSON.stringify(doc.body),
    locked = busy || historical
  const parsed = estimateBodySchema.safeParse(body),
    totals = parsed.success ? calculateEstimate(parsed.data) : null
  const change = (updates: Partial<EstimateBody>): void => {
    setBody({ ...body, ...updates })
    setNotice('')
  }
  const lineChange = (lineId: string, updates: Partial<EstimateLine>): void =>
    change({ lines: body.lines.map((l) => (l.id === lineId ? { ...l, ...updates } : l)) })
  const leave = (fn: () => void): void => {
    if (busy) return
    if (dirty) setDiscard(() => fn)
    else fn()
  }
  const loadVersion = async (revision: number): Promise<void> => {
    setBusy(true)
    setNotice('')
    try {
      adopt(await unwrap(window.sekisan.readEstimate({ id, revision })))
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込めませんでした。')
    } finally {
      setBusy(false)
    }
  }
  async function save(): Promise<void> {
    if (!doc || !parsed.success || busy || historical) return
    setBusy(true)
    setError('')
    try {
      const updated = await unwrap(
        window.sekisan.saveEstimate({ id, expectedRevision: doc.latestRevision, body: parsed.data })
      )
      adopt(updated)
      setNotice(`第${updated.revision}版として保存しました。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  async function saveExcel(): Promise<void> {
    if (!doc || busy || dirty) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const path = await unwrap(window.sekisan.saveEstimateXlsx({ id, revision: doc.revision }))
      if (path) setNotice(`Excel帳票を保存しました：${path}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Excel帳票を保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  const addLine = (expense = false): void =>
    change({
      lines: [
        ...body.lines,
        {
          id: crypto.randomUUID(),
          room: '',
          category: expense ? '諸経費' : 'floor',
          name: expense ? '運搬・搬入費' : '',
          specification: '',
          section: expense
            ? '諸経費'
            : ([...body.lines].reverse().find((l) => l.section.trim() !== '諸経費')?.section ?? ''),
          note: '',
          quantity: '1.0',
          unit: '式',
          unitPrice: null
        }
      ]
    })
  const move = (index: number, offset: number): void => {
    const lines = [...body.lines]
    ;[lines[index], lines[index + offset]] = [lines[index + offset], lines[index]]
    change({ lines })
  }
  const money = (n: string | null | undefined): string =>
    n == null ? '未確定' : `${formatDecimal(n)} 円`
  return (
    <section className="estimate-page" aria-busy={busy}>
      <header className="summary-header">
        <button
          className="icon-button"
          aria-label="見積一覧へ戻る"
          disabled={busy}
          onClick={() => leave(() => navigate(`/estimates/${doc.projectId}`))}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">
            見積編集 · 第{doc.revision}版{historical ? '（過去の版・閲覧のみ）' : ''}
          </span>
          <h1>{body.title || '見積書'}</h1>
          <p>
            {dirty
              ? '未保存の変更があります。帳票出力前に見積を保存してください。'
              : `保存 ${new Date(doc.savedAt).toLocaleString('ja-JP')}`}
          </p>
        </div>
        <div className="summary-actions">
          <select
            aria-label="見積の保存履歴"
            value={doc.revision}
            disabled={busy}
            onChange={(e) => {
              const revision = Number(e.target.value)
              leave(() => void loadVersion(revision))
            }}
          >
            {doc.versions.map((v) => (
              <option key={v.revision} value={v.revision}>
                第{v.revision}版 · {new Date(v.savedAt).toLocaleString('ja-JP')}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={busy || dirty}
            title={
              dirty
                ? '変更を保存するとPDFを作成できます。'
                : '表示している版をPDFで確認・保存します。'
            }
            onClick={() => setPdfOpen(true)}
          >
            PDFプレビュー
          </button>
          <button
            className="secondary"
            disabled={busy || dirty}
            title={
              dirty
                ? '変更を保存するとExcel帳票を作成できます。'
                : '表示している版をExcelの表紙・内訳明細として保存します。'
            }
            onClick={() => void saveExcel()}
          >
            Excelを保存
          </button>
          <button className="secondary" disabled={busy} onClick={() => setSource(true)}>
            作成元を確認
          </button>
          <button
            className="primary"
            disabled={locked || !dirty || !parsed.success}
            onClick={() => void save()}
          >
            <Save size={16} />
            見積を保存
          </button>
        </div>
      </header>
      <main className="estimate-content">
        {historical && (
          <p className="estimate-notice">
            過去の版を表示しています。保存履歴から最新の版を選ぶと編集できます。
          </p>
        )}
        {notice && (
          <p className="estimate-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="estimate-fields">
          <label>
            見積名
            <input
              aria-label="見積名"
              value={body.title}
              maxLength={120}
              disabled={locked}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label>
            見積番号
            <input
              aria-label="見積番号"
              value={body.number}
              maxLength={80}
              disabled={locked}
              onChange={(e) => change({ number: e.target.value })}
            />
          </label>
          <label>
            見積日
            <input
              aria-label="見積日"
              type="date"
              value={body.date}
              disabled={locked}
              onChange={(e) => change({ date: e.target.value })}
            />
          </label>
          <label>
            宛先
            <input
              aria-label="見積の宛先"
              value={body.recipient}
              maxLength={160}
              disabled={locked}
              onChange={(e) => change({ recipient: e.target.value })}
            />
          </label>
          <label>
            納期
            <input
              aria-label="見積の納期"
              value={body.delivery}
              maxLength={200}
              disabled={locked}
              placeholder="例：別途打合せの上決定"
              onChange={(e) => change({ delivery: e.target.value })}
            />
          </label>
          <label>
            発行者・連絡先
            <textarea
              aria-label="見積の発行者"
              value={body.issuer}
              maxLength={1000}
              disabled={locked}
              onChange={(e) => change({ issuer: e.target.value })}
            />
          </label>
          <label>
            有効期限・支払条件など
            <textarea
              aria-label="見積の取引条件"
              value={body.conditions}
              maxLength={2000}
              disabled={locked}
              onChange={(e) => change({ conditions: e.target.value })}
            />
          </label>
        </div>
        <div className="estimate-section-heading">
          <h2>見積明細</h2>
          <p>数量は小数1桁で採用し、表示数量×単価で金額を計算します。</p>
          <button
            className="secondary"
            disabled={locked || body.lines.length >= 2000}
            onClick={() => addLine()}
          >
            <Plus size={15} />
            明細を追加
          </button>
          <button
            className="secondary"
            disabled={locked || body.lines.length >= 2000}
            onClick={() => addLine(true)}
          >
            <Plus size={15} />
            諸経費を追加
          </button>
        </div>
        <p className="estimate-table-help">
          大項目は入力済みの候補から選ぶか、「上と同じ」で揃えられます。同じ名前の大項目は帳票でひとつにまとめ、Excelではその中を部屋名ごとに整理します。明細追加時は直前の大項目（諸経費を除く）を引き継ぎます。空欄は「内装仕上工事」として扱います。
        </p>
        <datalist id="estimate-section-options">
          {sectionOptions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <div className="estimate-table-scroll">
          <table className="estimate-table">
            <thead>
              <tr>
                <th>大項目（工事区分）</th>
                <th>部屋</th>
                <th>部位</th>
                <th>仕上げ・明細名</th>
                <th>仕様・規格</th>
                <th>数量</th>
                <th>単位</th>
                <th>単価（円）</th>
                <th>金額（円）</th>
                <th>備考</th>
                <th>並び順・削除</th>
              </tr>
            </thead>
            <tbody>
              {body.lines.map((l, i) => (
                <tr key={l.id} data-testid="estimate-row">
                  <td>
                    <div className="estimate-section-input">
                      <input
                        aria-label={`明細${i + 1}の工事区分`}
                        value={l.section}
                        maxLength={120}
                        list="estimate-section-options"
                        placeholder="内装仕上工事"
                        title={l.section || '内装仕上工事'}
                        disabled={locked}
                        onChange={(e) => lineChange(l.id, { section: e.target.value })}
                      />
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`明細${i + 1}の大項目を上と同じにする`}
                        title="上と同じ"
                        disabled={locked || i === 0}
                        onClick={() => {
                          if (i > 0) lineChange(l.id, { section: body.lines[i - 1].section.trim() })
                        }}
                      >
                        <Copy size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  <td>
                    <input
                      aria-label={`明細${i + 1}の部屋`}
                      value={l.room}
                      maxLength={120}
                      disabled={locked}
                      onChange={(e) => lineChange(l.id, { room: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`明細${i + 1}の部位`}
                      value={l.category}
                      disabled={locked}
                      onChange={(e) =>
                        lineChange(l.id, { category: e.target.value as EstimateLine['category'] })
                      }
                    >
                      {partOptions.map((c) => (
                        <option key={c} value={c}>
                          {partLabel(c)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <MaterialInput
                      label={`明細${i + 1}の名称`}
                      value={l.name}
                      materials={catalog?.project ?? []}
                      disabled={locked}
                      onChange={(name) => lineChange(l.id, { name })}
                      onSelect={(m) =>
                        lineChange(l.id, {
                          category: m.category,
                          name: m.name,
                          specification: materialSpecification(m),
                          unit: m.unit,
                          unitPrice: m.unitPrice
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`明細${i + 1}の仕様・規格`}
                      value={l.specification}
                      maxLength={400}
                      disabled={locked}
                      onChange={(e) => lineChange(l.id, { specification: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`明細${i + 1}の数量`}
                      inputMode="decimal"
                      value={l.quantity}
                      disabled={locked}
                      onChange={(e) => lineChange(l.id, { quantity: e.target.value })}
                      onBlur={(e) => {
                        const value = e.target.value.trim()
                        if (/^-?\d{1,13}(\.\d{1,12})?$/.test(value))
                          lineChange(l.id, { quantity: displayQuantity(value) })
                      }}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`明細${i + 1}の単位`}
                      value={l.unit}
                      disabled={locked}
                      onChange={(e) =>
                        lineChange(l.id, { unit: e.target.value as EstimateLine['unit'] })
                      }
                    >
                      {unitOptions.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`明細${i + 1}の単価`}
                      type="number"
                      min="0"
                      max="1000000000"
                      step="any"
                      placeholder="未設定"
                      value={l.unitPrice ?? ''}
                      disabled={locked}
                      onChange={(e) =>
                        lineChange(l.id, {
                          unitPrice: e.target.value === '' ? null : Number(e.target.value)
                        })
                      }
                    />
                  </td>
                  <td className={Number(l.quantity) < 0 ? 'estimate-negative' : ''}>
                    {totals?.amounts[i] == null ? '—' : formatDecimal(totals.amounts[i]!)}
                  </td>
                  <td>
                    <input
                      aria-label={`明細${i + 1}の備考`}
                      value={l.note}
                      maxLength={500}
                      title={l.note}
                      placeholder="施工条件など"
                      disabled={locked}
                      onChange={(e) => lineChange(l.id, { note: e.target.value })}
                    />
                  </td>
                  <td className="estimate-row-actions">
                    <button
                      aria-label={`明細${i + 1}を上へ`}
                      disabled={locked || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      aria-label={`明細${i + 1}を下へ`}
                      disabled={locked || i === body.lines.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      aria-label={`明細${i + 1}を削除`}
                      disabled={locked}
                      onClick={() => setDeleteLine(l)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!parsed.success && (
          <p className="form-error" role="alert">
            入力内容を確認してください：{parsed.error.issues[0].message}
          </p>
        )}
        {!!totals?.missingPrices && (
          <p className="estimate-notice" role="status">
            単価未設定が{totals.missingPrices}
            件あります。0円と区別し、合計金額は未確定として保存します。
          </p>
        )}
        {!!totals?.negativeLines && (
          <p className="estimate-notice">
            負の数量が{totals.negativeLines}件あります。控除や数量を確認してください。
          </p>
        )}
        <div className="estimate-bottom">
          <div className="estimate-options">
            <label>
              明細金額の端数処理
              <select
                aria-label="明細金額の端数処理"
                disabled={locked}
                value={body.amountRounding}
                onChange={(e) => change({ amountRounding: e.target.value as Rounding })}
              >
                {Object.entries(roundingLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              備考
              <textarea
                aria-label="見積の備考"
                value={body.memo}
                maxLength={4000}
                disabled={locked}
                onChange={(e) => change({ memo: e.target.value })}
              />
            </label>
          </div>
          <div className="estimate-totals">
            <p className="estimate-grand-total">
              合計<strong data-testid="estimate-total">{money(totals?.subtotal)}</strong>
            </p>
          </div>
        </div>
      </main>
      {discard && (
        <TakeoffDialog title="未保存の変更があります" close={() => setDiscard(null)}>
          <div className="summary-edit-form">
            <p>入力中の変更を破棄して移動しますか？保存済みの見積は残ります。</p>
            <div className="summary-edit-actions">
              <button className="secondary" onClick={() => setDiscard(null)}>
                編集を続ける
              </button>
              <button
                className="primary"
                onClick={() => {
                  const action = discard
                  setDiscard(null)
                  action()
                }}
              >
                破棄して移動
              </button>
            </div>
          </div>
        </TakeoffDialog>
      )}
      {deleteLine && (
        <TakeoffDialog
          title="見積明細を削除しますか？"
          close={() => setDeleteLine(null)}
          busy={busy}
        >
          <div className="summary-edit-form">
            <p>
              「{deleteLine.room ? deleteLine.room + ' · ' : ''}
              {deleteLine.name || '名称未入力'}」の明細を削除します。
            </p>
            <p>
              {deleteLine.specification ? deleteLine.specification + ' · ' : ''}
              {deleteLine.quantity} {deleteLine.unit}
            </p>
            <p>変更は見積を保存すると確定します。</p>
            <div className="summary-edit-actions">
              <button className="secondary" onClick={() => setDeleteLine(null)}>
                キャンセル
              </button>
              <button
                className="primary"
                disabled={locked}
                onClick={() => {
                  change({ lines: body.lines.filter((l) => l.id !== deleteLine.id) })
                  setDeleteLine(null)
                }}
              >
                この明細を削除
              </button>
            </div>
          </div>
        </TakeoffDialog>
      )}
      {pdfOpen && (
        <EstimatePdfDialog
          request={{ id: doc.id, revision: doc.revision }}
          close={() => setPdfOpen(false)}
        />
      )}
      {source && (
        <TakeoffDialog title="見積の作成元" close={() => setSource(false)}>
          <div className="summary-edit-form">
            <p>
              {doc.source.view} · {doc.source.scope}
            </p>
            <p>集計日時 {new Date(doc.source.generatedAt).toLocaleString('ja-JP')}</p>
            <p>
              作成時の{doc.source.lines.length}
              行を保存しています。元の拾い出しを変更しても、この見積には自動反映しません。集計から再作成すると別の見積として保存します。
            </p>
            <div className="estimate-source-list">
              {doc.source.lines.map((l) => (
                <p key={l.lineId}>
                  {l.room} · {l.name || '仕上げ未設定'} · {displayQuantity(l.quantity)}（元明細{' '}
                  {l.itemIds.length}件）
                </p>
              ))}
            </div>
          </div>
        </TakeoffDialog>
      )}
    </section>
  )
}
