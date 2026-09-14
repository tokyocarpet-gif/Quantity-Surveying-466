import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { emptyCompany } from '../src/shared/business'
import {
  aggregateSummary,
  summaryRequestSchema,
  summaryViews,
  type SummarySource,
  type SummaryReport
} from '../src/shared/summary'
import { summaryPrintHtml, summaryPdfName } from '../src/main/summary-print'

const source: SummarySource = {
  id: randomUUID(),
  roomId: randomUUID(),
  groupId: randomUUID(),
  roomName: '会議室',
  roomOrdinal: 1,
  partNumber: 1,
  drawingId: randomUUID(),
  drawingName: '平面図.pdf',
  pageNumber: 1,
  category: 'floor',
  unit: '㎡',
  finish: 'タイルカーペット',
  specification: '500×500',
  unitPrice: 1000,
  rawQuantity: 13.333,
  rawDeduction: 1,
  rawNet: 12.333,
  fixed: false,
  source: 'auto-room'
}
function fixture(
  view: (typeof summaryViews)[number],
  overrides: Partial<SummarySource> = {}
): SummaryReport {
  const request = summaryRequestSchema.parse({ projectId: randomUUID(), view })
  return {
    ...aggregateSummary([{ ...source, ...overrides }], request),
    request,
    projectName: '内装改修',
    clientName: '顧客',
    drawings: [{ id: source.drawingId, name: source.drawingName, pageCount: 2 }],
    rooms: [
      {
        id: source.groupId!,
        name: source.roomName,
        drawingId: source.drawingId,
        pageNumber: 1,
        ordinal: 1
      }
    ],
    totalItemCount: 1,
    fingerprint: '0'.repeat(64),
    generatedAt: '2026-09-12T00:00:00Z'
  }
}

test('4形式の集計積算書は集計の金額と小数1桁数量を使い、図面・条件・自社・担当を示す', () => {
  for (const view of summaryViews) {
    const report = fixture(view),
      html = summaryPrintHtml(report, { ...emptyCompany(), name: '施工会社' }, '山田 太郎')
    assert.match(html, /集計積算書/)
    assert.match(html, /12,333/)
    assert.doesNotMatch(html, /12,300/)
    assert.match(html, /12\.3/)
    assert.match(html, /13\.3/)
    assert.match(html, /500×500/)
    assert.match(html, /全図面/)
    assert.match(html, /施工会社/)
    assert.match(html, /山田 太郎/)
    assert.doesNotMatch(html, /消費税|税込/)
    if (view === 'room' || view === 'drawing') assert.match(html, /<tr class="section">/)
  }
})

test('未設定と0円・固定・負数を区別し、任意部位や単位と文字列を安全に印字する', () => {
  const missing = fixture('room-finish', {
    unitPrice: null,
    fixed: true,
    rawNet: -1.234,
    category: '柱型',
    unit: '個'
  })
  let html = summaryPrintHtml(missing, emptyCompany(), '')
  assert.match(html, /未確定/)
  assert.match(html, /単価未設定 1件/)
  assert.match(html, /固定 1件/)
  assert.match(html, /負数 1件/)
  assert.match(html, /-1\.2/)
  assert.match(html, /柱型/)
  assert.match(html, /個/)
  html = summaryPrintHtml(
    fixture('finish', { unitPrice: 0, finish: '<script>材料</script>' }),
    emptyCompany(),
    ''
  )
  assert.doesNotMatch(html, /未確定|<script>/)
  assert.match(html, /&lt;script&gt;/)
  const report = fixture('room')
  report.projectName = 'a/b:c*?"<>|'
  assert.doesNotMatch(summaryPdfName(report), /[<>:"/\\|?*]/)
})
