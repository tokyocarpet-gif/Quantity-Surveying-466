import { WallPanelFields } from './WallPanelFields'
import { WallPanelSummary, WallPanelSchedule } from '../../../shared/WallPanelSchedule'
import { defaultWallPanel, wallKinds } from '../../../shared/wall-panels'
import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Drawing } from '../../../shared/api'
import { distance, type PageState, type Point, type Room } from '../../../shared/takeoff'
import {
  computeWall,
  type WallBody,
  type WallDoc,
  type WallSave,
  type WallBatchPdfRequest
} from '../../../shared/wall-layout'
import { WallElevation } from '../../../shared/WallElevation'
import type { Material } from '../../../shared/materials'
import { unwrap } from '../store'
import { WallpaperFields, emptyWallpaper } from '../WallpaperFields'
import { MaterialManager } from '../MaterialManager'
import { WallPdfDialog, WallBatchPdfDialog } from '../EstimatePdfDialog'
import { TakeoffDialog } from './Dialogs'
import { PdfPage } from './PdfPage'
import { useWallWorkspace, WallSplitter } from './WallWorkspace'
import './wall.css'
export function WallEditor({
  drawing,
  pdf,
  state,
  navigation
}: {
  drawing: Drawing
  pdf: PDFDocumentProxy
  state: PageState
  navigation: (leave: (action: () => void) => void, busy: boolean) => React.JSX.Element
}) {
  const workspace = useWallWorkspace()
  const [docs, setDocs] = useState<WallDoc[]>([]),
    [materials, setMaterials] = useState<Material[]>([])
  const [body, setBody] = useState<WallBody | null>(null),
    [id, setId] = useState<string>(crypto.randomUUID()),
    [revision, setRevision] = useState(0),
    [baseline, setBaseline] = useState('null')
  const [history, setHistory] = useState<WallBody[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [pending, setPending] = useState<{ action: () => void; message?: string } | null>(null),
    [remove, setRemove] = useState(false),
    [master, setMaster] = useState(false),
    [request, setRequest] = useState<WallSave | null>(null)
  const [batchSelection, setBatchSelection] = useState<string[] | null>(null)
  const [batchRequest, setBatchRequest] = useState<WallBatchPdfRequest | null>(null)
  const [roomId, setRoomId] = useState(state.rooms[0]?.id ?? ''),
    [manual, setManual] = useState(false),
    [start, setStart] = useState<Point | null>(null),
    [cursor, setCursor] = useState<Point | null>(null),
    [zoom, setZoom] = useState(1)
  const address = { drawingId: drawing.id, pageNumber: state.pageNumber }
  const isPanel = body?.kind === 'tile' || body?.kind === 'protection'
  const dirty = JSON.stringify(body) !== baseline
  function leave(action: () => void) {
    if (dirty || start) setPending({ action })
    else action()
  }
  function edit(next: WallBody) {
    if (body) setHistory((h) => [...h.slice(-29), body])
    setBody(next)
    setNotice('')
    setError('')
  }
  function load(doc: WallDoc) {
    if (doc.body.roomId) setRoomId(doc.body.roomId)
    setBody(doc.body)
    setId(doc.id)
    setRevision(doc.revision)
    setBaseline(JSON.stringify(doc.body))
    setHistory([])
    setManual(false)
    setStart(null)
    setNotice('')
    setError('')
  }
  async function refreshMaterials() {
    const m = await unwrap(window.sekisan.readMaterials(drawing.projectId))
    setMaterials(m.project)
  }
  useEffect(() => {
    let active = true
    Promise.all([
      unwrap(window.sekisan.readWalls(address)),
      unwrap(window.sekisan.readMaterials(drawing.projectId))
    ])
      .then(([d, m]) => {
        if (active) {
          setDocs(d)
          setMaterials(m.project)
          if (d[0]) load(d[0])
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [drawing.id, state.pageNumber])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  let result: ReturnType<typeof computeWall> | null = null,
    invalid = ''
  if (body) {
    try {
      result = computeWall(body)
    } catch (e) {
      invalid = e instanceof Error ? e.message : '寸法を確認してください。'
      try {
        const issues = JSON.parse(invalid)
        invalid = issues.map((i: any) => i.message).join(' ／ ')
      } catch {}
    }
  }
  const room = state.rooms.find((r) => r.id === roomId)
  const stale =
    body &&
    (body.scale !== state.scaleRatio ||
      (body.roomId &&
        !state.rooms.some(
          (r) =>
            r.id === body.roomId &&
            r.polygon[body.edgeIndex!] &&
            [r.polygon[body.edgeIndex!], r.polygon[(body.edgeIndex! + 1) % r.polygon.length]].every(
              (p) => body.points.some((q) => q.x === p.x && q.y === p.y)
            )
        )))
  function create(points: [Point, Point], r: Room | null, index: number | null) {
    if (!state.scaleRatio) return
    const next: WallBody = {
      name: r ? `${r.name}・壁${index! + 1}` : `壁 ${docs.length + 1}`,
      points,
      roomId: r?.id ?? null,
      edgeIndex: index,
      scale: state.scaleRatio,
      heightMm: r?.heightMm ?? body?.heightMm ?? 2400,
      kind: body?.kind,
      startSide: 'right',
      panel: body?.panel ? { ...body.panel, bottomMm: 0, coverageHeightMm: null } : undefined,
      materialName: body?.materialName ?? '',
      material: body?.material ?? emptyWallpaper(),
      topTrimMm: 25,
      bottomTrimMm: 25,
      offsetMm: 0,
      openings: []
    }
    setBody(next)
    setId(crypto.randomUUID())
    setRevision(0)
    setBaseline('null')
    setHistory([])
    setStart(null)
    setManual(false)
    setError('')
    setNotice('')
  }
  const input = (): WallSave => ({ ...address, id, expectedRevision: revision, body: body! })
  async function save() {
    if (!body) return
    setBusy(true)
    setError('')
    try {
      const doc = await unwrap(window.sekisan.saveWall(input()))
      load(doc)
      setDocs((d) =>
        d.some((x) => x.id === doc.id) ? d.map((x) => (x.id === doc.id ? doc : x)) : [...d, doc]
      )
      setNotice('壁の割り付けを保存しました。')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const numberField = (
    key: 'heightMm' | 'topTrimMm' | 'bottomTrimMm' | 'offsetMm',
    label: string
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step="any"
        list={key === 'heightMm' ? 'wall-height-history' : undefined}
        value={body?.[key] ?? ''}
        onChange={(e) => edit({ ...body!, [key]: Number(e.target.value) })}
      />
    </label>
  )
  const wallLength = body ? distance(...body.points) * body.scale * 1000 : 0
  return (
    <section className="layout-screen wall-screen" aria-busy={busy}>
      {navigation(leave, busy)}
      <div className="wall-workspace" ref={workspace.ref} style={workspace.style}>
        <aside className="wall-settings" id="wall-settings">
          <fieldset disabled={busy || !!request}>
            <h2>壁の割り付け</h2>
            <label>
              保存した壁
              <select
                aria-label="保存した壁"
                value={revision ? id : ''}
                onChange={(e) => {
                  const doc = docs.find((d) => d.id === e.target.value)
                  if (doc) leave(() => load(doc))
                }}
              >
                <option value="" disabled>
                  平面図から新しく壁を選択
                </option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.body.name} ／ {wallKinds[d.body.kind ?? 'wallpaper']} ／{' '}
                    {d.body.materialName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={busy || dirty || !docs.length}
              onClick={() => setBatchSelection(docs.slice(0, 100).map((d) => d.id))}
            >
              壁を選んでまとめてPDF
            </button>
            {dirty && docs.length > 0 && (
              <p className="panel-description">
                まとめてPDFにする前に、編集中の壁を保存してください。
              </p>
            )}
            <label>
              平面図の部屋
              <select
                aria-label="展開する部屋"
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value)
                  setManual(false)
                  setStart(null)
                }}
              >
                <option value="">部屋を選択</option>
                {state.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="panel-description">
              平面図の壁をクリックすると、新しい展開図を作れます。赤い始点が展開図の左端です。
            </p>
            <button
              className={manual ? 'primary' : 'secondary'}
              onClick={() => {
                setManual(!manual)
                setStart(null)
              }}
            >
              {manual ? '2点指定をやめる' : '2点で壁を指定する'}
            </button>
            {!state.scaleRatio && <p role="alert">拾い出し画面で縮尺を設定してください。</p>}
            {body && (
              <>
                <label>
                  壁の名前
                  <input
                    maxLength={120}
                    value={body.name}
                    onChange={(e) => edit({ ...body, name: e.target.value })}
                  />
                </label>
                <div className="wall-measure">壁の長さ：{wallLength.toFixed(0)} mm</div>
                {numberField('heightMm', '壁の高さ（mm）')}
                <datalist id="wall-height-history">
                  {[
                    ...new Set([
                      ...state.rooms.map((r) => r.heightMm),
                      ...docs.map((d) => d.body.heightMm)
                    ])
                  ].map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
                <button
                  className="secondary"
                  onClick={() =>
                    edit({
                      ...body,
                      points: [body.points[1], body.points[0]],
                      openings: body.openings.map((o) => ({
                        ...o,
                        xMm: Math.max(0, wallLength - o.xMm - o.widthMm)
                      }))
                    })
                  }
                >
                  左右を反転する
                </button>
                <p className="panel-description">
                  壁の始点・終点と窓・ドアの左右位置を反転します。貼り始めの左右は下で指定します。
                </p>
                <label>
                  貼り始め
                  <select
                    aria-label="壁材の貼り始め"
                    value={body.startSide ?? 'left'}
                    onChange={(e) =>
                      edit({ ...body, startSide: e.target.value as 'left' | 'right' })
                    }
                  >
                    <option value="left">左から</option>
                    <option value="right">右から</option>
                  </select>
                </label>
                <p className="panel-description">
                  開口の位置はそのまま、選んだ側から材料を並べます。
                </p>
                <label>
                  材料の種類
                  <select
                    aria-label="壁材の種類"
                    value={body.kind ?? 'wallpaper'}
                    onChange={(e) => {
                      const kind = e.target.value as NonNullable<WallBody['kind']>
                      edit({
                        ...body,
                        kind,
                        panel:
                          kind === 'protection'
                            ? {
                                ...(body.panel ?? defaultWallPanel()),
                                pattern: 'straight',
                                gapMm: 0
                              }
                            : (body.panel ?? defaultWallPanel())
                      })
                    }}
                  >
                    {Object.entries(wallKinds).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                {isPanel ? (
                  <WallPanelFields
                    body={body}
                    materials={materials}
                    historyPanels={docs.flatMap((d) => (d.body.panel ? [d.body.panel] : []))}
                    edit={edit}
                    openMaster={() => setMaster(true)}
                  />
                ) : (
                  <>
                    <h3>クロス</h3>
                    <label>
                      物件マスタから選ぶ
                      <select
                        aria-label="壁クロスの材料"
                        value=""
                        onChange={(e) => {
                          const m = materials.find((m) => m.id === e.target.value)
                          if (m?.wallpaper)
                            edit({
                              ...body,
                              materialName: m.name,
                              material: { ...m.wallpaper },
                              offsetMm: 0
                            })
                        }}
                      >
                        <option value="">材料を選択</option>
                        {materials
                          .filter((m) => m.wallpaper)
                          .map((m) => (
                            <option value={m.id} key={m.id}>
                              {m.name}（幅 {m.wallpaper!.widthMm}
                              mm）
                            </option>
                          ))}
                      </select>
                    </label>
                    <button className="secondary" onClick={() => setMaster(true)}>
                      マスタ管理を開く
                    </button>
                    <label>
                      クロス名
                      <input
                        maxLength={120}
                        value={body.materialName}
                        onChange={(e) => edit({ ...body, materialName: e.target.value })}
                      />
                    </label>
                    <WallpaperFields
                      value={body.material}
                      onChange={(m) => edit({ ...body, material: m })}
                    />
                    <h3>貼り始め・切りしろ</h3>
                    {numberField('offsetMm', '貼り始めのずらし（mm）')}
                    <p className="panel-description">
                      0で{body.startSide === 'right' ? '右端' : '左端'}
                      から幅なり。ずらし量を増やすと、最初の巾が狭くなります。
                    </p>
                    {numberField('topTrimMm', '上の切りしろ（mm）')}
                    {numberField('bottomTrimMm', '下の切りしろ（mm）')}
                  </>
                )}
                <div className="wall-actions">
                  <button
                    className="secondary"
                    disabled={!history.length}
                    onClick={() => {
                      setBody(history.at(-1)!)
                      setHistory((h) => h.slice(0, -1))
                      setNotice('')
                    }}
                  >
                    ひとつ戻す
                  </button>
                  <button
                    className="secondary danger-text"
                    disabled={!revision}
                    onClick={() => setRemove(true)}
                  >
                    この壁を削除
                  </button>
                </div>
              </>
            )}
          </fieldset>
        </aside>
        <WallSplitter {...workspace.sidebar} label="設定欄の幅を調整" controls="wall-settings" />
        <div className="wall-main">
          <div className="wall-plan" id="wall-plan-region">
            <PdfPage
              pdf={pdf}
              pageNumber={state.pageNumber}
              zoom={zoom}
              onZoom={setZoom}
              resetView={state.pageNumber}
              fitHeight
              crosshair={manual ? cursor : null}
              pan={false}
              overlay={(view) => (
                <svg
                  className="wall-plan-overlay"
                  data-testid="wall-plan"
                  width={view.width * view.scale}
                  height={view.height * view.scale}
                  viewBox={`0 0 ${view.width} ${view.height}`}
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    let p = {
                      x: (e.clientX - rect.left) / view.scale,
                      y: (e.clientY - rect.top) / view.scale
                    }
                    if (start) {
                      const dx = Math.abs(p.x - start.x),
                        dy = Math.abs(p.y - start.y)
                      if (dy < dx * 0.12) p.y = start.y
                      else if (dx < dy * 0.12) p.x = start.x
                    }
                    setCursor(p)
                  }}
                  onPointerUp={(e) => {
                    if (e.button !== 0 || !manual || busy || !state.scaleRatio) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    let p = {
                      x: (e.clientX - rect.left) / view.scale,
                      y: (e.clientY - rect.top) / view.scale
                    }
                    if (start) {
                      const dx = Math.abs(p.x - start.x),
                        dy = Math.abs(p.y - start.y)
                      if (dy < dx * 0.12) p.y = start.y
                      else if (dx < dy * 0.12) p.x = start.x
                      if (distance(start, p) * state.scaleRatio * 1000 >= 1)
                        dirty
                          ? setPending({ action: () => create([start, p], null, null) })
                          : create([start, p], null, null)
                    } else setStart(p)
                  }}
                >
                  {room &&
                    room.polygon
                      .slice(0, room.polygon.length - (room.geometryType === 'wall-line' ? 1 : 0))
                      .map((p, i) => {
                        const q = room.polygon[(i + 1) % room.polygon.length]
                        return (
                          <g key={i}>
                            <line
                              x1={p.x}
                              y1={p.y}
                              x2={q.x}
                              y2={q.y}
                              stroke="#43836c"
                              strokeWidth={3 / view.scale}
                            />
                            <line
                              data-testid={`wall-edge-${i}`}
                              x1={p.x}
                              y1={p.y}
                              x2={q.x}
                              y2={q.y}
                              stroke="transparent"
                              strokeWidth={16 / view.scale}
                              onPointerUp={(e) => {
                                if (e.button !== 0 || manual || busy) return
                                e.stopPropagation()
                                leave(() => create([p, q], room, i))
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                            <text
                              x={(p.x + q.x) / 2}
                              y={(p.y + q.y) / 2 - 6 / view.scale}
                              fontSize={12 / view.scale}
                              fill="#255440"
                              pointerEvents="none"
                            >
                              壁{i + 1}
                            </text>
                          </g>
                        )
                      })}
                  {body && (
                    <g pointerEvents="none">
                      <line
                        x1={body.points[0].x}
                        y1={body.points[0].y}
                        x2={body.points[1].x}
                        y2={body.points[1].y}
                        stroke="#d06f37"
                        strokeWidth={5 / view.scale}
                      />
                      <circle
                        cx={body.points[0].x}
                        cy={body.points[0].y}
                        r={5 / view.scale}
                        fill="#bc3535"
                      />
                    </g>
                  )}
                  {start && cursor && (
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={cursor.x}
                      y2={cursor.y}
                      stroke="#bf6438"
                      strokeWidth={2 / view.scale}
                      strokeDasharray={`${6 / view.scale} ${3 / view.scale}`}
                    />
                  )}
                </svg>
              )}
            />
            <div className="wall-plan-hint">
              {manual
                ? start
                  ? '終点をクリックしてください'
                  : '始点をクリックしてください'
                : '壁をクリックして展開図を作成'}{' '}
              · ホイールでズーム · 右ドラッグでパン
            </div>
          </div>
          <WallSplitter
            {...workspace.plan}
            label="平面図と展開図の高さを調整"
            controls="wall-plan-region"
          />
          <div className="wall-details">
            {body ? (
              <>
                <div className="wall-title">
                  <h2>
                    {body.name}
                    {dirty ? '（未保存）' : ''}
                  </h2>
                  <div className="wall-actions">
                    <button
                      className="secondary"
                      disabled={busy || !result || !!stale}
                      onClick={() => setRequest(input())}
                    >
                      壁のPDFプレビュー・保存
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !result || !!stale}
                      onClick={() => void save()}
                    >
                      壁の割り付けを保存
                    </button>
                  </div>
                </div>
                {stale && (
                  <p role="alert" className="form-error">
                    参照する壁または縮尺が変わっています。平面図で壁を選び直してください。
                  </p>
                )}
                {invalid && (
                  <p role="alert" className="form-error">
                    {!isPanel && body.material.widthMm === 0
                      ? 'クロスの有効幅と材料名を入力するか、マスタから選んでください。'
                      : invalid}
                  </p>
                )}
                {!result && wallLength > 0 && body.heightMm > 0 && (
                  <WallElevation body={body} result={{ widthMm: wallLength, drops: [] }} />
                )}
                {result && (
                  <>
                    {result.panel ? (
                      <WallPanelSummary result={result.panel} />
                    ) : (
                      <div className="wall-totals" data-testid="wall-totals">
                        <span>
                          施工面積 <b>{result.netArea.toFixed(1)}㎡</b>
                        </span>
                        <span>
                          <b>{result.drops.filter((d) => !d.skipped).length}巾</b>
                        </span>
                        <span>
                          必要長さ <b>{(result.usedMm / 1000).toFixed(1)}m</b>
                        </span>
                        <span>
                          {result.rollCount === null ? '巻き長さ未設定' : `${result.rollCount}巻`}
                        </span>
                      </div>
                    )}
                    <WallElevation body={body} result={result} />
                    {!result.panel && (
                      <p className="panel-description">
                        裁断計 {(result.cutMm / 1000).toFixed(1)}m ＋ 柄出し・ステップ調整{' '}
                        {(result.wasteMm / 1000).toFixed(1)}
                        m。柄合わせ時は縦リピート単位で裁断し、巻き始めには最大1リピート分の余裕を確保します。
                      </p>
                    )}
                  </>
                )}
                <h3>窓・ドア</h3>
                <p className="panel-description">
                  {isPanel
                    ? '左端からの距離と床からの高さで配置します。施工範囲に重なる開口を控除し、開口だけに入る材料は除外します。切欠きや分割が残る材料は1枚と数えます。'
                    : '左端からの距離と床からの高さで配置します。施工面積から控除しますが、材料は原則全高で計算します。巾全体が床から天井まで開口の場合のみ除外し、端材は使い回しません。'}
                </p>
                <div className="wall-openings">
                  {body.openings.map((o, i) => (
                    <fieldset key={o.id} disabled={busy}>
                      <legend>開口 {i + 1}</legend>
                      <label>
                        開口名
                        <input
                          value={o.name}
                          maxLength={120}
                          onChange={(e) =>
                            edit({
                              ...body,
                              openings: body.openings.map((p) =>
                                p.id === o.id ? { ...p, name: e.target.value } : p
                              )
                            })
                          }
                        />
                      </label>
                      {(
                        [
                          ['xMm', '左端から（mm）'],
                          ['bottomMm', '床から（mm）'],
                          ['widthMm', '開口幅（mm）'],
                          ['heightMm', '開口高さ（mm）']
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={o[key]}
                            onChange={(e) =>
                              edit({
                                ...body,
                                openings: body.openings.map((p) =>
                                  p.id === o.id ? { ...p, [key]: Number(e.target.value) } : p
                                )
                              })
                            }
                          />
                        </label>
                      ))}
                      <button
                        className="text-button danger-text"
                        onClick={() =>
                          setPending({
                            message: 'この開口を削除します。続けますか？',
                            action: () =>
                              edit({
                                ...body,
                                openings: body.openings.filter((p) => p.id !== o.id)
                              })
                          })
                        }
                      >
                        開口を削除
                      </button>
                    </fieldset>
                  ))}
                </div>
                <button
                  className="secondary"
                  disabled={busy || body.openings.length >= 100}
                  onClick={() =>
                    edit({
                      ...body,
                      openings: [
                        ...body.openings,
                        {
                          id: crypto.randomUUID(),
                          name: `開口 ${body.openings.length + 1}`,
                          xMm: 0,
                          bottomMm: 0,
                          widthMm: Math.min(800, wallLength),
                          heightMm: Math.min(2000, body.heightMm)
                        }
                      ]
                    })
                  }
                >
                  窓・ドアを追加
                </button>
                {result?.panel && (
                  <>
                    <h3>材料・カット寸法一覧</h3>
                    <WallPanelSchedule result={result.panel} />
                  </>
                )}
                {result && !result.panel && (
                  <>
                    <h3>各巾の裁断寸法</h3>
                    <table className="wall-drop-table">
                      <thead>
                        <tr>
                          <th>巾</th>
                          <th>施工幅 mm</th>
                          <th>裁断長 mm</th>
                          <th>柄ずれ mm</th>
                          <th>柄出し等 mm</th>
                          <th>巻</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.drops.map((d) => (
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
                    {result.rollCount !== null && (
                      <p>
                        {result.rolls
                          .map(
                            (r, i) =>
                              `第${i + 1}巻：${(r.usedMm / 1000).toFixed(1)}m使用 ／ 残り${((body.material.rollLengthMm! - r.usedMm) / 1000).toFixed(1)}m`
                          )
                          .join('　・　')}
                      </p>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="wall-empty">
                <h2>平面図から壁を選んでください</h2>
                <p>部屋の辺をクリックするか、2点で壁を指定して展開図を作ります。</p>
              </div>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
          </div>
        </div>
      </div>
      {pending && (
        <TakeoffDialog title="操作の確認" close={() => setPending(null)} busy={false}>
          <div className="preview-body">
            <p>{pending.message ?? '未保存の編集を破棄して移動します。続けますか？'}</p>
          </div>
          <footer className="modal-footer">
            <button className="secondary" onClick={() => setPending(null)}>
              戻る
            </button>
            <button
              className="primary"
              onClick={() => {
                const action = pending.action
                setPending(null)
                action()
              }}
            >
              続ける
            </button>
          </footer>
        </TakeoffDialog>
      )}
      {remove && (
        <TakeoffDialog title="壁の割り付けを削除" close={() => setRemove(false)} busy={busy}>
          <div className="preview-body">
            <p>「{body?.name}」の割り付けを削除します。拾い出しの数量は保持します。</p>
          </div>
          <footer className="modal-footer">
            <button className="secondary" disabled={busy} onClick={() => setRemove(false)}>
              戻る
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await unwrap(window.sekisan.deleteWall({ id, expectedRevision: revision }))
                  setDocs((d) => d.filter((x) => x.id !== id))
                  setBody(null)
                  setBaseline('null')
                  setRevision(0)
                  setHistory([])
                  setRemove(false)
                } catch (e) {
                  setError((e as Error).message)
                  setRemove(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              削除する
            </button>
          </footer>
        </TakeoffDialog>
      )}
      {master && (
        <MaterialManager
          projectId={drawing.projectId}
          close={() => {
            setMaster(false)
            void refreshMaterials().catch((e) => setError(e.message))
          }}
        />
      )}
      {batchSelection && (
        <TakeoffDialog title="PDFにまとめる壁を選択" close={() => setBatchSelection(null)}>
          <div className="preview-body wall-batch-picker">
            <p>
              この図面の{state.pageNumber}ページに保存した壁から選択します。一覧の順に出力します。
            </p>
            <div className="wall-actions">
              <button
                className="secondary"
                disabled={docs.length > 100}
                onClick={() => setBatchSelection(docs.map((d) => d.id))}
              >
                すべて選択
              </button>
              <button className="secondary" onClick={() => setBatchSelection([])}>
                選択を解除
              </button>
            </div>
            <p>{batchSelection.length}面を選択（最大100面）</p>
            <div className="wall-batch-list">
              {docs.map((d) => (
                <label key={d.id}>
                  <input
                    type="checkbox"
                    checked={batchSelection.includes(d.id)}
                    disabled={batchSelection.length >= 100 && !batchSelection.includes(d.id)}
                    onChange={(e) =>
                      setBatchSelection(
                        e.target.checked
                          ? [...batchSelection, d.id]
                          : batchSelection.filter((id) => id !== d.id)
                      )
                    }
                  />
                  <span>
                    <strong>{d.body.name}</strong>
                    <small>
                      {wallKinds[d.body.kind ?? 'wallpaper']} ／ {d.body.materialName}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <p className="panel-description">
              先頭に数量一覧、続けて各面の展開図・材料明細を出力します。数量は各面の合算です。
            </p>
          </div>
          <footer className="modal-footer">
            <button className="secondary" onClick={() => setBatchSelection(null)}>
              戻る
            </button>
            <button
              className="primary"
              disabled={!batchSelection.length}
              onClick={() => {
                setBatchRequest({
                  ...address,
                  walls: docs
                    .filter((d) => batchSelection.includes(d.id))
                    .map((d) => ({ id: d.id, expectedRevision: d.revision }))
                })
                setBatchSelection(null)
              }}
            >
              選択した壁のPDFプレビュー
            </button>
          </footer>
        </TakeoffDialog>
      )}
      {batchRequest && (
        <WallBatchPdfDialog request={batchRequest} close={() => setBatchRequest(null)} />
      )}
      {request && <WallPdfDialog request={request} close={() => setRequest(null)} />}
    </section>
  )
}
