import { BrowserWindow, session } from 'electron'
import type { EstimateDoc } from '../shared/estimate'
import { escapeHtml, estimatePrintHtml } from './estimate-print'

/** A separate sandbox renders escaped, self-contained HTML without access to app IPC or files. */
export function renderEstimatePdf(doc: EstimateDoc): Promise<Buffer> {
  return renderReportPdf(estimatePrintHtml(doc), {
    footer: `第${doc.revision}版`,
    landscape: true
  })
}

export async function renderReportPdf(
  html: string,
  options: { footer: string; landscape: boolean }
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
      javascript: false,
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
        const data = await printWindow.webContents.printToPDF({
          pageSize: 'A4',
          landscape: options.landscape,
          printBackground: true,
          preferCSSPageSize: true,
          margins: { top: 0.55, bottom: 0.65, left: 0.55, right: 0.55 },
          displayHeaderFooter: true,
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
