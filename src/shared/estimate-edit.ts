import {
  estimateBodySchema,
  estimatePresentation,
  type EstimateBody,
  type EstimateLine
} from './estimate'
import { displayQuantity } from './summary'

export const estimateGridKeys = [
  'itemNo',
  'name',
  'room',
  'category',
  'specification',
  'specification2',
  'specification3',
  'manufacturer',
  'quantity',
  'unit',
  'unitPrice',
  'note'
] as const
export function blankEstimateLine(id: string, section = '', itemNo = ''): EstimateLine {
  return {
    id,
    itemNo,
    room: '',
    category: '',
    name: '',
    specification: '',
    section,
    note: '',
    quantity: '1.0',
    unit: '式',
    unitPrice: null
  }
}
export function parseEstimateValue(key: string, raw: string): string | number | null {
  if (['quantity', 'unitPrice', 'expenses'].includes(key)) {
    const value = raw.normalize('NFKC').replace(/[,，\s￥¥円]/g, '')
    if (!value && key === 'unitPrice') return null
    if (!value && key === 'expenses') return 0
    if (!/^-?\d+(?:\.\d+)?$/.test(value))
      throw new Error('数量・単価・諸経費は数値で入力してください。')
    const n = Number(value)
    if (!Number.isFinite(n) || (key !== 'quantity' && n < 0))
      throw new Error('単価・諸経費は0以上で入力してください。')
    return key === 'quantity'
      ? displayQuantity(n.toFixed(3))
      : key === 'expenses'
        ? Math.round(n)
        : n
  }
  const parts: Record<string, string> = {
    天井: 'ceiling',
    壁: 'wall',
    床: 'floor',
    巾木: 'baseboard'
  }
  return key === 'category' ? (parts[raw] ?? raw) : raw
}
// Excel quotes embedded tabs, newlines and quotation marks in TSV clipboard data.
export function parseEstimateTsv(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error('貼り付ける範囲が大きすぎます。')
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === '"' && (quoted || !cell)) {
      if (quoted && input[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (c === '\t' || c === '\n')) {
      row.push(cell)
      cell = ''
      if (c === '\n') {
        rows.push(row)
        row = []
      }
    } else cell += c
  }
  if (quoted) throw new Error('貼り付けデータの引用符が閉じていません。')
  if (cell || row.length || !rows.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
export function pasteEstimate(
  body: EstimateBody,
  startId: string,
  startKey: string,
  text: string,
  ids: () => string
): EstimateBody {
  const result = structuredClone(body),
    p = estimatePresentation(result),
    rows = parseEstimateTsv(text)
  const sheet = result.detailSheets?.find((s) => s.lineIds.includes(startId))
  const visible =
    p.mode === 'detail' && sheet
      ? sheet.lineIds.map((id) => result.lines.find((l) => l.id === id)!)
      : result.lines.filter((l) => p.mode === 'detail' || p.coverLineIds.includes(l.id))
  const start = visible.findIndex((l) => l.id === startId)
  if (start < 0) throw new Error('貼り付け先の明細がありません。')
  const columns: (string | null)[] = [
    'itemNo',
    'name',
    'specification',
    'quantity',
    'unit',
    'unitPrice',
    null,
    'note'
  ]
  const offset = columns.indexOf(startKey),
    keys = offset < 0 ? [startKey] : columns.slice(offset)
  if (rows.some((row) => row.length > keys.length))
    throw new Error('貼り付ける列数が帳票の残り列数を超えています。')
  if (p.mode === 'cover' && start + rows.length > 12)
    throw new Error('表紙は12行までです。内訳書形式で入力してください。')
  if (p.mode === 'detail' && sheet && start + rows.length > 23)
    throw new Error('内訳明細書は23行までです。「内訳明細書を追加」から追加してください。')
  for (let r = 0; r < rows.length; r++) {
    let line = visible[start + r]
    if (!line) {
      const target =
        p.mode === 'detail' ? sheet : result.detailSheets?.find((s) => s.lineIds.length < 23)
      if (result.detailSheets && !target)
        throw new Error('入力枠がありません。内訳明細書を追加してください。')
      line = blankEstimateLine(ids(), visible[start].section, String(result.lines.length + 1))
      result.lines.push(line)
      visible.push(line)
      target?.lineIds.push(line.id)
      if (p.mode === 'cover') p.coverLineIds.push(line.id)
    }
    for (let c = 0; c < rows[r].length; c++) {
      const key = keys[c]
      if (key)
        (line as unknown as Record<string, unknown>)[key] = parseEstimateValue(key, rows[r][c])
    }
  }
  return estimateBodySchema.parse(result)
}
