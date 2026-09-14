import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw } from 'lucide-react'
import {
  computeLayout,
  defaultLayout,
  layoutBodySchema,
  layoutTypeLabels,
  layoutSourceKey,
  rotate,
  type LayoutBody,
  type LayoutDoc
} from '../../../shared/layout'
import { distance, type Room, type Point } from '../../../shared/takeoff'
import { materialSpecification, type MaterialContext } from '../../../shared/materials'
import { MaterialInput } from '../MaterialInput'
import { MaterialManager } from '../MaterialManager'
import { unwrap } from '../store'
import { PdfPage } from './PdfPage'
import { TakeoffDialog } from './Dialogs'
import { layoutWallDimensions } from '../../../shared/layout-dimensions'
import { LayoutDimensionsOverlay, dimensionText } from './LayoutDimensionsOverlay'
import { layoutImage } from './layout-image'
import { LayoutPdfDialog } from '../EstimatePdfDialog'
import type { LayoutPdfRequest } from '../../../shared/layout-pdf'
import '../estimate.css'
import { DimensionInput } from '../DimensionInput'
import { dimensionUnit, dimensionLabel } from '../../../shared/roll-dimensions'
import { RollOverlay, RollResults } from './RollLayoutView'
import './layout.css'
const shape = (points: Point[]): string => points.map((p) => `${p.x},${p.y}`).join(' ')
const toDraft = (body: LayoutBody): LayoutDraft => ({
  ...body,
  heightMm: body.heightMm ?? '',
  maxWidthMm: body.layoutType === 'tile' ? body.maxWidthMm : (body.maxWidthMm ?? body.widthMm)
})
type LayoutDraft = Omit<LayoutBody, 'widthMm' | 'heightMm'> & {
  widthMm: number | ''
  heightMm: number | ''
}
const emptyDraft = (room: Room): LayoutDraft => ({
  ...defaultLayout(),
  widthMm: '',
  heightMm: '',
  materialName: room.finishes.floor.name,
  specification: room.finishes.floor.specification ?? ''
})
export function LayoutEditor({
  room,
  scale,
  pdf,
  pageNumber,
  projectId,
  close,
  navigation,
  roomSelection
}: {
  room: Room
  scale: number
  pdf: PDFDocumentProxy
  pageNumber: number
  projectId: string
  close: () => void
  navigation: (leave: (action: () => void) => void, busy: boolean) => ReactNode
  roomSelection: (leave: (action: () => void) => void, busy: boolean) => ReactNode
}): React.JSX.Element {
  const [body, setBody] = useState<LayoutDraft>(() => emptyDraft(room))
  const initialBody = useRef<LayoutDraft | null>(null)
  const [saved, setSaved] = useState<LayoutDoc | null>(null),
    [loaded, setLoaded] = useState(false)
  const [catalog, setCatalog] = useState<MaterialContext | null>(null),
    [master, setMaster] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1),
    [reset, setReset] = useState(0),
    [step, setStep] = useState(10),
    [discard, setDiscard] = useState<(() => void) | null>(null)
  const [history, setHistory] = useState<LayoutDraft[]>([])
  const [pdfRequest, setPdfRequest] = useState<LayoutPdfRequest | null>(null)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showSheetDimensions, setShowSheetDimensions] = useState(true)
  const drag = useRef<{
    x: number
    y: number
    body: LayoutDraft
    scale: number
    angle: number
    id: number
  } | null>(null)
  const clipId = useId().replace(/:/g, '')
  const sourceKey = layoutSourceKey(room.polygon, scale)
  const refresh = (): void => {
    void unwrap(window.sekisan.readMaterials(projectId))
      .then(setCatalog)
      .catch((e) => setError(e.message))
  }
  useEffect(() => {
    let active = true
    void Promise.all([
      unwrap(window.sekisan.readLayout(room.id)),
      unwrap(window.sekisan.readMaterials(projectId))
    ])
      .then(([doc, materials]) => {
        if (!active) return
        setSaved(doc)
        setCatalog(materials)
        let initial: LayoutDraft = doc ? toDraft(doc.body) : emptyDraft(room)
        if (!doc) {
          const matching = materials.project.filter(
            (m) =>
              m.category === 'floor' &&
              m.name === room.finishes.floor.name &&
              [materialSpecification(m), m.specification].includes(
                room.finishes.floor.specification ?? ''
              )
          )
          if (matching.length === 1) {
            const m = matching[0]
            initial = {
              ...initial,
              materialId: m.id,
              layoutType: m.layoutType,
              maxWidthMm: m.layoutType === 'tile' ? null : m.tileWidthMm,
              rollCutMode: 'width',
              specification: materialSpecification(m),
              widthMm: m.tileWidthMm ?? '',
              heightMm: m.tileHeightMm ?? '',
              gapMm: 0
            }
          }
        }
        initialBody.current = initial
        setBody(initial)
        setLoaded(true)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [room.id, projectId])
  const isRoll = body.layoutType !== 'tile'
  const needsDimensions = body.widthMm === '' || (!isRoll && body.heightMm === '')
  const computed = useMemo(() => {
    if (needsDimensions) return { result: null, body: null, error: '' }
    const parsed = layoutBodySchema.safeParse({
      ...body,
      heightMm: body.heightMm === '' ? null : body.heightMm
    })
    if (!parsed.success)
      return {
        result: null,
        body: null,
        error: '材料寸法・目地幅・回転角度・移動量を確認してください。'
      }
    try {
      return {
        result: computeLayout(room.polygon, scale, parsed.data),
        body: parsed.data,
        error: ''
      }
    } catch (e) {
      return {
        result: null,
        body: null,
        error: e instanceof Error ? e.message : '寸法を確認してください。'
      }
    }
  }, [room.polygon, scale, body])
  const wallDimensions = useMemo(
    () =>
      computed.result
        ? layoutWallDimensions(room.polygon, computed.result.anchor, computed.result.angle, scale)
        : null,
    [room.polygon, scale, computed.result]
  )
  const dirty =
    loaded &&
    (saved
      ? JSON.stringify(body) !== JSON.stringify(toDraft(saved.body)) ||
        saved.sourceKey !== sourceKey
      : JSON.stringify(body) !== JSON.stringify(initialBody.current) || !!computed.result)
  const change = (update: Partial<LayoutDraft>): void => {
    setHistory((h) => [...h.slice(-49), body])
    setBody({ ...body, ...update })
    setNotice('')
  }
  const nudge = (x: number, y: number): void =>
    change({
      offsetX: Math.round((body.offsetX + x * step) * 1000) / 1000,
      offsetY: Math.round((body.offsetY + y * step) * 1000) / 1000
    })
  const leave = (action: () => void): void => {
    if (busy) return
    if (dirty) setDiscard(() => action)
    else action()
  }
  async function previewPdf(): Promise<void> {
    if (!computed.body || !computed.result || busy) return
    setBusy(true)
    setError('')
    try {
      const diagram = await layoutImage(pdf, pageNumber, room.polygon, scale, computed.body)
      setPdfRequest({
        roomId: room.id,
        expectedRevision: saved?.revision ?? 0,
        sourceKey,
        body: computed.body,
        diagram
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '割り付け図を作成できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  const requestClose = (): void => leave(close)
  async function save(): Promise<void> {
    if (!computed.result || !computed.body || !loaded || busy) return
    setBusy(true)
    setError('')
    try {
      const doc = await unwrap(
        window.sekisan.saveLayout({
          roomId: room.id,
          expectedRevision: saved?.revision ?? 0,
          sourceKey,
          body: computed.body
        })
      )
      setSaved(doc)
      setBody(toDraft(doc.body))
      setNotice('割り付けを保存しました。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  const numeric = (
    key: 'widthMm' | 'heightMm' | 'gapMm' | 'trimMm' | 'angle' | 'offsetX' | 'offsetY',
    label: string,
    min: number,
    max: number
  ): React.JSX.Element => (
    <label>
      {label}
      {isRoll && (key === 'widthMm' || key === 'heightMm') ? (
        <DimensionInput
          key={`${body.layoutType}-${key}`}
          value={body[key]}
          onChange={(value) => change({ [key]: value })}
          type={body.layoutType}
          axis={key === 'widthMm' ? 'W' : 'L'}
          label={label}
          min={min}
          max={max}
        />
      ) : (
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step="any"
          list={key === 'gapMm' ? `${clipId}-gap` : undefined}
          value={body[key]}
          placeholder={key === 'widthMm' || key === 'heightMm' ? '未設定' : undefined}
          onChange={(e) =>
            change({
              [key]:
                (key === 'widthMm' || key === 'heightMm') && e.target.value === ''
                  ? ''
                  : Number(e.target.value)
            })
          }
        />
      )}
    </label>
  )
  return (
    <section className="layout-screen" aria-busy={busy || !loaded}>
      {navigation(leave, busy)}
      <div className="layout-editor">
        <aside className="layout-settings">
          {roomSelection(leave, busy)}
          {!loaded && <p>{error || '割り付けを読み込んでいます…'}</p>}
          <fieldset disabled={busy || !loaded}>
            <h3>材料・規格</h3>
            <MaterialInput
              label="割付の材料"
              value={body.materialName}
              materials={catalog?.project ?? []}
              onChange={(materialName) =>
                change({
                  materialName,
                  materialId: null,
                  widthMm: '',
                  heightMm: '',
                  maxWidthMm: null
                })
              }
              onSelect={(m) => {
                change({
                  materialId: m.id,
                  layoutType: m.layoutType,
                  maxWidthMm: m.layoutType === 'tile' ? null : m.tileWidthMm,
                  rollCutMode: 'width',
                  gapMm: m.layoutType === 'tile' ? body.gapMm : 0,
                  materialName: m.name,
                  specification: materialSpecification(m),
                  widthMm: m.tileWidthMm ?? '',
                  heightMm: m.tileHeightMm ?? ''
                })
                setNotice(
                  m.tileWidthMm && (m.layoutType !== 'tile' || m.tileHeightMm)
                    ? 'マスタの寸法を適用しました。'
                    : '割付に必要な寸法が未登録です。空欄の幅・長さを入力してください。'
                )
              }}
            />
            <label>
              仕様・規格
              <input
                aria-label="割付の仕様・規格"
                value={body.specification}
                maxLength={400}
                onChange={(e) => change({ specification: e.target.value })}
              />
            </label>
            <button className="secondary" onClick={() => setMaster(true)}>
              材料マスタで寸法を設定
            </button>
            <label>
              材料の種類
              <select
                aria-label="割付の材料の種類"
                value={body.layoutType}
                onChange={(e) =>
                  change({
                    layoutType: e.target.value as LayoutBody['layoutType'],
                    maxWidthMm: null,
                    materialId: null,
                    gapMm: 0,
                    heightMm: ''
                  })
                }
              >
                {Object.entries(layoutTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {isRoll && (
              <>
                <label>
                  最大出荷W（{dimensionUnit(body.layoutType)}）
                  <DimensionInput
                    value={body.maxWidthMm}
                    type={body.layoutType}
                    axis="W"
                    label={`最大出荷W（${dimensionUnit(body.layoutType)}）`}
                    min={10}
                    max={10000}
                    onChange={(value) => change({ maxWidthMm: value === '' ? null : value })}
                  />
                </label>
                {body.layoutType === 'carpet' && (
                  <label>
                    出荷方法
                    <select
                      aria-label="カーペットの出荷方法"
                      value={body.rollCutMode}
                      onChange={(e) => change({ rollCutMode: e.target.value as 'width' | 'free' })}
                    >
                      <option value="width">幅なり出荷（最大Wで数量計算）</option>
                      <option value="free">フリーカット（使用Wで数量計算）</option>
                    </select>
                  </label>
                )}
                <p>規格のW・Lは出荷できる最大寸法です。割付Wで継ぎ目の間隔を設定します。</p>
              </>
            )}
            <div className="layout-grid">
              {numeric(
                'widthMm',
                isRoll ? `割付W（${dimensionUnit(body.layoutType)}）` : '割付の幅（mm）',
                10,
                10000
              )}
              {numeric(
                'heightMm',
                isRoll
                  ? `最大出荷L（${dimensionUnit(body.layoutType)}・任意）`
                  : '割付の長さ（mm）',
                10,
                isRoll ? 1000000 : 10000
              )}
              {isRoll
                ? numeric('trimMm', '切りしろ（両端各・mm）', 0, 1000)
                : numeric('gapMm', '割付の目地幅（mm）', 0, 100)}
              <datalist id={`${clipId}-gap`}>
                {[0, 1, 2, 3, 5, 10].map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </div>
            {isRoll && !(body.layoutType === 'carpet' && body.rollCutMode === 'free') && (
              <label className="layout-dimension-toggle">
                <input
                  type="checkbox"
                  checked={body.reorderCuts}
                  onChange={(e) => change({ reorderCuts: e.target.checked })}
                />
                最大出荷L内で切出し順を調整
              </label>
            )}
            <section className="layout-wall-measurements" aria-label="基準点から壁までの寸法">
              <h3>基準点から壁までの寸法</h3>
              <p>中心の十字から割り付けの縦・横方向に測ります。壁寄せでは十字の位置が起点です。</p>
              <label className="layout-dimension-toggle">
                <input
                  type="checkbox"
                  checked={showDimensions}
                  onChange={(e) => setShowDimensions(e.target.checked)}
                />
                寸法線を表示
              </label>
              {!wallDimensions ? (
                <p>
                  {isRoll
                    ? 'ロール幅を入力すると表示します。'
                    : '材料の幅・長さを入力すると表示します。'}
                </p>
              ) : !wallDimensions.inside ? (
                <p role="status">基準点が部屋の外にあります。部屋の内側へ移動してください。</p>
              ) : (
                <dl data-testid="layout-wall-measurements">
                  {wallDimensions.dimensions.map((d) => (
                    <div key={d.key} data-testid={`dimension-${d.key}`}>
                      <dt>
                        {d.label} · 壁{d.wallIndex + 1}
                      </dt>
                      <dd>
                        {isRoll
                          ? dimensionLabel(d.distanceMm, body.layoutType)
                          : `${dimensionText(d.distanceMm)} mm`}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
            <h3>割り付けの基準</h3>
            <div className="layout-presets">
              <button
                className={
                  body.mode === 'center' && body.axisX === 'joint' && body.axisY === 'joint'
                    ? 'primary'
                    : 'secondary'
                }
                onClick={() =>
                  change({ mode: 'center', axisX: 'joint', axisY: 'joint', offsetX: 0, offsetY: 0 })
                }
              >
                芯割り<span>{isRoll ? '中心に継ぎ目' : '中心に目地'}</span>
              </button>
              <button
                className={
                  body.mode === 'center' && body.axisX === 'tile' && body.axisY === 'tile'
                    ? 'primary'
                    : 'secondary'
                }
                onClick={() =>
                  change({ mode: 'center', axisX: 'tile', axisY: 'tile', offsetX: 0, offsetY: 0 })
                }
              >
                芯跨ぎ<span>中心に材料</span>
              </button>
              <button
                className={body.mode === 'wall' ? 'primary' : 'secondary'}
                onClick={() => change({ mode: 'wall', angle: 0, offsetX: 0, offsetY: 0 })}
              >
                壁寄せ<span>壁から真物</span>
              </button>
            </div>
            {body.mode === 'center' ? (
              <>
                <div className="layout-grid">
                  {(isRoll ? (['axisX'] as const) : (['axisX', 'axisY'] as const)).map((key, i) => (
                    <label key={key}>
                      {i === 0 ? '横方向' : '縦方向'}
                      <select
                        aria-label={`割付の${i === 0 ? '横' : '縦'}方向の基準`}
                        value={body[key]}
                        onChange={(e) => change({ [key]: e.target.value })}
                      >
                        <option value="joint">
                          {isRoll ? '芯割り（継ぎ目）' : '芯割り（目地芯）'}
                        </option>
                        <option value="tile">芯跨ぎ（材料芯）</option>
                      </select>
                    </label>
                  ))}
                </div>
                <p>回転後の部屋を囲む長方形の中心を基準にします。</p>
              </>
            ) : (
              <label>
                基準の壁
                <select
                  aria-label="割付の基準壁"
                  value={body.wallIndex}
                  onChange={(e) =>
                    change({ wallIndex: Number(e.target.value), offsetX: 0, offsetY: 0 })
                  }
                >
                  {room.polygon.map((p, i) => (
                    <option key={i} value={i}>
                      壁{i + 1} ·{' '}
                      {isRoll
                        ? dimensionLabel(
                            distance(p, room.polygon[(i + 1) % room.polygon.length]) * scale * 1000,
                            body.layoutType
                          )
                        : `${Math.round(distance(p, room.polygon[(i + 1) % room.polygon.length]) * scale * 1000)} mm`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isRoll && (
              <div className="layout-roll-direction">
                <h3>敷く方向</h3>
                <p>図面の矢印がロールの長さ方向です。</p>
                <button
                  className="secondary"
                  onClick={() =>
                    change({ angle: body.angle + 90 > 180 ? body.angle - 270 : body.angle + 90 })
                  }
                >
                  敷く方向を90°回転
                </button>
              </div>
            )}
            <h3>微調整</h3>
            <p>左ドラッグで割り付けを移動。右ドラッグで図面を移動。ホイールで拡大・縮小。</p>
            <div className="layout-grid">
              {numeric(
                'angle',
                body.mode === 'wall' ? '壁からの回転（°）' : '図面からの回転（°）',
                -180,
                180
              )}
              <label>
                移動幅
                <select
                  aria-label="割付の移動幅"
                  value={step}
                  onChange={(e) => setStep(Number(e.target.value))}
                >
                  {[1, 10, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="layout-nudge">
              {[
                [0, -1, ArrowUp, '上'],
                [-1, 0, ArrowLeft, '左'],
                [1, 0, ArrowRight, '右'],
                [0, 1, ArrowDown, '下']
              ].map(([x, y, Icon, name]) => {
                const C = Icon as typeof ArrowUp
                return (
                  <button
                    key={String(name)}
                    className="secondary"
                    aria-label={`割付を${name}へ移動`}
                    title={`${name}へ ${step} mm`}
                    onClick={() => nudge(Number(x), Number(y))}
                  >
                    <C size={18} />
                  </button>
                )
              })}
              <button
                className="secondary"
                aria-label="割付の微調整をリセット"
                title="微調整をリセット"
                onClick={() => change({ offsetX: 0, offsetY: 0, angle: 0 })}
              >
                <RotateCcw size={18} />
              </button>
            </div>
            <div className="layout-grid">
              {numeric('offsetX', '横の移動量（mm）', -1e7, 1e7)}
              {numeric('offsetY', '縦の移動量（mm）', -1e7, 1e7)}
            </div>
            <p>移動方向は材料の向きに合わせます。ドラッグは1mm単位です。</p>
            <button
              className="secondary"
              disabled={!history.length}
              onClick={() => {
                setBody(history[history.length - 1])
                setHistory(history.slice(0, -1))
                setNotice('')
              }}
            >
              ひとつ戻す
            </button>
          </fieldset>
        </aside>
        <main className="layout-preview">
          <div className="layout-toolbar">
            <div>
              <span>
                {pageNumber}ページ ·{' '}
                {isRoll ? '番号：シート／W：実測幅／L：実測長さ' : '緑：真物／橙：切り物'}
              </span>
              <p className="layout-navigation-hint">
                右ドラッグで図面を移動 · ホイールで拡大・縮小
              </p>
            </div>
            {isRoll && (
              <label className="layout-sheet-toggle">
                <input
                  type="checkbox"
                  checked={showSheetDimensions}
                  onChange={(e) => setShowSheetDimensions(e.target.checked)}
                />
                シートの実測寸法線を表示
              </label>
            )}
            <button
              className="secondary"
              onClick={() => {
                setZoom(1)
                setReset((r) => r + 1)
              }}
            >
              全体表示
            </button>
          </div>
          <PdfPage
            pdf={pdf}
            pageNumber={pageNumber}
            zoom={zoom}
            onZoom={setZoom}
            resetView={reset}
            crosshair={null}
            pan={false}
            fitHeight={isRoll}
            overlay={(view) => (
              <svg
                className="takeoff-overlay layout-overlay"
                data-testid="layout-overlay"
                viewBox={`0 0 ${view.width} ${view.height}`}
                tabIndex={0}
                aria-label="割り付けの調整領域"
                onPointerDown={(e) => {
                  if (e.button !== 0 || busy || !loaded || !computed.result) return
                  e.preventDefault()
                  e.currentTarget.focus()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    body,
                    scale: view.scale,
                    angle: computed.result.angle,
                    id: e.pointerId
                  }
                }}
                onPointerMove={(e) => {
                  const d = drag.current
                  if (!d || e.pointerId !== d.id || !(e.buttons & 1)) return
                  const delta = rotate(
                    {
                      x: ((e.clientX - d.x) / d.scale) * scale * 1000,
                      y: ((e.clientY - d.y) / d.scale) * scale * 1000
                    },
                    -d.angle
                  )
                  setBody({
                    ...d.body,
                    offsetX: Math.round(d.body.offsetX + delta.x),
                    offsetY: Math.round(d.body.offsetY + delta.y)
                  })
                  setNotice('')
                }}
                onLostPointerCapture={() => {
                  if (drag.current) {
                    const before = drag.current.body
                    setHistory((h) => [...h.slice(-49), before])
                    drag.current = null
                  }
                }}
                onPointerCancel={() => {
                  if (drag.current) setBody(drag.current.body)
                  drag.current = null
                }}
                onKeyDown={(e) => {
                  if (busy || !loaded || e.nativeEvent.isComposing) return
                  const dirs: Record<string, [number, number]> = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1]
                  }
                  if (dirs[e.key]) {
                    e.preventDefault()
                    e.stopPropagation()
                    nudge(...dirs[e.key])
                  }
                }}
              >
                <defs>
                  <clipPath id={clipId}>
                    <polygon points={shape(room.polygon)} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`} pointerEvents="none">
                  {computed.result?.tiles.map((t, i) => (
                    <polygon
                      key={i}
                      points={shape(t.polygon)}
                      fill={
                        isRoll ? (i % 2 ? '#479bbb' : '#50a37c') : t.full ? '#2b9671' : '#ed9f35'
                      }
                      fillOpacity="0.2"
                      stroke={t.full ? '#217458' : '#b46916'}
                      strokeWidth={0.8 / view.scale}
                    />
                  ))}
                </g>
                <polygon
                  points={shape(room.polygon)}
                  fill="transparent"
                  stroke="#184f96"
                  strokeWidth={2 / view.scale}
                />
                {body.mode === 'wall' && room.polygon[body.wallIndex] && (
                  <line
                    x1={room.polygon[body.wallIndex].x}
                    y1={room.polygon[body.wallIndex].y}
                    x2={room.polygon[(body.wallIndex + 1) % room.polygon.length].x}
                    y2={room.polygon[(body.wallIndex + 1) % room.polygon.length].y}
                    stroke="#d7336a"
                    strokeWidth={4 / view.scale}
                  />
                )}
                {room.polygon.map((p, i) => {
                  const q = room.polygon[(i + 1) % room.polygon.length]
                  return (
                    <text
                      key={i}
                      x={(p.x + q.x) / 2}
                      y={(p.y + q.y) / 2}
                      fontSize={12 / view.scale}
                      fill="#184f96"
                      stroke="white"
                      strokeWidth={3 / view.scale}
                      paintOrder="stroke"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      壁{i + 1}
                    </text>
                  )
                })}
                {computed.result?.roll && (
                  <RollOverlay
                    strips={computed.result.roll.strips}
                    scale={view.scale}
                    layoutType={body.layoutType}
                    showDimensions={showSheetDimensions}
                  />
                )}
                {computed.result && showDimensions && wallDimensions?.inside && (
                  <LayoutDimensionsOverlay
                    anchor={computed.result.anchor}
                    dimensions={wallDimensions.dimensions}
                    layoutType={body.layoutType}
                    scale={view.scale}
                    avoidPoint={
                      isRoll && showSheetDimensions && body.mode === 'wall'
                        ? {
                            x: room.polygon.reduce((sum, p) => sum + p.x, 0) / room.polygon.length,
                            y: room.polygon.reduce((sum, p) => sum + p.y, 0) / room.polygon.length
                          }
                        : undefined
                    }
                  />
                )}
                {computed.result && (
                  <g
                    transform={`translate(${computed.result.anchor.x},${computed.result.anchor.y})`}
                    pointerEvents="none"
                    stroke="#d7336a"
                    strokeWidth={2 / view.scale}
                  >
                    <line x1={-12 / view.scale} x2={12 / view.scale} />
                    <line y1={-12 / view.scale} y2={12 / view.scale} />
                  </g>
                )}
              </svg>
            )}
          />
          <div className="layout-results">
            {loaded && needsDimensions && (
              <p className="layout-size-prompt" role="status">
                {isRoll
                  ? 'ロール幅を入力するか、ロール材をマスタから選んでください。'
                  : '材料の幅・長さを入力するか、寸法を登録した材料をマスタから選んでください。'}
              </p>
            )}
            {computed.result && (
              <>
                <strong>部屋面積 {computed.result.roomArea.toFixed(1)} ㎡</strong>
                {computed.result.roll ? (
                  <RollResults
                    roll={computed.result.roll}
                    widthMm={computed.body!.widthMm}
                    trimMm={body.trimMm}
                    stockMm={computed.body!.heightMm}
                    layoutType={body.layoutType}
                  />
                ) : (
                  <>
                    <span>真物 {computed.result.full} 枚</span>
                    <span>切り物 {computed.result.cut} 枚</span>
                    <span>使用元材 {computed.result.full + computed.result.cut} 枚</span>
                  </>
                )}
              </>
            )}
            <p>
              {isRoll
                ? '使用材料数量は出荷方法に応じたW×切りしろ込みL×枚数です。最大出荷Lを全量購入する計算ではありません。凹部の空白も1枚でつなぐ長さに含めます。幅方向の端材再利用・柄合わせ・重ね代・柱型や穴の控除は含みません。'
                : '使用元材は切り物の各マスに1枚使用する場合。端材の再利用・予備・箱単位は含みません。部屋外周が対象で、柱型や床の穴は自動控除しません。'}
            </p>
          </div>
        </main>
      </div>
      <footer className="modal-footer layout-footer">
        <div>
          {saved && saved.sourceKey !== sourceKey && (
            <p role="status">
              部屋の形状・縮尺が変更されています。現在の形状で配置を確認して保存してください。
            </p>
          )}
          {(error || computed.error) && (
            <p className="form-error" role="alert">
              {error || computed.error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {dirty && <small>配置は未保存です。拾い出し・見積の数量には自動反映しません。</small>}
        </div>
        <button
          className="secondary"
          disabled={busy || !loaded || !computed.result}
          onClick={() => void previewPdf()}
        >
          PDFプレビュー・保存
        </button>
        <button className="secondary" disabled={busy} onClick={requestClose}>
          図面一覧へ
        </button>
        <button
          className="primary"
          disabled={busy || !loaded || !computed.result || !dirty}
          onClick={() => void save()}
        >
          割り付けを保存
        </button>
      </footer>
      {pdfRequest && <LayoutPdfDialog request={pdfRequest} close={() => setPdfRequest(null)} />}
      {master && (
        <MaterialManager
          projectId={projectId}
          close={() => {
            setMaster(false)
            refresh()
          }}
        />
      )}
      {discard && (
        <TakeoffDialog title="割り付けに未保存の変更があります" close={() => setDiscard(null)}>
          <div className="form-body">
            <p>変更を破棄して移動しますか？</p>
          </div>
          <footer className="modal-footer">
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
          </footer>
        </TakeoffDialog>
      )}
    </section>
  )
}
