import type { ReactNode } from 'react'
import { structuredIssuer } from './business'
import { CompanyBlock } from './CompanyBlock'
import {
  calculateEstimate,
  coverExtraLinesFor,
  estimateLineAmount,
  estimatePresentation,
  type EstimateBody,
  type EstimateLine
} from './estimate'
import { ESTIMATE_COVER_ROWS, type EstimateSheet } from './estimate-layout'
import { coverSummariesFor, type CoverSummary } from './estimate-cover'
import { formatDecimal } from './summary'
import { partLabel } from './materials'

export type EstimateField = {
  scope: string
  key: string
  value: string
  label: string
  display?: ReactNode
  list?: string
  numeric?: boolean
  multiline?: boolean
}
export const estimateMoney = (value: string | null) =>
  value === null ? '未確定' : formatDecimal(value)
export function EstimateDocument({
  body,
  sheet,
  pageNumber,
  field,
  rowControl,
  addRow,
  selectedId,
  deleteRow,
  editCoverRow,
  editCoverExtra,
  addCoverExtra,
  deleteCoverExtra,
  editRow
}: {
  body: EstimateBody
  sheet: EstimateSheet
  pageNumber: number
  field?: (value: EstimateField) => ReactNode
  rowControl?: (line: EstimateLine) => ReactNode
  addRow?: (key: string) => void
  selectedId?: string
  deleteRow?: (line: EstimateLine) => void
  editRow?: (line: EstimateLine) => void
  editCoverRow?: (row: CoverSummary) => void
  editCoverExtra?: (line: EstimateLine) => void
  addCoverExtra?: (key: string, blanks?: number) => void
  deleteCoverExtra?: (id: string) => void
}): React.JSX.Element {
  const issuerCompany = structuredIssuer(body)
  const totals = calculateEstimate(body),
    inclusive = body.taxDisplay === 'inclusive',
    money = estimateMoney
  const cell = (
    scope: string,
    key: string,
    value: string,
    label: string,
    options: Partial<EstimateField> = {}
  ) => {
    const data = { scope, key, value, label, ...options }
    return field ? (
      field(data)
    ) : (
      <span className={`paper-field ${value ? '' : 'is-empty'}`}>{options.display ?? value}</span>
    )
  }
  const meta = (
    key:
      | 'title'
      | 'recipient'
      | 'issuer'
      | 'date'
      | 'expiry'
      | 'delivery'
      | 'conditions'
      | 'memo'
      | 'number',
    label: string,
    multiline = false
  ) => cell('body', key, body[key] ?? '', label, { multiline })
  const columns = (
    <>
      <colgroup>
        {[4, 20, 29, 7, 5, 10, 14, 11].map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {['No.', '品名', '仕様・規格・寸法', '数量', '単位', '単価', '金額', '備考'].map((s) => (
            <th key={s}>{s}</th>
          ))}
        </tr>
      </thead>
    </>
  )
  const row = (index: number) => {
    const l = body.lines[index],
      c = (key: keyof EstimateLine, label: string, options: Partial<EstimateField> = {}) =>
        cell(l.id, key, String(l[key] ?? ''), `明細${index + 1}の${label}`, options)
    const cells = [
      cell(l.id, 'itemNo', l.itemNo ?? String(index + 1), `明細${index + 1}の番号`),
      <div className="paper-name">
        <div>
          {c('name', '名称')}
          {l.room && l.room !== l.name && <div className="paper-room">{c('room', '部屋')}</div>}
        </div>
        <div className="paper-part">
          {c('category', '部位', { list: 'estimate-parts', display: partLabel(l.category) })}
        </div>
      </div>,
      <div className="paper-spec">
        {c('manufacturer', 'メーカー', { list: 'estimate-manufacturers' })}
        {c('specification', '仕様1', { list: 'estimate-materials' })}
        {c('specification2', '仕様2')}
        {c('specification3', '仕様3')}
      </div>,
      c('quantity', '数量', { numeric: true, display: formatDecimal(l.quantity) }),
      c('unit', '単位', { list: 'estimate-units' }),
      c('unitPrice', '単価', {
        numeric: true,
        display: l.unitPrice === null ? '未設定' : formatDecimal(String(l.unitPrice))
      }),
      money(totals.amounts[index]),
      c('note', '備考', { multiline: true })
    ]
    return (
      <tr
        key={l.id}
        className="paper-data-row"
        data-testid="estimate-row"
        data-line-id={l.id}
        data-selected={selectedId === l.id || undefined}
        onClick={
          editRow
            ? (e) => {
                if (!(e.target as HTMLElement).closest('button,input')) editRow(l)
              }
            : undefined
        }
      >
        {cells.map((content, j) => (
          <td
            key={j}
            className={
              [0, 4].includes(j)
                ? 'paper-center'
                : [3, 5, 6].includes(j)
                  ? 'paper-number'
                  : undefined
            }
          >
            {j === 0 && rowControl?.(l)}
            <div className="paper-row-content">{content}</div>
            {j === 7 && deleteRow && (
              <button
                type="button"
                className="paper-delete-row paper-editor-only"
                aria-label={`明細${index + 1}を削除`}
                onClick={() => deleteRow(l)}
              >
                削除
              </button>
            )}
          </td>
        ))}
      </tr>
    )
  }

  const blank = (
    count: number,
    append: ((key: string, blanks?: number) => void) | undefined = addRow,
    all = false
  ) =>
    Array.from({ length: Math.max(0, count) }, (_, i) => (
      <tr
        key={`blank-${i}`}
        aria-hidden={!append || (!all && i > 0)}
        className={`paper-blank-row ${append && (all || i === 0) ? 'paper-add-row' : ''}`}
      >
        {Array.from({ length: 8 }, (_, j) => (
          <td key={j}>
            {append && (all || i === 0) && (all || j !== 6) && (
              <button
                type="button"
                className="paper-add-cell paper-editor-only"
                aria-label={`空行の${['番号', '品名', '仕様', '数量', '単位', '単価', '金額', '備考'][j]}を入力`}
                onClick={() =>
                  append(
                    [
                      'itemNo',
                      'name',
                      'specification',
                      'quantity',
                      'unit',
                      'unitPrice',
                      'unitPrice',
                      'note'
                    ][j],
                    all ? i : 0
                  )
                }
              >
                {j === 1 ? 'ここに明細を入力' : ''}
              </button>
            )}
          </td>
        ))}
      </tr>
    ))
  const sheetAmount = sheet.indexes.some((i) => totals.amounts[i] === null)
    ? null
    : String(sheet.indexes.reduce((sum, i) => sum + BigInt(totals.amounts[i]!), 0n))
  const summary = estimatePresentation(body).mode === 'detail'
  const allCoverRows = summary ? coverSummariesFor(body) : []
  const coverRows = allCoverRows.filter(
    (r) => !sheet.summaryIds || sheet.summaryIds.includes(r.sheetId)
  )
  const allExtras = coverExtraLinesFor(body)
  const extras = allExtras.filter((r) => sheet.extraIds?.includes(r.id))
  return (
    <section
      className={`estimate-paper ${issuerCompany ? 'has-company-block' : ''}`}
      data-sheet-kind={sheet.kind}
      aria-label={sheet.kind === 'cover' ? '表紙' : '内訳書'}
    >
      <div className="paper-content">
        {sheet.kind === 'cover' ? (
          <>
            <div className="paper-header">
              <div>
                <h1>御見積書{sheet.continued ? '（続き）' : ''}</h1>
              </div>
              <div className="paper-heading-right">
                <div className="paper-estimate-number">
                  <span>見積番号</span>
                  {meta('number', '見積番号')}
                </div>
                <div className="paper-issuer">
                  {cell('body', 'issuer', body.issuer, '見積の発行者', {
                    multiline: true,
                    display: issuerCompany ? <CompanyBlock company={issuerCompany} /> : undefined
                  })}
                </div>
              </div>
            </div>
            <div className="paper-top">
              <div>
                <div className="paper-recipient">
                  {meta('recipient', '見積の宛先')}
                  {!/(御中|様|殿)$/.test(body.recipient) && (
                    <span className="paper-honorific">御中</span>
                  )}
                </div>
                <div className="paper-project-label">工事名</div>
                <div className="paper-project">{meta('title', '見積名')}</div>
              </div>
              <div className="paper-amount">
                <span>御見積金額（{inclusive ? '税込' : '税抜'}）</span>
                <strong>
                  {money(inclusive ? totals.total : totals.subtotal)}
                  {totals.subtotal === null ? '' : ' 円'}
                </strong>
              </div>
            </div>
            <div className="paper-meta">
              {(
                [
                  ['date', '見積日'],
                  ['delivery', '納期'],
                  ['expiry', '見積有効期限'],
                  ['conditions', '取引条件']
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label>{label}</label>
                  {meta(
                    key,
                    key === 'conditions'
                      ? '見積の取引条件'
                      : key === 'delivery'
                        ? '見積の納期'
                        : label,
                    key === 'conditions'
                  )}
                </div>
              ))}
            </div>
            <table className="paper-items">
              {columns}
              <tbody>
                {summary ? (
                  <>
                    {coverRows.map((r, i) => (
                      <tr
                        key={r.sheetId}
                        className="paper-data-row"
                        data-testid="estimate-cover-summary"
                        onClick={
                          editCoverRow
                            ? (e) => {
                                if (!(e.target as HTMLElement).closest('button,input,textarea'))
                                  editCoverRow(r)
                              }
                            : undefined
                        }
                      >
                        <td className="paper-center">
                          <div className="paper-row-content">{allCoverRows.indexOf(r) + 1}</div>
                        </td>
                        <td>
                          <div className="paper-row-content">
                            {cell(
                              `cover:${r.sheetId}`,
                              'name',
                              r.name,
                              `表紙の大項目${i + 1}の名称`
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="paper-row-content">
                            {cell(
                              `cover:${r.sheetId}`,
                              'specification',
                              r.specification,
                              `表紙の大項目${i + 1}の仕様`
                            )}
                          </div>
                        </td>
                        <td className="paper-number">
                          <div className="paper-row-content">1.0</div>
                        </td>
                        <td className="paper-center">
                          <div className="paper-row-content">式</div>
                        </td>
                        <td className="paper-number">
                          <div className="paper-row-content">{money(r.amount)}</div>
                        </td>
                        <td className="paper-number">
                          <div className="paper-row-content">{money(r.amount)}</div>
                        </td>
                        <td>
                          <div className="paper-row-content">
                            {cell(
                              `cover:${r.sheetId}`,
                              'note',
                              r.note,
                              `表紙の大項目${i + 1}の備考`,
                              { multiline: true }
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                ) : (
                  <>{sheet.indexes.map(row)}</>
                )}
                {extras.map((r) => {
                  const empty =
                    !r.itemNo &&
                    !r.name &&
                    !r.specification &&
                    !r.note &&
                    r.quantity === '0.0' &&
                    r.unitPrice === 0

                  const c = (key: keyof EstimateLine, label: string, numeric = false) =>
                    cell(
                      `extra:${r.id}`,
                      key,
                      empty ? '' : String(r[key] ?? ''),
                      `表紙の自由行${allExtras.indexOf(r) + 1}の${label}`,
                      {
                        numeric,
                        display: empty
                          ? ''
                          : key === 'unitPrice'
                            ? r.unitPrice === null
                              ? '未設定'
                              : formatDecimal(String(r.unitPrice))
                            : key === 'quantity'
                              ? formatDecimal(r.quantity)
                              : undefined,
                        multiline: key === 'note'
                      }
                    )
                  return (
                    <tr
                      key={r.id}
                      className="paper-data-row"
                      data-testid="estimate-cover-extra"
                      onClick={
                        editCoverExtra
                          ? (e) => {
                              if (!(e.target as HTMLElement).closest('button,input,textarea'))
                                editCoverExtra(r)
                            }
                          : undefined
                      }
                    >
                      <td className="paper-center">
                        <div className="paper-row-content">{c('itemNo', '番号')}</div>
                      </td>
                      <td>
                        <div className="paper-row-content">{c('name', '名称')}</div>
                      </td>
                      <td>
                        <div className="paper-row-content">{c('specification', '仕様')}</div>
                      </td>
                      <td className="paper-number">
                        <div className="paper-row-content">{c('quantity', '数量', true)}</div>
                      </td>
                      <td className="paper-center">
                        <div className="paper-row-content">{c('unit', '単位')}</div>
                      </td>
                      <td className="paper-number">
                        <div className="paper-row-content">{c('unitPrice', '単価', true)}</div>
                      </td>
                      <td className="paper-number">
                        <div className="paper-row-content">
                          {empty ? '' : money(estimateLineAmount(r, body.amountRounding))}
                        </div>
                      </td>
                      <td>
                        <div className="paper-row-content">{c('note', '備考')}</div>
                        {deleteCoverExtra && (
                          <button
                            type="button"
                            className="paper-delete-row paper-editor-only"
                            aria-label={`表紙の自由行${allExtras.indexOf(r) + 1}を削除`}
                            onClick={() => deleteCoverExtra(r.id)}
                          >
                            削除
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {blank(
                  ESTIMATE_COVER_ROWS -
                    (summary ? coverRows.length : sheet.indexes.length) -
                    extras.length,
                  addCoverExtra,
                  !!addCoverExtra
                )}
              </tbody>
            </table>
            <div className="paper-cover-bottom">
              <div className="paper-notes">
                <p>備考</p>
                {meta('memo', '見積の備考', true)}
              </div>
              <div>
                <table className="paper-cover-totals">
                  <colgroup>
                    <col style={{ width: '50%' }} />
                    <col style={{ width: '50%' }} />
                  </colgroup>
                  <tbody>
                    {inclusive && (
                      <>
                        <tr className="paper-tax">
                          <td>税抜小計</td>
                          <td>{money(totals.subtotal)}</td>
                        </tr>
                        <tr className="paper-tax">
                          <td>消費税（{body.taxRate}%）</td>
                          <td>{money(totals.tax)}</td>
                        </tr>
                      </>
                    )}
                    <tr className="paper-sum">
                      <td>
                        {allCoverRows.length + allExtras.length > ESTIMATE_COVER_ROWS
                          ? '見積全体の合計'
                          : '合計'}
                        （{inclusive ? '税込' : '税抜'}）
                      </td>
                      <td>
                        <strong data-testid="estimate-total">
                          {money(inclusive ? totals.total : totals.subtotal)}
                          {totals.subtotal === null ? '' : ' 円'}
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {!inclusive && (
                  <p className="paper-cover-tax-note">※上記価格には消費税は含まれておりません。</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="paper-detail-header">
              <div className="paper-detail-project">
                工事名
                <br />
                {body.title}
              </div>
              <h1>内訳明細書</h1>
            </div>
            <table className="paper-items">
              {columns}
              <tbody>
                <tr className="paper-group">
                  <td colSpan={8}>
                    {cell(`sheet:${sheet.id}`, 'section', sheet.section ?? '', '内訳の工事名')}
                  </td>
                </tr>
                {sheet.indexes.map(row)}
                {blank(23 - sheet.indexes.length)}
                <tr className="paper-sum">
                  <td colSpan={6} className="paper-number">
                    小計
                  </td>
                  <td className="paper-number">{money(sheetAmount)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="paper-footer">{pageNumber}</div>
    </section>
  )
}
