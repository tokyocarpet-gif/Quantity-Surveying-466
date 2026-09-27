import {
  WallPanelSummary,
  WallPanelSpecification,
  WallPanelSchedule
} from '../shared/WallPanelSchedule'
import { wallKinds } from '../shared/wall-panels'
import { renderToStaticMarkup } from 'react-dom/server'
import { WallElevation } from '../shared/WallElevation'
import { matchLabels } from '../shared/wall-layout'
import type { wallReport } from './wall-layout-storage'
type WallReport = ReturnType<typeof wallReport>
export function wallPrintHtml(input: WallReport | WallReport[]): string {
  const reports = Array.isArray(input) ? input : [input]
  if (!reports.length) throw new Error('出力する壁を選択してください。')
  return (
    '<!doctype html>' +
    renderToStaticMarkup(
      <html lang="ja">
        <head>
          <meta charSet="utf-8" />
          <style>{`
    .wall-report + .wall-report, .wall-batch-summary + .wall-report {break-before:page}
    .wall-context{text-align:left;font-weight:bold;background:#edf4f0}
    .batch-list td:first-child,.batch-list td:nth-child(2),.batch-list td:nth-child(3){text-align:left}
    td,th,p,h1 {overflow-wrap:anywhere} .batch-list{table-layout:fixed}
    @page {size:A4 landscape;margin:12mm} body {font-family:Arial,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#243c30;font-size:11px} h1 {font-size:21px;margin:0 0 8px} h2{font-size:15px} p{margin:6px 0} .drawing{break-inside:avoid} .drawing svg{height:88mm} table{width:100%;border-collapse:collapse;margin-top:12px} td,th{border:1px solid #b6c6be;padding:5px;text-align:right} th{background:#edf4f0} thead{display:table-header-group} tr{break-inside:avoid} .note{font-size:10px;color:#596c61} .totals{font-size:15px;font-weight:bold}.wall-totals{display:flex;gap:20px;font-size:15px;margin:10px 0}
  `}</style>
        </head>
        <body>
          {Array.isArray(input) && <WallBatchSummary reports={reports} />}
          {reports.map((report) => (
            <section className="wall-report" key={report.input.id}>
              <WallReportContent report={report} />
            </section>
          ))}
        </body>
      </html>
    )
  )
}

