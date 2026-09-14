import type { Storage } from './storage'
import { escapeHtml as text } from './estimate-print'
import { layoutTypeLabels, rollMaterialRows } from '../shared/layout'
import { dimensionLabel } from '../shared/roll-dimensions'
type Report = ReturnType<Storage['layoutReport']>

export function layoutPdfName(report: Report): string {
  return `割り付け_${Array.from(
    `${report.projectName}_${report.roomName}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  )
    .slice(0, 80)
    .join('')
    .replace(/[. ]+$/, '')}.pdf`
}
export function layoutPrintHtml(report: Report): string {
  const { input, result } = report,
    body = input.body,
    roll = result.roll
  const png = Buffer.from(input.diagram.slice('data:image/png;base64,'.length), 'base64')
  if (
    png.length < 24 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('割り付け図の画像を作り直してください。')
  const w = png.readUInt32BE(16),
    h = png.readUInt32BE(20)
  if (!w || !h || w > 3000 || h > 3000 || w * h > 5000000)
    throw new Error('割り付け図の画像サイズが上限を超えています。')
  const dimension = (n: number, axis: 'W' | 'L' = 'L') =>
    text(dimensionLabel(n, body.layoutType, axis))
  const area = (n: number) =>
    n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const metadata = `${text(report.projectName)} ／ ${text(report.roomName)}`
  const source = `${text(report.drawingName)} · ${report.pageNumber}ページ`
  const status = report.draft ? '画面の配置（未保存）' : `保存済み 第${input.expectedRevision}版`
  const metrics = roll
    ? `シート ${roll.strips.length}枚 ／ 使用L合計 ${dimension(roll.lengthM * 1000)} ／ 使用材料面積 ${area(roll.requiredArea)} ㎡`
    : `真物 ${result.full}枚 ／ 切り物 ${result.cut}枚 ／ 使用元材 ${result.full + result.cut}枚`
  const materials = roll
    ? `<h2>使用材料（W × L × 枚数）</h2><table><thead><tr><th>使用W</th><th>使用L</th><th>枚数</th><th>使用面積（㎡）</th></tr></thead><tbody>${rollMaterialRows(
        roll.strips
      )
        .map(
          (r) =>
            `<tr><td>${dimension(r.widthMm, 'W')}</td><td>${dimension(r.lengthMm)}</td><td>${r.sheets.length}</td><td>${area(r.area)}</td></tr>`
        )
        .join('')}</tbody></table>
    <h2>シート別内訳</h2><table><thead><tr><th colspan="7" class="scope">${metadata} ／ シート別内訳</th></tr><tr><th>シート</th><th>実測W</th><th>実測L</th><th>使用W</th><th>使用L</th><th>使用面積（㎡）</th><th>確認</th></tr></thead><tbody>${roll.strips.map((s) => `<tr><td>${s.number}</td><td>${dimension(s.widthMm, 'W')}</td><td>${dimension(s.lengthMm)}</td><td>${dimension(s.cutWidthMm, 'W')}</td><td>${dimension(s.cutLengthMm)}</td><td>${area((s.cutWidthMm * s.cutLengthMm) / 1e6)}</td><td>${s.overLength ? '最大出荷L超過' : ''}</td></tr>`).join('')}</tbody></table>`
    : `<h2>使用材料</h2><p>W ${dimension(body.widthMm, 'W')} × L ${dimension(body.heightMm!)} ／ 目地 ${body.gapMm} mm</p><p>${metrics}</p>`
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'"><title>割り付け図</title><style>
    @page {size:A4 landscape;} *{box-sizing:border-box;} body{margin:0;font-family:'Yu Gothic','Meiryo','Hiragino Kaku Gothic ProN',sans-serif;color:#233c30;font-size:9pt;line-height:1.4;}
    h1{font-size:18pt;margin:0 0 2mm;letter-spacing:.1em;} h2{font-size:11pt;margin:4mm 0 2mm;break-after:avoid;} p{margin:1mm 0;overflow-wrap:anywhere;} .metadata{font-size:10pt;white-space:pre-wrap;overflow-wrap:anywhere;} .source{font-size:8pt;color:#506858;}
    .figure{display:block;width:100%;height:100mm;object-fit:contain;margin:3mm 0;border:.2mm solid #d4ded8;} .metrics{padding:2mm 3mm;background:#edf4f0;font-size:11pt;} .note{font-size:8pt;color:#506858;} .warning{color:#a53030;font-weight:bold;}
    .details{break-before:page;} .conditions{white-space:pre-wrap;overflow-wrap:anywhere;border-block:.3mm solid #c4d4ca;padding:2mm 0;}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt;} thead{display:table-header-group;} th,td{border:.2mm solid #b6c9bd;padding:2mm;text-align:right;overflow-wrap:anywhere;} th{background:#edf4f0;font-weight:500;} .scope{text-align:left;font-size:8pt;} tr{break-inside:avoid;}
    </style></head><body><h1>割り付け図</h1><div class="metadata">${metadata}</div><p class="source">${source} ／ ${status}</p>
    <img class="figure" src="${input.diagram}" alt="保存対象の部屋の割り付け図">
    <p class="metrics">部屋面積 ${area(result.roomArea)} ㎡ ／ ${metrics}</p>
    <p class="note">図面は実測W・Lを表示。用紙に合わせて拡大・縮小しているため、記載寸法を参照してください。</p>
    ${roll?.overLength ? '<p class="warning">最大出荷Lを超えるシートがあります。使用寸法を確認してください。</p>' : ''}
    <section class="details"><h1>割り付け・使用材料内訳</h1><div class="metadata">${metadata}</div><p class="source">${source} ／ ${status}</p>
    <div class="conditions">材料：${text(body.materialName || '未設定')} ／ ${text(layoutTypeLabels[body.layoutType])}\n仕様・規格：${text(body.specification || '未設定')}
    ${roll ? `\n出荷方法：${roll.freeCut ? 'フリーカット' : '幅なり出荷'} ／ 最大出荷 W ${dimension(roll.maxWidthMm, 'W')} ／ L ${body.heightMm === null ? '未設定' : dimension(body.heightMm)}\n割付W ${dimension(body.widthMm, 'W')} ／ 切りしろ 両端各 ${body.trimMm} mm` : ''}
    </div><p>配置：${body.mode === 'wall' ? `壁${body.wallIndex + 1}から壁寄せ` : '部屋中心基準'} ／ 回転 ${body.angle}° ／ 横移動 ${body.offsetX} mm ／ 縦移動 ${body.offsetY} mm</p>
    ${materials}<p class="metrics">${metrics}</p>
    <p class="note">${roll ? '規格のW・Lは最大出荷寸法です。最大L全量を購入する計算ではありません。使用Lには切りしろを含みます。フリーカットの使用Wは実測幅をmm単位で切り上げます。幅なり出荷は最大出荷Wで算定します。' : '使用元材は各切り物へ1枚ずつ使用する場合の枚数です。'}<br>端材の再利用・柄合わせ・幅方向の重ね代・穴の控除は含みません。表示は丸めていますが計算は元の精度を使用します。</p>
    <p class="note">${text(report.company)}</p></section></body></html>`
}
