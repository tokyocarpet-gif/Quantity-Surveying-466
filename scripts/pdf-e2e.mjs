import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export async function inspectPdf(bytes, landscape = false) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await task.promise
  try {
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const size = page.getViewport({ scale: 1 })
      assert.ok(
        Math.abs(size.width - (landscape ? 841.89 : 595.28)) < 2 &&
          Math.abs(size.height - (landscape ? 595.28 : 841.89)) < 2,
        'A4の用紙サイズ'
      )
      const content = await page.getTextContent()
      pages.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => item.str)
          .join('')
          .normalize('NFKC')
          // macOSの埋め込みフォントは「長」を同じ字形の部首文字で返すことがある。
          .replaceAll('⻑', '長')
      )
    }
    return pages
  } finally {
    await task.destroy()
  }
}

export async function exercisePdf(page, application, temporary) {
  await page.getByRole('button', { name: '見積一覧', exact: true }).click()
  await page.locator('.estimate-card').filter({ hasText: '本社ビル 御見積書' }).click()
  const pdfButton = page.getByRole('button', { name: 'PDFプレビュー', exact: true })
  await page.getByLabel('見積名', { exact: true }).fill('未保存の変更')
  await expect(pdfButton).toBeDisabled()
  await page.getByLabel('見積名', { exact: true }).fill('本社ビル 御見積書')
  await pdfButton.click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await expect(page.getByLabel('見積PDF 1ページ', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/25-estimate-pdf-preview.png' })
  const path = join(temporary, '見積書.pdf')
  writeFileSync(path, 'existing-file')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: path })
  }, path)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled()
  assert.equal(readFileSync(path, 'utf8'), 'existing-file')
  await expect(page.getByText(/PDFを保存しました/)).toHaveCount(0)
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  const saved = readFileSync(path)
  const normal = await inspectPdf(saved, true)
  assert.equal(normal.length, 3)
  assert.match(normal.join(''), /25,600/)
  assert.match(normal.join(''), /12\.3/)
  assert.match(normal[0], /有効期限/)
  assert.match(normal[0], /9月末・別途打合せ/)
  assert.match(normal[0], /販売センター内装仕上工事/)
  assert.doesNotMatch(normal[0], /新規ボード下地として/)
  assert.match(normal[1], /新規ボード下地として/)
  assert.match(normal[2], /運搬・搬入を含む/)
  assert.doesNotMatch(normal.join(''), /消費税|税込/)
  writeFileSync('test-results/estimate-normal.pdf', saved)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByLabel('見積の保存履歴', { exact: true }).selectOption('1')
  await pdfButton.click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  await expect(page.getByText(/PDFを保存しました/)).toBeVisible()
  assert.match((await inspectPdf(readFileSync(path), true)).join(''), /67,500/)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '見積一覧へ戻る', exact: true }).click()
  await page.getByRole('button', { name: '案件へ戻る', exact: true }).click()

  const doc = await page.evaluate(async () => {
    const unwrap = (r) => {
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
    const w = unwrap(await window.sekisan.workspace())
    const request = {
      projectId: w.projects[0].id,
      view: 'room-finish',
      drawingId: null,
      pageNumber: null,
      groupId: null,
      category: null,
      issue: 'all',
      query: ''
    }
    const report = unwrap(await window.sekisan.readSummary(request))
    const doc = unwrap(
      await window.sekisan.createEstimate({ request, fingerprint: report.fingerprint })
    )
    const body = {
      ...doc.body,
      title: 'PDF複数ページ確認',
      taxRate: 10,
      memo: '長い備考\n'.repeat(100),
      lines: Array.from({ length: 70 }, (_, i) => ({
        id: crypto.randomUUID(),
        room: `会議室${i + 1}`,
        category: i % 2 ? 'floor' : 'ルーバー',
        name: `明細番号${String(i + 1).padStart(3, '0')} ${i === 0 ? '<script>文字列</script>' : 'タイルカーペット'}`,
        specification: i === 1 ? '長い仕様・規格の折り返し確認'.repeat(12) : '500×500・厚6.5mm',
        section: i < 45 ? '販売センター内装仕上工事' : 'モデルルーム内装仕上工事',
        note:
          i === 1
            ? '長い備考の折り返し確認'.repeat(35)
            : `施工条件${String(i + 1).padStart(3, '0')}`,
        quantity: i === 2 ? '-1.0' : '12.3',
        unit: i % 2 ? '㎡' : '本',
        unitPrice: 1234.5
      }))
    }
    return unwrap(await window.sekisan.saveEstimate({ id: doc.id, expectedRevision: 1, body }))
  })
  await page.getByRole('button', { name: '見積一覧', exact: true }).click()
  await page.locator('.estimate-card').filter({ hasText: 'PDF複数ページ確認' }).click()
  await pdfButton.click()
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000
  })
  await page.getByLabel('見積PDFのページ', { exact: true }).selectOption('2')
  await expect(page.locator('.estimate-pdf-paper')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByLabel('見積PDF 2ページ', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/26-estimate-pdf-page2.png' })
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '見積一覧へ戻る', exact: true }).click()
  await page.getByRole('button', { name: '案件へ戻る', exact: true }).click()
  const result = await page.evaluate(
    (doc) => window.sekisan.previewEstimatePdf({ id: doc.id, revision: doc.revision }),
    doc
  )
  assert.equal(result.ok, true, result.error)
  const bytes = Buffer.from(result.data.bytes)
  const pages = await inspectPdf(bytes, true),
    all = pages.join('')
  assert.ok(pages.length >= 4)
  for (let i = 1; i <= 70; i++)
    assert.equal(
      all.split(`明細番号${String(i).padStart(3, '0')}`).length - 1,
      1,
      `明細${i}が欠落・重複しない`
    )
  for (const text of pages.filter((text) => text.includes('明細番号'))) {
    assert.match(text, /仕上げ・明細/, '明細ページに見出しを繰り返す')
    assert.match(text, /内訳明細書/, '工事名と帳票名を繰り返す')
    assert.match(text, /備考/)
  }
  for (let i = 1; i <= 70; i++)
    if (i !== 2) assert.equal(all.split(`施工条件${String(i).padStart(3, '0')}`).length - 1, 1)
  writeFileSync('test-results/estimate-multipage.pdf', bytes)
  assert.equal(all.split('長い備考の折り返し確認').length - 1, 35, '長い明細備考を欠落なく出力する')
  assert.match(all, /上記明細の備考/)
  assert.match(all, /<script>文字列<\/script>/)
  assert.match(all, new RegExp(doc.totals.subtotal.replace(/\B(?=(\d{3})+(?!\d))/g, ',')))
  assert.doesNotMatch(all, /消費税|税込/)
  // Save exactly the bytes that were previewed, even after the estimate gets a newer version.
  const updated = await page.evaluate(
    (doc) =>
      window.sekisan.saveEstimate({
        id: doc.id,
        expectedRevision: doc.revision,
        body: { ...doc.body, title: '更新後', lines: [{ ...doc.body.lines[0], unitPrice: null }] }
      }),
    doc
  )
  assert.equal(updated.ok, true)
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
  const written = await page.evaluate(
    (token) => window.sekisan.savePdfPreview(token),
    result.data.token
  )
  assert.equal(written.ok, true, written.error)
  assert.deepEqual(readFileSync(path), bytes)
  await page.evaluate((token) => window.sekisan.closePdfPreview(token), result.data.token)
  const expired = await page.evaluate(
    (token) => window.sekisan.savePdfPreview(token),
    result.data.token
  )
  assert.equal(expired.ok, false)
  const missing = await page.evaluate(
    (doc) => window.sekisan.previewEstimatePdf({ id: doc.id, revision: doc.revision }),
    updated.data
  )
  assert.equal(missing.ok, true, missing.error)
  assert.match((await inspectPdf(Buffer.from(missing.data.bytes), true)).join(''), /未確定/)
  writeFileSync('test-results/estimate-unpriced.pdf', Buffer.from(missing.data.bytes))
  await page.evaluate((token) => window.sekisan.closePdfPreview(token), missing.data.token)
  console.log(
    `PASS PDF: プレビュー・保存・キャンセル・過去版 / A4 ${pages.length}ページ / 明細70件・文字エスケープ・金額一致 / 未設定単価 / プレビューと保存の一致`
  )
}