function WallReportContent({ report }: { report: WallReport }) {
  const b = report.input.body,
    r = report.result
  return (
    <>
      <h1>{r.panel ? wallKinds[b.kind ?? 'wallpaper'] : '壁クロス'}割り付け・使用材料</h1>
      <p>
        {report.drawing.projectName} ／ {report.drawing.name} ／ {report.input.pageNumber}ページ ／{' '}
        {b.name}
      </p>
      {r.panel ? (
        <>
          <p>{b.materialName}</p>
          <WallPanelSpecification body={b} />
        </>
      ) : (
        <>
          <p>
            {b.materialName} · 有効幅 {b.material.widthMm}mm · 縦リピート {b.material.repeatMm}
            mm · 横リピート {b.material.horizontalRepeatMm}mm · {matchLabels[b.material.match]}
            {b.material.match === 'step' ? `（ずれ ${b.material.stepMm}mm）` : ''}
          </p>
          <p>
            貼り始め：{b.startSide === 'right' ? '右から' : '左から'} · 壁高さ {b.heightMm}mm ·
            上下切りしろ {b.topTrimMm} / {b.bottomTrimMm}mm · 貼り始めのずらし {b.offsetMm}mm ·
            巻き長さ {b.material.rollLengthMm ? `${b.material.rollLengthMm / 1000}m` : '未設定'}
          </p>
        </>
      )}
      <div className="drawing">
        <WallElevation body={b} result={r} />
      </div>
      {r.panel ? (
        <>
          <WallPanelSummary result={r.panel} />
          <WallPanelSchedule result={r.panel} heading={`${b.name} ／ ${b.materialName}`} />
        </>
      ) : (
        <>
          <p className="totals">
            施工面積 {r.netArea.toFixed(1)}㎡ ／ {r.drops.filter((d) => !d.skipped).length}巾 ／
            裁断計 {(r.cutMm / 1000).toFixed(1)}m ＋ 柄出し等 {(r.wasteMm / 1000).toFixed(1)}m ＝
            必要長さ {(r.usedMm / 1000).toFixed(1)}m
            {r.rollCount !== null ? ` ／ ${r.rollCount}巻` : ''}
          </p>
          <p className="note">
            開口の面積を控除。材料は原則全高で計算し、巾全体が床から天井まで開口の場合のみ除外。端材の再利用は含みません。柄合わせ時は縦リピート単位で裁断し、巻き始めの柄出しに最大1リピートを確保した余裕込みの数量です。横リピートは仕様表示用です。特殊な柄はメーカーの柄合わせ指定を確認してください。
          </p>
          <table>
            <thead>
              <tr>
                <th className="wall-context" colSpan={6}>
                  {b.name} ／ {b.materialName}
                </th>
              </tr>
              <tr>
                <th>巾番号</th>
                <th>施工幅 mm</th>
                <th>裁断長 mm</th>
                <th>柄ずれ mm</th>
                <th>柄出し等 mm</th>
                <th>巻番号</th>
              </tr>
            </thead>
            <tbody>
              {r.drops.map((d) => (
                <tr key={d.number}>
                  <td>
                    {d.number}
                    {d.skipped ? '（開口）' : ''}
                  </td>
                  <td>{d.widthMm.toFixed(0)}</td>
                  <td>{Number(d.cutMm.toFixed(3))}</td>
                  <td>{d.phaseMm}</td>
                  <td>{Number(d.wasteMm.toFixed(3))}</td>
                  <td>{d.roll || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.rollCount !== null && (
            <p>
              {r.rolls
                .map(
                  (roll, i) =>
                    `第${i + 1}巻：${(roll.usedMm / 1000).toFixed(1)}m使用 ／ 残り${((b.material.rollLengthMm! - roll.usedMm) / 1000).toFixed(1)}m`
                )
                .join('　・　')}
            </p>
          )}
        </>
      )}
    </>
  )
}
function WallBatchSummary({ reports }: { reports: WallReport[] }) {
  const totalArea = reports.reduce((sum, r) => sum + r.result.netArea, 0)
  const wallpaper = reports.filter((r) => !r.result.panel)
  const tiles = reports.filter((r) => r.input.body.kind === 'tile')
  const protection = reports.filter((r) => r.input.body.kind === 'protection')
  return (
    <section className="wall-batch-summary">
      <h1>壁材割り付け・選択面の数量一覧</h1>
      <p>
        {reports[0].drawing.projectName} ／ {reports[0].drawing.name} ／{' '}
        {reports[0].input.pageNumber}ページ
      </p>
      <p className="totals">
        選択 {reports.length}面 ／ 施工面積合計 {totalArea.toFixed(1)}㎡
      </p>
      <table className="batch-list">
        <colgroup>
          <col style={{ width: '23%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '22%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>部屋・壁面</th>
            <th>種類</th>
            <th>材料名</th>
            <th>施工面積</th>
            <th>使用材料数量</th>
          </tr>
        </thead>
        <tbody>
          {reports.map(({ input: { id, body: b }, result: r }) => (
            <tr key={id}>
              <td>{b.name}</td>
              <td>{wallKinds[b.kind ?? 'wallpaper']}</td>
              <td>{b.materialName}</td>
              <td>{r.netArea.toFixed(1)}㎡</td>
              <td>
                {r.panel
                  ? `${r.panel.count}枚`
                  : `${(r.usedMm / 1000).toFixed(1)}m${r.rollCount !== null ? ` ／ ${r.rollCount}巻` : ''}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {wallpaper.length > 0 && (
        <p>
          クロス必要長さ合計：
          {(wallpaper.reduce((s, r) => s + r.result.usedMm, 0) / 1000).toFixed(1)}m
        </p>
      )}
      {tiles.length > 0 && (
        <p>壁タイル必要元材合計：{tiles.reduce((s, r) => s + r.result.panel!.count, 0)}枚</p>
      )}
      {protection.length > 0 && (
        <p>養生板必要元材合計：{protection.reduce((s, r) => s + r.result.panel!.count, 0)}枚</p>
      )}
      <p className="note">
        数量は各面の計算結果を合算しています。材料や規格ごとの内訳は各面の明細をご確認ください。面をまたぐ巻き分け・端材の再利用は行っていません。
      </p>
      <p className="note">次ページから、一覧の順に各面の展開図と材料明細を掲載しています。</p>
    </section>
  )
}
