import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Undo2, Redo2, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import {
  estimateBodySchema,
  estimatePresentation,
  calculateEstimate,
  coverExtraLinesFor,
  roundingLabels,
  type EstimateBody,
  type EstimateDoc,
  type EstimateLine
} from '../../shared/estimate'
import { EstimateDocument, type EstimateField } from '../../shared/EstimateDocument'
import {
  estimateDocumentCss,
  estimateSheets,
  estimatePaperOverflows
} from '../../shared/estimate-layout'
import { blankEstimateLine, parseEstimateValue, pasteEstimate } from '../../shared/estimate-edit'
import { materialSpecification, partLabel, type MaterialContext } from '../../shared/materials'
import {
  appendDetailSheet,
  withDetailSheets,
  putEstimateLine,
  removeEstimateLine
} from '../../shared/estimate-pages'
import { coverSummariesFor, editCoverSummary, type CoverSummary } from '../../shared/estimate-cover'
import { EstimateCoverDialog } from './EstimateCoverDialog'
import { EstimateRowDialog } from './EstimateRowDialog'
import { EstimatePdfDialog } from './EstimatePdfDialog'
import {
  companyIdentity,
  companyIssuer,
  structuredIssuer,
  type CompanyIdentity
} from '../../shared/business'
import { EstimateIssuerDialog } from './EstimateIssuerDialog'
import { TakeoffDialog } from './takeoff/Dialogs'
import { MaterialManager } from './MaterialManager'
import { unwrap } from './store'
import { errorMessage } from './error-message'

function PaperCell({
  data,
  locked,
  commit,
  move,
  paste,
  select,
  cancel,
  editRow
}: {
  data: EstimateField
  locked: boolean
  commit: (data: EstimateField, value: string) => boolean
  move: (data: EstimateField, key: string, reverse: boolean) => void
  paste: (data: EstimateField, text: string) => boolean
  select: (scope: string) => void
  cancel: () => void
  editRow?: (data: EstimateField) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(data.value)
  const finished = useRef(false),
    input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing && data.key !== 'recipient') {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])
  const finish = (cancelled = false) => {
    if (finished.current) return true
    if (!cancelled && !commit(data, draft)) return false
    if (cancelled) cancel()
    finished.current = true
    setEditing(false)
    return true
  }
  const start = () => {
    if (locked) return
    select(data.scope)
    if (editRow) {
      editRow(data)
      return
    }
    finished.current = false
    setDraft(data.value)
    setEditing(true)
  }
  const attrs = {
    ref: input,
    value: draft,
    'aria-label': data.label,
    'data-cell-scope': data.scope,
    'data-cell-key': data.key,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (!finish()) requestAnimationFrame(() => input.current?.focus())
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(true)
      } else if ((e.key === 'Enter' && !(data.multiline && e.altKey)) || e.key === 'Tab') {
        e.preventDefault()
        if (finish()) move(data, e.key, e.shiftKey)
      }
    },
    onPaste: (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData('text/plain')
      if (
        data.scope !== 'body' &&
        !data.scope.startsWith('extra:') &&
        !data.scope.startsWith('cover:') &&
        !data.scope.startsWith('group:') &&
        !data.scope.startsWith('sheet:') &&
        /[\t\n]/.test(text)
      ) {
        e.preventDefault()
        if (paste(data, text)) {
          finished.current = true
          setEditing(false)
        }
      }
    }
  }
  if (data.key === 'recipient')
    return (
      <span
        className={`paper-recipient-editor ${editing ? 'paper-input' : ''}`}
        contentEditable={locked ? false : 'plaintext-only'}
        suppressContentEditableWarning
        role="textbox"
        tabIndex={locked ? -1 : 0}
        aria-label={data.label}
        aria-readonly={locked}
        onFocus={() => {
          finished.current = false
          setDraft(data.value)
          setEditing(true)
        }}
        onInput={(e) => setDraft(e.currentTarget.textContent ?? '')}
        onBlur={(e) => {
          const element = e.currentTarget
          if (!finish()) requestAnimationFrame(() => element.focus())
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.textContent = data.value
            finish(true)
            e.currentTarget.blur()
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (finish()) e.currentTarget.blur()
          }
        }}
      >
        {data.value || (editing ? '' : '宛先を入力')}
      </span>
    )
  return editing ? (
    data.multiline ? (
      <textarea {...attrs} className="paper-input" />
    ) : (
      <input
        {...attrs}
        className="paper-input"
        list={data.list}
        type={data.key === 'date' ? 'date' : 'text'}
        inputMode={data.numeric ? 'decimal' : undefined}
      />
    )
  ) : (
    <button
      type="button"
      className={`paper-cell ${data.value ? '' : 'is-empty'}`}
      data-cell-scope={data.scope}
      data-cell-key={data.key}
      aria-label={data.label}
      disabled={locked}
      onFocus={() => select(data.scope)}
      onClick={start}
      onPaste={attrs.onPaste}
    >
      {(data.display ?? data.value) || (
        <span className="paper-placeholder">
          {data.key === 'name'
            ? '品名を入力'
            : data.key === 'specification'
              ? '仕様を入力'
              : data.key === 'section'
                ? '工事名を入力'
                : ''}
        </span>
      )}
    </button>
  )
}

