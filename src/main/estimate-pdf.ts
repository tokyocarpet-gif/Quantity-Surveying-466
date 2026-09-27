import { BrowserWindow, session } from 'electron'
import type { EstimateDoc } from '../shared/estimate'
import { escapeHtml, estimatePrintHtml } from './estimate-print'
import { estimatePaperOverflows } from '../shared/estimate-layout'

/** A separate sandbox renders escaped, self-contained HTML without access to app IPC or files. */
export function renderEstimatePdf(
  doc: EstimateDoc,
  output?: { cover: boolean; detail: boolean },
  printer = false
): Promise<Buffer> {
  return renderReportPdf(estimatePrintHtml(doc, output), {
    footer: '',
    landscape: true,
    fixedPage: true,
    printer
  })
}

export async function renderReportPdf(
  html: string,
  options: { footer: string; landscape: boolean; fixedPage?: boolean; printer?: boolean }
): Promise<Buffer> {
  const printSession = session.fromPartition('estimate-print')
  printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  printSession.setPermissionCheckHandler(() => false)
  printSession.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel:
        !details.url.startsWith('data:text/html;') &&
        !details.url.startsWith('data:image/png;base64,')
    })
  )
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      session: printSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: !!options.fixedPage,
      webviewTag: false
    }
  })
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  printWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        if (options.fixedPage) {
          const overflow = await printWindow.webContents.executeJavaScriptInIsolatedWorld(999, [
            {
              code: `Array.from(document.querySelectorAll('.estimate-paper')).findIndex(${estimatePaperOverflows.toString()})`
            }
          ])
          if (overflow >= 0)
            throw new Error(
              `${overflow + 1}ページの文字量がA4の範囲を超えています。文章を短くするか、内訳書形式に変更してください。`
            )
        }
        if (options.printer) {
          // The user may take time choosing a printer; only rendering has a timeout.
          clearTimeout(timer)
          await new Promise<void>((resolve, reject) =>
            printWindow.webContents.print(
              {
                silent: false,
                printBackground: true,
                landscape: options.landscape,
                pageSize: 'A4',
                margins: { marginType: 'none' }
              },
              (success, reason) =>
                success || /cancel/i.test(reason)
                  ? resolve()
                  : reject(new Error(reason || '印刷できませんでした。'))
            )
          )
          return Buffer.alloc(0)
        }
        const data = await printWindow.webContents.printToPDF({
          pageSize: 'A4',
          landscape: options.landscape,
          printBackground: true,
          preferCSSPageSize: true,
          margins: options.fixedPage
            ? { top: 0, bottom: 0, left: 0, right: 0 }
            : { top: 0.55, bottom: 0.65, left: 0.55, right: 0.55 },
          displayHeaderFooter: !options.fixedPage,
          headerTemplate: '<span></span>',
          footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#666">${escapeHtml(options.footer)}　·　<span class="pageNumber"></span> / <span class="totalPages"></span></div>`
        })
        if (data.length > 64 * 1024 * 1024)
          throw new Error('PDFが大きすぎます。対象を絞って出力してください。')
        return data
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('PDFの作成に時間がかかっています。もう一度お試しください。')),
          60000
        )
      })
    ])
  } finally {
    clearTimeout(timer)
    printWindow.destroy()
  }
}