export function EstimateEditor(): React.JSX.Element {
  const { id = '' } = useParams(),
    navigate = useNavigate()
  const [doc, setDoc] = useState<EstimateDoc | null>(null),
    [body, setBody] = useState<EstimateBody | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [issuerDraft, setIssuerDraft] = useState<CompanyIdentity | null>(null)
  const current = useRef<EstimateBody | null>(null),
    [past, setPast] = useState<EstimateBody[]>([]),
    [future, setFuture] = useState<EstimateBody[]>([])
  const invalidDraft = useRef(false)
  const [invalid, setInvalid] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const [catalog, setCatalog] = useState<MaterialContext | null>(null),
    [pdf, setPdf] = useState(false),
    [source, setSource] = useState(false),
    [discard, setDiscard] = useState<(() => void) | null>(null)
  const [kind, setKind] = useState<'cover' | 'detail'>('detail'),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(''),
    [deleteId, setDeleteId] = useState(''),
    [overflow, setOverflow] = useState(false)
  const [coverDraft, setCoverDraft] = useState<{ row: CoverSummary; initialKey: string } | null>(
    null
  )
  const [extraDraft, setExtraDraft] = useState<{
    line: EstimateLine
    isNew: boolean
    initialKey: string
    blanks: number
  } | null>(null)
  const [detailCellEditing, setDetailCellEditing] = useState(false)
  const [coverCellEditing, setCoverCellEditing] = useState(false)
  const cellEditing = kind === 'cover' ? coverCellEditing : detailCellEditing
  const setCellEditing = kind === 'cover' ? setCoverCellEditing : setDetailCellEditing
  const [rowDraft, setRowDraft] = useState<{
    line: EstimateLine
    isNew: boolean
    sheetId: string
    initialKey: string
  } | null>(null)
  const [transfer, setTransfer] = useState(false),
    [panel, setPanel] = useState<'settings' | 'row' | null>(null)
  const [zoom, setZoom] = useState('fit'),
    [scale, setScale] = useState(1)
  const paperHost = useRef<HTMLDivElement>(null),
    pendingFocus = useRef<{ scope: string; key: string } | null>(null)
  const adopt = (d: EstimateDoc, preserveView = false) => {
    const normalized = withDetailSheets(d.body)
    setDoc({ ...d, body: normalized })
    setBody(normalized)
    current.current = normalized
    setRowDraft(null)
    setPast([])
    setFuture([])
    setError('')
    invalidDraft.current = false
    setInvalid(false)
    if (!preserveView) {
      setPage(0)
      setSelected('')
      setKind(estimatePresentation(d.body).mode === 'cover' ? 'cover' : 'detail')
    }
  }
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setDoc(null)
    setBody(null)
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
  useEffect(() => {
    let cancelled = false
    if (doc)
      void unwrap(window.sekisan.readMaterials(doc.projectId))
        .then((c) => {
          if (!cancelled) setCatalog(c)
        })
        .catch((e) => {
          if (!cancelled) setError(e.message)
        })
    return () => {
      cancelled = true
    }
  }, [doc?.projectId, masterOpen])
  const dirty = invalid || (!!doc && !!body && JSON.stringify(doc.body) !== JSON.stringify(body)),
    historical = !!doc && doc.revision !== doc.latestRevision,
    locked = busy || historical
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty || rowDraft || coverDraft || extraDraft) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty, rowDraft, coverDraft, extraDraft])
  const sheets = body ? estimateSheets(body) : [],
    visible = sheets.filter((s) => s.kind === kind),
    sheet = visible[Math.min(page, Math.max(0, visible.length - 1))]
  useEffect(() => {
    const check = () => {
      const host = paperHost.current,
        papers = host?.querySelectorAll<HTMLElement>('.estimate-paper')
      setOverflow(!!papers && [...papers].some(estimatePaperOverflows))
    }
    check()
    const observer = new ResizeObserver(check)
    if (paperHost.current) observer.observe(paperHost.current)
    return () => observer.disconnect()
  }, [body, kind, page])
  useEffect(() => {
    const fit = () => {
      const host = paperHost.current
      if (host)
        setScale(
          zoom === 'fit'
            ? Math.min(1, Math.max(0.4, (host.clientWidth - 72) / ((297 * 96) / 25.4)))
            : Number(zoom)
        )
    }
    fit()
    const observer = new ResizeObserver(fit)
    if (paperHost.current) observer.observe(paperHost.current)
    return () => observer.disconnect()
  }, [zoom, doc, panel])
  useEffect(() => {
    const f = pendingFocus.current
    if (!f) return
    const button = paperHost.current?.querySelector<HTMLButtonElement>(
      `button[data-cell-scope="${CSS.escape(f.scope)}"][data-cell-key="${CSS.escape(f.key)}"]`
    )
    if (button) {
      pendingFocus.current = null
      button.click()
    }
  }, [body, kind, page])
  function change(next: EstimateBody): void {
    const old = current.current
    if (!old || JSON.stringify(old) === JSON.stringify(next)) return
    setPast((p) => [...p.slice(-99), old])
    setFuture([])
    current.current = next
    setBody(next)
    setNotice('')
    setError('')
  }
  function history(redo = false): void {
    if (locked) return
    const stack = redo ? future : past,
      next = stack.at(-1)
    if (!next || !current.current) return
    const previous = current.current
    if (redo) {
      setPast((p) => [...p, previous])
      setFuture((p) => p.slice(0, -1))
    } else {
      setFuture((p) => [...p, previous])
      setPast((p) => p.slice(0, -1))
    }
    current.current = next
    setBody(next)
    setKind(estimatePresentation(next).mode === 'cover' ? 'cover' : kind)
    setPage(0)
    setError('')
  }
  function commit(data: EstimateField, value: string): boolean {
    if (locked || !current.current) return false
    try {
      if (data.scope.startsWith('cover:')) {
        change(editCoverSummary(current.current, data.scope.slice(6), data.key, value))
        invalidDraft.current = false
        setInvalid(false)
        return true
      }
      const next = structuredClone(current.current),
        converted = parseEstimateValue(data.key, value)
      if (data.scope === 'body') {
        ;(next as unknown as Record<string, unknown>)[data.key] = converted
        if (data.key === 'issuer') delete next.issuerCompany
      } else if (data.scope.startsWith('extra:')) {
        next.coverExtras = coverExtraLinesFor(next).map((l) =>
          l.id === data.scope.slice(6) ? { ...l, [data.key]: converted } : l
        )
        next.expenses = 0
      } else if (data.scope.startsWith('sheet:')) {
        const sheet = next.detailSheets!.find((s) => s.id === data.scope.slice(6))
        if (!sheet) throw new Error('内訳明細書がありません。')
        sheet.section = String(converted)
        next.lines.forEach((l) => {
          if (sheet.lineIds.includes(l.id)) l.section = String(converted)
        })
      } else if (data.scope.startsWith('group:')) {
        const original = next.lines.find((l) => l.id === data.scope.slice(6))
        const name = original?.section.trim() || '内装仕上工事'
        next.lines.forEach((l) => {
          if ((l.section.trim() || '内装仕上工事') === name) l.section = String(converted)
        })
      } else {
        const l = next.lines.find((l) => l.id === data.scope)
        if (!l) throw new Error('明細が見つかりません。')
        ;(l as unknown as Record<string, unknown>)[data.key] = converted
        if (data.key === 'section') {
          const owner = next.detailSheets!.find((s) => s.lineIds.includes(l.id))!
          owner.section = String(converted)
          next.lines.forEach((row) => {
            if (owner.lineIds.includes(row.id)) row.section = String(converted)
          })
        }
        if (data.key === 'specification') {
          const named = catalog?.project.filter((m) => m.name === value) ?? []
          const material =
            catalog?.project.find((m) => value === `${m.name}｜${materialSpecification(m)}`) ??
            (named.length === 1 ? named[0] : undefined)
          if (material)
            Object.assign(l, {
              specification: material.name,
              category: material.category,
              specification2: materialSpecification(material),
              unit: material.unit,
              unitPrice: material.unitPrice
            })
        }
      }
      const parsed = estimateBodySchema.safeParse(next)
      if (!parsed.success) throw new Error(parsed.error.issues[0].message)
      invalidDraft.current = false
      setInvalid(false)
      change(parsed.data)
      return true
    } catch (e) {
      invalidDraft.current = true
      setInvalid(true)
      setError(errorMessage(e, '入力内容を確認してください。'))
      return false
    }
  }
  function move(data: EstimateField, key: string, reverse: boolean): void {
    const b = current.current
    if (!b) return
    if (kind === 'cover' && (data.scope.startsWith('cover:') || data.scope.startsWith('extra:'))) {
      const rows = [
        ...coverSummariesFor(b).map((r) => ({
          scope: `cover:${r.sheetId}`,
          keys: ['name', 'specification', 'note']
        })),
        ...coverExtraLinesFor(b).map((r) => ({
          scope: `extra:${r.id}`,
          keys: ['itemNo', 'name', 'specification', 'quantity', 'unit', 'unitPrice', 'note']
        }))
      ]
      let r = rows.findIndex((row) => row.scope === data.scope),
        c = rows[r]?.keys.indexOf(data.key) ?? -1
      if (r < 0 || c < 0) return
      const step = reverse ? -1 : 1
      if (key === 'Enter') {
        r += step
        c = Math.max(0, rows[r]?.keys.indexOf(data.key) ?? 0)
      } else {
        c += step
        if (c < 0) {
          r--
          c = (rows[r]?.keys.length ?? 1) - 1
        } else if (c >= rows[r].keys.length) {
          r++
          c = 0
        }
      }
      if (!rows[r]) return
      pendingFocus.current = { scope: rows[r].scope, key: rows[r].keys[c] }
      const plans = estimateSheets(b).filter((s) => s.kind === 'cover')
      const index = plans.findIndex((s) =>
        [
          ...(s.summaryIds ?? []).map((id) => `cover:${id}`),
          ...(s.extraIds ?? []).map((id) => `extra:${id}`)
        ].includes(rows[r].scope)
      )
      if (index >= 0) setPage(index)
      requestAnimationFrame(() => {
        const f = pendingFocus.current
        if (!f) return
        const button = paperHost.current?.querySelector<HTMLButtonElement>(
          `button[data-cell-scope="${CSS.escape(f.scope)}"][data-cell-key="${CSS.escape(f.key)}"]`
        )
        if (button) {
          pendingFocus.current = null
          button.click()
        }
      })
      return
    }
    const dir = reverse ? -1 : 1,
      p = estimatePresentation(b),
      ordered = estimateSheets(b)
        .filter((s) => s.kind === (p.mode === 'cover' ? 'cover' : 'detail'))
        .flatMap((s) => s.indexes)
    const estimateGridKeys = [
      'itemNo',
      'name',
      'category',
      'manufacturer',
      'specification',
      'specification2',
      'specification3',
      'quantity',
      'unit',
      'unitPrice',
      'note'
    ]
    const row = ordered.findIndex((i) => b.lines[i].id === data.scope),
      col = estimateGridKeys.indexOf(data.key as (typeof estimateGridKeys)[number])
    let dest: { scope: string; key: string } | undefined
    if (row >= 0 && col >= 0) {
      let r = row,
        c = col
      if (key === 'Enter') r += dir
      else {
        c += dir
        if (c < 0) {
          r--
          c = estimateGridKeys.length - 1
        }
        if (c >= estimateGridKeys.length) {
          r++
          c = 0
        }
      }
      if (r >= 0 && r < ordered.length)
        dest = { scope: b.lines[ordered[r]].id, key: estimateGridKeys[c] }
      else if (
        r === ordered.length &&
        dir > 0 &&
        !locked &&
        b.lines.length < 2000 &&
        (p.mode === 'detail' || p.coverLineIds.length < 12)
      ) {
        add(key === 'Enter' ? data.key : 'itemNo')
        return
      }
    }
    if (!dest) {
      const cells = [
          ...paperHost.current!.querySelectorAll<HTMLButtonElement>('button[data-cell-key]')
        ],
        index = cells.findIndex(
          (x) => x.dataset.cellScope === data.scope && x.dataset.cellKey === data.key
        ),
        button = cells[index + (key === 'Tab' ? dir : 0)]
      button?.focus()
      if (key === 'Tab') button?.click()
      return
    }
    pendingFocus.current = dest
    const plans = estimateSheets(b).filter((s) => s.kind === kind),
      target = plans.findIndex((s) => s.indexes.some((i) => b.lines[i].id === dest!.scope))
    if (target >= 0) setPage(target)
    requestAnimationFrame(() => {
      const button = paperHost.current?.querySelector<HTMLButtonElement>(
        `button[data-cell-scope="${CSS.escape(dest!.scope)}"][data-cell-key="${dest!.key}"]`
      )
      if (button) {
        pendingFocus.current = null
        button.click()
      }
    })
  }
  function paste(data: EstimateField, text: string): boolean {
    if (locked || !current.current) return false
    try {
      change(pasteEstimate(current.current, data.scope, data.key, text, () => crypto.randomUUID()))
      setNotice('貼り付けました。金額列は数量×単価で再計算します。')
      return true
    } catch (e) {
      setError(errorMessage(e, '貼り付けできませんでした。'))
      return false
    }
  }
  const leave = (action: () => void) => {
    if (dirty) setDiscard(() => action)
    else action()
  }
  async function load(revision: number): Promise<void> {
    setBusy(true)
    try {
      adopt(await unwrap(window.sekisan.readEstimate({ id, revision })))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function save(): Promise<void> {
    if (!current.current || !doc || locked || invalidDraft.current) return
    setBusy(true)
    try {
      const saved = await unwrap(
        window.sekisan.saveEstimate({
          id,
          expectedRevision: doc.latestRevision,
          body: current.current
        })
      )
      adopt(saved, true)
      setNotice(`第${saved.revision}版として保存しました。`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!body || !doc)
    return (
      <section className="estimate-page">
        <div className="panel-empty">{error || '見積を読み込み中…'}</div>
      </section>
    )
  const p = estimatePresentation(body),
    totals = calculateEstimate(body),
    picked = body.lines.find((l) => l.id === selected),
    output = { cover: p.outputCover, detail: p.outputDetail }
  const update = (patch: Partial<EstimateBody>) => change({ ...current.current!, ...patch })
  const presentation = (patch: Partial<typeof p>) =>
    update({ presentation: { ...estimatePresentation(current.current!), ...patch } })
  const openRow = (line: EstimateLine, key = 'name') => {
    if (locked) return
    setSelected(line.id)
    const owner = body.detailSheets!.find((s) => s.lineIds.includes(line.id))!
    setRowDraft({ line, isNew: false, sheetId: owner.id, initialKey: key })
  }
  const addCoverExtra = (key = 'name', blanks = 0) => {
    if (locked) return
    const b = current.current!,
      extras = coverExtraLinesFor(b)
    if (extras.length >= 2000) return
    const line = { ...blankEstimateLine(crypto.randomUUID()), unitPrice: 0 }
    if (!cellEditing) {
      setExtraDraft({ line, isNew: true, initialKey: key, blanks })
      return
    }
    const empty = Array.from({ length: blanks }, () => ({
      ...blankEstimateLine(crypto.randomUUID()),
      quantity: '0.0',
      unitPrice: 0
    }))
    const next = estimateBodySchema.parse({
      ...b,
      expenses: 0,
      coverExtras: [...extras, ...empty, line]
    })
    change(next)
    pendingFocus.current = { scope: `extra:${line.id}`, key }
    setPage(
      estimateSheets(next)
        .filter((s) => s.kind === 'cover')
        .findIndex((s) => s.extraIds?.includes(line.id))
    )
  }
  const targetSheet = () =>
    kind === 'detail'
      ? current.current!.detailSheets!.find((s) => s.id === sheet?.id)
      : current.current!.detailSheets!.find((s) => s.lineIds.length < 23)
  const add = (key = 'name') => {
    const b = current.current!,
      pres = estimatePresentation(b),
      target = targetSheet()
    if (b.lines.length >= 2000 || (pres.mode === 'cover' && pres.coverLineIds.length >= 12)) return
    if (!target || target.lineIds.length >= 23) {
      setNotice('この内訳明細書は23行までです。「内訳明細書を追加」から追加してください。')
      return
    }
    const line = blankEstimateLine(crypto.randomUUID(), target.section, String(b.lines.length + 1))
    if (!cellEditing) {
      setRowDraft({ line, isNew: true, sheetId: target.id, initialKey: key })
      return
    }
    pendingFocus.current = { scope: line.id, key }
    change(putEstimateLine(b, line, target.id))
    setSelected(line.id)
  }
  const addSheet = () => {
    const next = appendDetailSheet(current.current!, crypto.randomUUID())
    change(next)
    setKind('detail')
    setPage(next.detailSheets!.length - 1)
    setSelected('')
    setTransfer(false)
  }
  const applyRow = (line: EstimateLine, advance: boolean): string | void => {
    if (!rowDraft) return
    try {
      const next = putEstimateLine(current.current!, line, rowDraft.sheetId)
      change(next)
      setSelected(line.id)
      if (!advance) {
        setRowDraft(null)
        return
      }
      const owner = next.detailSheets!.find((s) => s.id === rowDraft.sheetId)!
      const ids =
        estimatePresentation(next).mode === 'cover'
          ? estimatePresentation(next).coverLineIds
          : owner.lineIds
      const following = ids[ids.indexOf(line.id) + 1]
      if (following) {
        const value = next.lines.find((l) => l.id === following)!
        setRowDraft({
          line: value,
          isNew: false,
          sheetId: next.detailSheets!.find((s) => s.lineIds.includes(following))!.id,
          initialKey: 'name'
        })
      } else if (ids.length < (kind === 'cover' ? 12 : 23) && owner.lineIds.length < 23) {
        setRowDraft({
          line: blankEstimateLine(
            crypto.randomUUID(),
            owner.section,
            String(next.lines.length + 1)
          ),
          isNew: true,
          sheetId: owner.id,
          initialKey: 'name'
        })
      } else {
        setRowDraft(null)
        setNotice('この内訳明細書は23行までです。「内訳明細書を追加」から追加してください。')
      }
    } catch (e) {
      return errorMessage(e, '入力内容を確認してください。')
    }
  }
  const draftIds = rowDraft
    ? p.mode === 'cover'
      ? p.coverLineIds
      : body.detailSheets!.find((s) => s.id === rowDraft.sheetId)!.lineIds
    : []
  const canNext =
    !!rowDraft &&
    (rowDraft.isNew ? draftIds.length + 1 : draftIds.indexOf(rowDraft.line.id) + 1) <
      (p.mode === 'cover' ? 12 : 23)
  const reorder = (offset: number) => {
    const b = current.current!,
      owner = b.detailSheets!.find((s) => s.lineIds.includes(selected))
    if (!owner) return
    const index = owner.lineIds.indexOf(selected)
    if (index + offset < 0 || index + offset >= owner.lineIds.length) return
    const next = structuredClone(b),
      ids = next.detailSheets!.find((s) => s.id === owner.id)!.lineIds
    ;[ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]
    change(next)
  }

  const exportDisabled = busy || dirty || (!output.cover && !output.detail)
  const keys = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || rowDraft || coverDraft || extraDraft) return
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'z' &&
      !(
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
    ) {
      e.preventDefault()
      history(e.shiftKey)
    }
  }
  return (
    <section className="estimate-page estimate-focused" aria-busy={busy} onKeyDown={keys}>
      <style>{estimateDocumentCss}</style>
      <header className="estimate-app-header">
        <button
          className="icon-button"
          aria-label="見積一覧へ戻る"
          disabled={busy}
          onClick={() => leave(() => navigate(`/estimates/${doc.projectId}`))}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="estimate-heading">
          <span>
            見積書{' '}
            <small>
              第{doc.revision}版{historical ? '・閲覧のみ' : ''}
            </small>
          </span>
          <h1>{body.title}</h1>
        </div>
        <span className={`estimate-save-status ${dirty ? 'unsaved' : ''}`}>
          {dirty ? '未保存' : '保存済み'}
        </span>
        <div className="estimate-header-actions">
          <button
            className="estimate-tool-icon"
            aria-label="元に戻す"
            title="元に戻す"
            disabled={locked || !past.length}
            onClick={() => history()}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="estimate-tool-icon"
            aria-label="やり直す"
            title="やり直す"
            disabled={locked || !future.length}
            onClick={() => history(true)}
          >
            <Redo2 size={18} />
          </button>
          <button className="secondary" disabled={busy} onClick={() => setMasterOpen(true)}>
            マスタ
          </button>
          <button className="secondary" disabled={exportDisabled} onClick={() => setPdf(true)}>
            PDFを作成
          </button>
          <button
            className="secondary"
            disabled={exportDisabled}
            onClick={async () => {
              setBusy(true)
              try {
                await unwrap(window.sekisan.printEstimate({ id, revision: doc.revision, output }))
                setNotice('印刷ダイアログを閉じました。')
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            印刷
          </button>
          <button className="primary" disabled={locked || !dirty} onClick={() => void save()}>
            <Save size={15} />
            見積を保存
          </button>
        </div>
      </header>
      <main className="estimate-content estimate-modern-editor">
        <div className="estimate-commandbar">
          <nav aria-label="編集する帳票" className="estimate-paper-tabs">
            <button
              aria-pressed={kind === 'cover'}
              onClick={() => {
                setKind('cover')
                setPage(0)
                setTransfer(false)
              }}
            >
              表紙
            </button>
            {p.mode === 'detail' && (
              <button
                aria-pressed={kind === 'detail'}
                onClick={() => {
                  setKind('detail')
                  setPage(0)
                }}
              >
                内訳書
              </button>
            )}
          </nav>
          {visible.length > 1 && (
            <select
              aria-label={kind === 'cover' ? '編集する表紙ページ' : '編集する内訳ページ'}
              value={Math.min(page, visible.length - 1)}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {visible.map((s, i) => (
                <option key={i} value={i}>
                  {i + 1} / {visible.length}　{s.section}
                </option>
              ))}
            </select>
          )}
          {p.mode === 'detail' ? (
            <button
              className="estimate-text-action"
              aria-pressed={transfer}
              disabled={locked}
              onClick={() => {
                setTransfer(!transfer)
                setKind('detail')
                setPage(0)
              }}
            >
              表紙へ転記
            </button>
          ) : (
            <button
              className="estimate-text-action"
              disabled={locked}
              onClick={() => {
                presentation({ mode: 'detail', outputDetail: true })
                setKind('detail')
                setPage(0)
              }}
            >
              全明細の内訳書編集に戻す
            </button>
          )}
          <button
            className="estimate-text-action"
            disabled={!picked}
            aria-pressed={panel === 'row'}
            onClick={() => setPanel(panel === 'row' ? null : 'row')}
          >
            行の詳細
          </button>
          {p.mode === 'detail' && (
            <button
              className="estimate-text-action"
              disabled={locked || body.detailSheets!.length >= 2000}
              onClick={addSheet}
            >
              内訳明細書を追加
            </button>
          )}
          <button
            className="estimate-text-action"
            aria-pressed={cellEditing}
            onClick={() => setCellEditing(!cellEditing)}
          >
            {cellEditing ? '行をまとめて編集' : 'セル編集に切り替え'}
          </button>
          {kind === 'cover' && p.mode === 'detail' && (
            <button
              className="estimate-text-action"
              title="内訳の集計行を表示せず、表紙の入力行だけで作成します。元の内訳は保持します。"
              disabled={locked}
              onClick={() => {
                update({
                  coverExtras: coverExtraLinesFor(body),
                  expenses: 0,
                  presentation: {
                    ...p,
                    mode: 'cover',
                    coverLineIds: [],
                    outputCover: true,
                    outputDetail: false
                  }
                })
                setPage(0)
                setTransfer(false)
                setCoverCellEditing(false)
              }}
            >
              表紙だけで入力
            </button>
          )}
          {kind === 'cover' && (
            <button
              className="estimate-text-action"
              disabled={locked || coverExtraLinesFor(body).length >= 2000}
              onClick={() => addCoverExtra()}
            >
              表紙に行を追加
            </button>
          )}
          <span className="toolbar-spacer" />
          <div className="estimate-tax-switch">
            {(['exclusive', 'inclusive'] as const).map((v) => (
              <button
                key={v}
                aria-pressed={(body.taxDisplay ?? 'exclusive') === v}
                disabled={locked}
                onClick={() => update({ taxDisplay: v })}
              >
                {v === 'exclusive' ? '税抜' : '税込'}
              </button>
            ))}
          </div>
          <div className="estimate-output-checks">
            <span>出力</span>
            {(['cover', 'detail'] as const).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={output[k]}
                  disabled={locked}
                  onChange={(e) =>
                    presentation(
                      k === 'cover'
                        ? { outputCover: e.target.checked }
                        : { outputDetail: e.target.checked }
                    )
                  }
                />
                {k === 'cover' ? '表紙' : '内訳書'}
              </label>
            ))}
          </div>
          <select
            aria-label="帳票の表示倍率"
            value={zoom}
            onChange={(e) => setZoom(e.target.value)}
          >
            <option value="fit">幅に合わせる</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
          </select>
          <button
            className="estimate-text-action"
            aria-pressed={panel === 'settings'}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          >
            設定
          </button>
        </div>
        {kind === 'cover' && p.mode === 'cover' && !p.coverLineIds.length && (
          <p className="estimate-inline-notice">
            表紙のみ：行をクリックして品名・仕様・数量・単位・単価・備考を入力できます。合計は表紙の行だけで計算します。
          </p>
        )}
        {kind === 'cover' && p.mode === 'detail' && (
          <p className="estimate-inline-notice">
            {cellEditing
              ? '大項目名・仕様・備考をクリックして編集できます。'
              : '行をクリックすると、大項目名・仕様・備考をまとめて編集できます。'}
            同じ工事名の内訳はまとめて表示し、金額は内訳から自動計算します。
          </p>
        )}
        {transfer && (
          <div className="estimate-transfer-bar">
            <strong>表紙 残り{12 - p.coverLineIds.length}／12行</strong>
            <span>
              {p.coverLineIds.length === 12
                ? '上限です。追加する場合は内訳書形式をご利用ください。'
                : '載せる明細にチェックを付けてください。選択した行のみを計上します。'}
            </span>
            <button
              className="primary"
              disabled={locked || !p.coverLineIds.length}
              onClick={() => {
                presentation({ mode: 'cover' })
                setKind('cover')
                setPage(0)
                setTransfer(false)
              }}
            >
              選択した明細を表紙で編集
            </button>
            <button className="estimate-text-action" onClick={() => setTransfer(false)}>
              閉じる
            </button>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="estimate-inline-notice" role="status">
            {notice}
          </p>
        )}
        {overflow && (
          <p className="form-error" role="alert">
            文字が固定の行枠またはA4の範囲を超えています。品名・仕様・備考を短くしてください。文字が欠ける状態ではPDF・印刷できません。
          </p>
        )}
        <div className="estimate-editing-workspace">
          <div className="estimate-paper-scroll" ref={paperHost}>
            <div className="estimate-paper-stage" style={{ zoom: scale }}>
              {sheet && (
                <EstimateDocument
                  body={body}
                  sheet={sheet}
                  pageNumber={sheets.indexOf(sheet) + 1}
                  selectedId={selected}
                  addCoverExtra={!locked && kind === 'cover' ? addCoverExtra : undefined}
                  editCoverExtra={
                    !locked && !cellEditing
                      ? (line) =>
                          setExtraDraft({ line, isNew: false, initialKey: 'name', blanks: 0 })
                      : undefined
                  }
                  deleteCoverExtra={!locked ? (id) => setDeleteId(`extra:${id}`) : undefined}
                  editCoverRow={
                    !locked && !cellEditing
                      ? (row) => setCoverDraft({ row, initialKey: 'name' })
                      : undefined
                  }
                  editRow={
                    !locked && !transfer && !cellEditing ? (line) => openRow(line) : undefined
                  }
                  addRow={
                    !locked && !transfer && kind === 'detail' && sheet.indexes.length < 23
                      ? add
                      : undefined
                  }
                  deleteRow={
                    !locked && !transfer
                      ? (line) => {
                          setSelected(line.id)
                          setDeleteId(line.id)
                        }
                      : undefined
                  }
                  field={(data) => (
                    <PaperCell
                      key={`${data.scope}:${data.key}`}
                      data={data}
                      editRow={
                        data.scope === 'body' && data.key === 'issuer' && structuredIssuer(body)
                          ? () => setIssuerDraft(structuredIssuer(body)!)
                          : !cellEditing && data.scope.startsWith('extra:')
                            ? (d) => {
                                const line = coverExtraLinesFor(body).find(
                                  (l) => l.id === d.scope.slice(6)
                                )
                                if (line)
                                  setExtraDraft({
                                    line,
                                    isNew: false,
                                    initialKey: d.key,
                                    blanks: 0
                                  })
                              }
                            : !cellEditing && data.scope.startsWith('cover:')
                              ? (d) => {
                                  const row = coverSummariesFor(body).find(
                                    (r) => r.sheetId === d.scope.slice(6)
                                  )
                                  if (row) setCoverDraft({ row, initialKey: d.key })
                                }
                              : !cellEditing && body.lines.some((l) => l.id === data.scope)
                                ? (d) =>
                                    openRow(
                                      body.lines.find((l) => l.id === d.scope)!,
                                      d.key
                                    )
                                : undefined
                      }
                      locked={locked}
                      commit={commit}
                      move={move}
                      paste={paste}
                      select={(scope) => {
                        if (
                          scope !== 'body' &&
                          !scope.startsWith('cover:') &&
                          !scope.startsWith('extra:')
                        )
                          setSelected(scope)
                      }}
                      cancel={() => {
                        invalidDraft.current = false
                        setInvalid(false)
                        setError('')
                      }}
                    />
                  )}
                  rowControl={
                    p.mode === 'detail' && transfer
                      ? (line) => (
                          <input
                            className="paper-transfer paper-editor-only"
                            aria-label={`${line.name || line.itemNo || '明細'}を表紙へ転記`}
                            type="checkbox"
                            checked={p.coverLineIds.includes(line.id)}
                            disabled={
                              locked ||
                              (!p.coverLineIds.includes(line.id) && p.coverLineIds.length >= 12)
                            }
                            onChange={(e) =>
                              presentation({
                                coverLineIds: e.target.checked
                                  ? [...p.coverLineIds, line.id]
                                  : p.coverLineIds.filter((id) => id !== line.id)
                              })
                            }
                          />
                        )
                      : undefined
                  }
                />
              )}
              {!locked &&
                !transfer &&
                ((kind === 'detail' && (sheet?.indexes.length ?? 0) < 23) ||
                  (p.mode === 'cover' && p.coverLineIds.length < 12)) && (
                  <button
                    className="estimate-add-line"
                    onClick={() => (kind === 'cover' ? addCoverExtra() : add())}
                  >
                    明細を追加
                  </button>
                )}
            </div>
          </div>
          {panel && (
            <aside className="estimate-inspector">
              <div className="estimate-inspector-heading">
                <strong>{panel === 'settings' ? '見積の設定' : '選択した明細'}</strong>
                <button className="estimate-text-action" onClick={() => setPanel(null)}>
                  閉じる
                </button>
              </div>
              {panel === 'row' && picked ? (
                <>
                  <p className="estimate-inspector-caption">
                    {picked.itemNo || body.lines.indexOf(picked) + 1}　{picked.name || '品名未入力'}
                  </p>
                  {(
                    [
                      ['section', '工事区分', 'estimate-sections'],
                      ['room', '部屋', ''],
                      ['category', '部位', 'estimate-parts'],
                      ['manufacturer', 'メーカー', 'estimate-manufacturers'],
                      ['specification2', '仕様2', ''],
                      ['specification3', '仕様3', '']
                    ] as const
                  ).map(([key, label, list]) => (
                    <label key={key}>
                      {label}
                      <input
                        key={`${picked.id}:${picked[key]}`}
                        aria-label={key === 'section' ? '選択明細の工事区分' : `選択明細の${label}`}
                        defaultValue={
                          key === 'category' ? partLabel(picked.category) : (picked[key] ?? '')
                        }
                        disabled={locked}
                        list={list || undefined}
                        onBlur={(e) =>
                          commit(
                            { scope: picked.id, key, value: String(picked[key] ?? ''), label },
                            e.target.value
                          )
                        }
                        onKeyDown={(e) => {
                          if (!e.nativeEvent.isComposing && e.key === 'Enter')
                            e.currentTarget.blur()
                          if (e.key === 'Escape') {
                            e.currentTarget.value =
                              key === 'category'
                                ? partLabel(picked.category)
                                : String(picked[key] ?? '')
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    </label>
                  ))}
                  <div className="estimate-inspector-actions">
                    <button
                      className="secondary"
                      aria-label="選択明細を上へ"
                      disabled={locked || body.lines[0].id === selected}
                      onClick={() => reorder(-1)}
                    >
                      <ArrowUp size={15} />
                      上へ
                    </button>
                    <button
                      className="secondary"
                      aria-label="選択明細を下へ"
                      disabled={locked || body.lines.at(-1)?.id === selected}
                      onClick={() => reorder(1)}
                    >
                      <ArrowDown size={15} />
                      下へ
                    </button>
                    <button
                      className="estimate-delete-action"
                      disabled={locked}
                      onClick={() => setDeleteId(selected)}
                    >
                      <Trash2 size={15} />
                      削除
                    </button>
                  </div>
                </>
              ) : panel === 'settings' ? (
                <>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={async () => {
                      setBusy(true)
                      setError('')
                      try {
                        setIssuerDraft(companyIdentity(await unwrap(window.sekisan.readCompany())))
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : '自社情報を読み込めませんでした。'
                        )
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    自社情報を反映
                  </button>
                  <p className="panel-description">会社情報を確認して、この見積に反映します。</p>
                  <label>
                    保存履歴
                    <select
                      aria-label="見積の保存履歴"
                      value={doc.revision}
                      disabled={busy}
                      onChange={(e) => leave(() => void load(Number(e.target.value)))}
                    >
                      {doc.versions.map((v) => (
                        <option key={v.revision} value={v.revision}>
                          第{v.revision}版 · {new Date(v.savedAt).toLocaleString('ja-JP')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    消費税率（%）
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step=".01"
                      value={body.taxRate}
                      disabled={locked}
                      onChange={(e) => {
                        const taxRate = Number(e.target.value)
                        if (Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 100)
                          update({ taxRate })
                      }}
                    />
                  </label>
                  {(['amountRounding', 'taxRounding'] as const).map((k) => (
                    <label key={k}>
                      {k === 'amountRounding' ? '明細金額' : '消費税'}の端数処理
                      <select
                        disabled={locked}
                        value={body[k]}
                        onChange={(e) => update({ [k]: e.target.value })}
                      >
                        {Object.entries(roundingLabels).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button className="secondary" onClick={() => setSource(true)}>
                    作成元を確認
                  </button>
                  <details>
                    <summary>Excelからの貼り付け</summary>
                    <p>
                      No.／品名／仕様／数量／単位／単価／金額／備考の順で貼り付けできます。金額は自動計算します。
                    </p>
                  </details>
                </>
              ) : (
                <p>明細をクリックして選択してください。</p>
              )}
            </aside>
          )}
        </div>
        <footer className="estimate-editor-status">
          <span>
            {cellEditing
              ? 'セルをクリックして入力　·　Enter ↓　Tab →　Esc 取消'
              : '行をクリックしてまとめて編集　·　表紙13行／内訳23行固定'}
          </span>
          <span>
            {totals.missingPrices
              ? `単価未設定 ${totals.missingPrices}件`
              : !output.cover && !output.detail
                ? '出力する帳票を選択してください'
                : p.mode === 'cover'
                  ? p.coverLineIds.length
                    ? `表紙 ${p.coverLineIds.length}／12行`
                    : '表紙のみ'
                  : `明細 ${body.lines.length}行`}
            　·　A4横　{Math.round(scale * 100)}%
          </span>
        </footer>
        <datalist id="estimate-parts">
          {[
            ...new Set([
              '天井',
              '壁',
              '床',
              '巾木',
              ...(catalog?.parts ?? []).map(partLabel),
              ...body.lines.map((l) => partLabel(l.category))
            ])
          ].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="estimate-units">
          {[
            ...new Set([
              '㎡',
              'ｍ',
              'm',
              '式',
              '個',
              '人工',
              ...(catalog?.units ?? []),
              ...body.lines.map((l) => l.unit)
            ])
          ].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="estimate-manufacturers">
          {['サンゲツ', 'リリカラ', '東リ', 'シンコール', 'ルノン'].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="estimate-materials">
          {[
            ...new Set(catalog?.project.map((m) => `${m.name}｜${materialSpecification(m)}`) ?? [])
          ].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="estimate-sections">
          {[...new Set(body.lines.map((l) => l.section))].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </main>
      {coverDraft && (
        <EstimateCoverDialog
          key={coverDraft.row.sheetId}
          row={coverDraft.row}
          initialKey={coverDraft.initialKey}
          canNext={coverSummariesFor(body).at(-1)?.sheetId !== coverDraft.row.sheetId}
          close={() => setCoverDraft(null)}
          apply={(draft, nextRow) => {
            if (locked || !current.current) return '現在は編集できません。'
            try {
              let next = current.current
              for (const key of ['name', 'specification', 'note'] as const)
                next = editCoverSummary(next, coverDraft.row.sheetId, key, draft[key])
              change(next)
              const rows = coverSummariesFor(next)
              const following =
                rows[rows.findIndex((r) => r.sheetId === coverDraft.row.sheetId) + 1]
              if (nextRow && following) {
                setCoverDraft({ row: following, initialKey: 'name' })
                const index = estimateSheets(next)
                  .filter((s) => s.kind === 'cover')
                  .findIndex((s) => s.summaryIds?.includes(following.sheetId))
                if (index >= 0) setPage(index)
              } else setCoverDraft(null)
            } catch (e) {
              return errorMessage(e, '入力内容を確認してください。')
            }
          }}
        />
      )}
      {extraDraft && (
        <EstimateRowDialog
          key={extraDraft.line.id}
          cover
          line={extraDraft.line}
          body={body}
          isNew={extraDraft.isNew}
          initialKey={extraDraft.initialKey}
          catalog={null}
          canNext={coverExtraLinesFor(body).length + extraDraft.blanks < 2000}
          close={() => setExtraDraft(null)}
          remove={
            extraDraft.isNew
              ? undefined
              : () => {
                  setDeleteId(`extra:${extraDraft.line.id}`)
                  setExtraDraft(null)
                }
          }
          apply={(line, advance) => {
            if (locked || !current.current) return '現在は編集できません。'
            try {
              const rows = coverExtraLinesFor(current.current)
              const blanks = Array.from({ length: extraDraft.blanks }, () => ({
                ...blankEstimateLine(crypto.randomUUID()),
                quantity: '0.0',
                unitPrice: 0
              }))
              const extras = extraDraft.isNew
                ? [...rows, ...blanks, line]
                : rows.map((r) => (r.id === line.id ? line : r))
              const next = estimateBodySchema.parse({
                ...current.current,
                expenses: 0,
                coverExtras: extras
              })
              change(next)
              const following = extras[extras.findIndex((r) => r.id === line.id) + 1]
              if (advance) {
                setExtraDraft({
                  line: following ?? { ...blankEstimateLine(crypto.randomUUID()), unitPrice: 0 },
                  isNew: !following,
                  initialKey: 'name',
                  blanks: 0
                })
              } else setExtraDraft(null)
              setPage(
                estimateSheets(next)
                  .filter((s) => s.kind === 'cover')
                  .findIndex((s) =>
                    s.extraIds?.includes(following && advance ? following.id : line.id)
                  )
              )
            } catch (e) {
              return e instanceof Error ? e.message : '入力内容を確認してください。'
            }
          }}
        />
      )}
      {rowDraft && (
        <EstimateRowDialog
          key={rowDraft.line.id}
          line={rowDraft.line}
          body={body}
          isNew={rowDraft.isNew}
          initialKey={rowDraft.initialKey}
          canNext={canNext}
          catalog={catalog}
          apply={applyRow}
          close={() => setRowDraft(null)}
          remove={
            rowDraft.isNew
              ? undefined
              : () => {
                  setDeleteId(rowDraft.line.id)
                  setRowDraft(null)
                }
          }
        />
      )}
      {pdf && (
        <EstimatePdfDialog
          request={{ id, revision: doc.revision, output }}
          close={() => setPdf(false)}
        />
      )}
      {masterOpen && (
        <MaterialManager projectId={doc.projectId} close={() => setMasterOpen(false)} />
      )}
      {issuerDraft && (
        <EstimateIssuerDialog
          initial={issuerDraft}
          close={() => setIssuerDraft(null)}
          apply={(identity) => {
            update({ issuer: companyIssuer(identity), issuerCompany: identity })
            setIssuerDraft(null)
          }}
        />
      )}
      {discard && (
        <TakeoffDialog title="未保存の変更があります" close={() => setDiscard(null)}>
          <div className="summary-edit-form">
            <p>入力中の変更を破棄して移動しますか？</p>
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
      {deleteId && (
        <TakeoffDialog title="見積明細を削除しますか？" close={() => setDeleteId('')}>
          <div className="summary-edit-form">
            <p>
              {(deleteId.startsWith('extra:')
                ? coverExtraLinesFor(body).find((l) => l.id === deleteId.slice(6))
                : body.lines.find((l) => l.id === deleteId)
              )?.name || '名称未入力'}
            </p>
            <div className="summary-edit-actions">
              <button className="secondary" onClick={() => setDeleteId('')}>
                キャンセル
              </button>
              <button
                className="primary"
                onClick={() => {
                  const b = current.current!
                  if (deleteId.startsWith('extra:')) {
                    change({
                      ...b,
                      expenses: 0,
                      coverExtras: coverExtraLinesFor(b).filter((l) => l.id !== deleteId.slice(6))
                    })
                    setDeleteId('')
                    return
                  }
                  change(
                    removeEstimateLine(b, deleteId, () =>
                      blankEstimateLine(
                        crypto.randomUUID(),
                        b.lines.find((l) => l.id === deleteId)?.section ?? '',
                        '1'
                      )
                    )
                  )
                  setSelected('')
                  setDeleteId('')
                }}
              >
                この明細を削除
              </button>
            </div>
          </div>
        </TakeoffDialog>
      )}
      {source && (
        <TakeoffDialog title="見積の作成元" close={() => setSource(false)}>
          <div className="summary-edit-form">
            <p>
              {doc.source.view} · {doc.source.scope}
            </p>
            <p>作成時の数量を保存しています。拾い出しを更新しても保存済みの見積は変わりません。</p>
            <div className="estimate-source-list">
              {doc.source.lines.map((l) => (
                <p key={l.lineId}>
                  {l.room} · {l.name} · {l.quantity}
                </p>
              ))}
            </div>
          </div>
        </TakeoffDialog>
      )}
    </section>
  )
}
