import { layoutTypeLabels } from '../../shared/layout'
import { TileSizeFields } from './TileSizeFields'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { categories, categoryLabels, categoryUnits } from '../../shared/takeoff'
import {
  materialInputSchema,
  partLabel,
  materialStandard,
  type Material,
  type MaterialContext,
  type MaterialChange
} from '../../shared/materials'
import { TakeoffDialog, quantityText } from './takeoff/Dialogs'
import { unwrap } from './store'

/** Enter advances single-line fields; Tab and select/IME controls keep their native behavior. */
function advanceMaterialField(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key !== 'Enter') return
  if (event.nativeEvent.isComposing || event.keyCode === 229) return
  if (event.repeat) {
    event.preventDefault()
    return
  }
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !['text', 'number'].includes(input.type)) return
  event.preventDefault()
  const fields = Array.from(
    event.currentTarget.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')
  ).filter(
    (field) => !field.disabled && field.type !== 'checkbox' && field.getClientRects().length > 0
  )
  const next = fields[fields.indexOf(input) + 1]
  if (next) {
    next.focus()
    next.select()
  } else {
    event.currentTarget
      .querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')
      ?.focus()
  }
}

export function MaterialManager({
  projectId,
  close
}: {
  projectId: string | null
  close: () => void
}): React.JSX.Element {
  const [data, setData] = useState<MaterialContext | null>(null)
  const [scope, setScope] = useState<'project' | 'global'>(projectId ? 'project' : 'global')
  const [importing, setImporting] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState<Material | 'new' | null>(null)
  const [remove, setRemove] = useState<Material | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const refresh = async (): Promise<void> =>
    setData(await unwrap(window.sekisan.readMaterials(projectId)))
  useEffect(() => {
    let cancelled = false
    void unwrap(window.sekisan.readMaterials(projectId))
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])
  async function change(input: MaterialChange): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await unwrap(window.sekisan.changeMaterials(input))
      await refresh()
      setEdit(null)
      setRemove(null)
      setImporting(false)
      setChecked([])
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  const list =
    (importing || scope === 'global' ? data?.global : data?.project)?.filter((m) =>
      `${partLabel(m.category)} ${m.name} ${m.specification} ${materialStandard(m)} ${m.unit}`.includes(
        query
      )
    ) ?? []
  const [option, setOption] = useState<{ kind: 'part' | 'unit'; name: string } | null>(null)
  const parts = [
    ...new Set([
      ...categories,
      ...(data?.parts ?? []),
      ...(data?.global ?? []).map((m) => m.category),
      ...(data?.project ?? []).map((m) => m.category)
    ])
  ]
  const units = [
    ...new Set([
      '㎡',
      'm',
      '式',
      '個',
      ...(data?.units ?? []),
      ...(data?.global ?? []).map((m) => m.unit),
      ...(data?.project ?? []).map((m) => m.unit)
    ])
  ]
  const imported = new Set(data?.project.map((m) => m.sourceId))
  const available = list.filter((m) => !imported.has(m.id))
  return (
    <TakeoffDialog title="仕上げ材マスタ" close={close} busy={busy}>
      <div className="master-body">
        <div className="master-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setOption({ kind: 'part', name: '' })}
          >
            部位を追加
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setOption({ kind: 'unit', name: '' })}
          >
            単位を追加
          </button>
        </div>
        <div className="master-tabs">
          {projectId && (
            <button
              disabled={busy}
              className={scope === 'project' ? 'primary' : 'secondary'}
              onClick={() => {
                setScope('project')
                setImporting(false)
                setEdit(null)
              }}
            >
              物件マスタ
            </button>
          )}
          <button
            disabled={busy}
            className={scope === 'global' ? 'primary' : 'secondary'}
            onClick={() => {
              setScope('global')
              setImporting(false)
              setEdit(null)
            }}
          >
            共通マスタ
          </button>
        </div>
        <p className="panel-description">
          {scope === 'project'
            ? 'この物件で使う材料を選んで整理します。名称・仕様・規格・単位・単価は物件ごとに調整できます。'
            : 'すべての物件で使う汎用的な材料です。初期材料の単価は未設定です。'}{' '}
          保存済みの拾い出しには自動反映しません。
        </p>
        {!edit && (
          <>
            <div className="master-actions">
              <input
                aria-label="仕上げ材を検索"
                placeholder="材料名・仕様・部位で検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setEdit('new')
                  setImporting(false)
                }}
              >
                材料を追加
              </button>
              {projectId && scope === 'project' && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setImporting(!importing)
                    setChecked([])
                    setQuery('')
                  }}
                >
                  {importing ? '取り込みをやめる' : '共通から選ぶ'}
                </button>
              )}
            </div>
            {importing && (
              <div className="master-import">
                <label>
                  <input
                    type="checkbox"
                    aria-label="表示中の材料をすべて選択"
                    checked={available.length > 0 && available.every((m) => checked.includes(m.id))}
                    onChange={(e) =>
                      setChecked(
                        e.target.checked
                          ? [...new Set([...checked, ...available.map((m) => m.id)])]
                          : checked.filter((id) => !available.some((m) => m.id === id))
                      )
                    }
                  />
                  表示中をすべて選択
                </label>
                <button
                  className="primary"
                  disabled={busy || !checked.length}
                  onClick={() =>
                    void change({ kind: 'import', projectId: projectId!, ids: checked })
                  }
                >
                  選択した{checked.length}件を物件へ取り込む
                </button>
              </div>
            )}
            <div className="master-list">
              {list.map((m) => (
                <div key={m.id} className="master-row">
                  {importing && (
                    <input
                      type="checkbox"
                      aria-label={`${partLabel(m.category)}・${m.name}を選択`}
                      disabled={busy || imported.has(m.id)}
                      checked={checked.includes(m.id)}
                      onChange={(e) =>
                        setChecked(
                          e.target.checked
                            ? [...checked, m.id]
                            : checked.filter((id) => id !== m.id)
                        )
                      }
                    />
                  )}
                  <div>
                    <small>
                      {partLabel(m.category)}
                      {m.layoutType !== 'tile' && ` · ${layoutTypeLabels[m.layoutType]}`}
                    </small>
                    <strong>{m.name}</strong>
                    {m.specification && <span>仕様：{m.specification}</span>}
                    {materialStandard(m) && <span>規格：{materialStandard(m)}</span>}
                    <span>
                      {m.unitPrice === null
                        ? `単価未設定 · ${m.unit}`
                        : `${quantityText(m.unitPrice)} 円/${m.unit}`}
                      {importing && imported.has(m.id) ? ' · 取込済み' : ''}
                    </span>
                  </div>
                  {!importing && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        aria-label={`${partLabel(m.category)}・${m.name}を編集`}
                        onClick={() => setEdit(m)}
                      >
                        編集
                      </button>
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        aria-label={`${partLabel(m.category)}・${m.name}を削除`}
                        onClick={() => setRemove(m)}
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!list.length && (
                <p className="panel-empty">
                  {data
                    ? '材料がありません。共通から選ぶか、材料を追加してください。'
                    : '読み込み中…'}
                </p>
              )}
            </div>
          </>
        )}
        {edit && (
          <form
            className="form-body"
            key={edit === 'new' ? 'new' : edit.id}
            onKeyDown={advanceMaterialField}
            onSubmit={(e) => {
              e.preventDefault()
              setError('')
              const f = new FormData(e.currentTarget)
              try {
                const input = materialInputSchema.parse({
                  projectId: scope === 'project' ? projectId : null,
                  category: f.get('category'),
                  name: f.get('name'),
                  specification: f.get('specification'),
                  layoutType: f.get('layoutType'),
                  tileWidthMm: f.get('tileWidthMm') === '' ? null : Number(f.get('tileWidthMm')),
                  tileHeightMm: f.get('tileHeightMm') === '' ? null : Number(f.get('tileHeightMm')),
                  tileThicknessMm:
                    f.get('tileThicknessMm') === '' ? null : Number(f.get('tileThicknessMm')),
                  tileGapMm: edit === 'new' ? 0 : edit.tileGapMm,
                  unit: f.get('unit'),
                  unitPrice: f.get('price') === '' ? null : Number(f.get('price'))
                })
                void change({
                  kind: 'save',
                  id: edit === 'new' ? crypto.randomUUID() : edit.id,
                  input
                })
              } catch (e) {
                setError(e instanceof Error ? e.message : '入力を確認してください。')
              }
            }}
          >
            <p className="panel-description">
              Enterで次の入力欄へ移動し、最後に「材料を保存」で確定します。
            </p>
            <label>
              部位
              <select
                name="category"
                aria-label="材料の部位"
                defaultValue={edit === 'new' ? 'floor' : edit.category}
                onChange={(e) => {
                  const unit = e.currentTarget.form?.elements.namedItem(
                    'unit'
                  ) as HTMLSelectElement | null
                  if (unit && ['ceiling', 'wall', 'floor', 'baseboard'].includes(e.target.value))
                    unit.value = e.target.value === 'baseboard' ? 'm' : '㎡'
                }}
              >
                {parts.map((c) => (
                  <option key={c} value={c}>
                    {partLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              材料名
              <input
                name="name"
                aria-label="材料名・仕様"
                maxLength={120}
                required
                defaultValue={edit === 'new' ? '' : edit.name}
              />
            </label>
            <label>
              仕様
              <input
                name="specification"
                aria-label="材料の仕様"
                maxLength={240}
                defaultValue={edit === 'new' ? '' : edit.specification}
              />
            </label>
            <TileSizeFields material={edit === 'new' ? null : edit} />
            <label>
              単位
              <select
                name="unit"
                aria-label="材料の単位"
                defaultValue={edit === 'new' ? '㎡' : edit.unit}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label>
              単価（円・任意）
              <input
                name="price"
                aria-label="材料の単価"
                type="number"
                min="0"
                max="1000000000"
                step="any"
                defaultValue={edit === 'new' ? '' : (edit.unitPrice ?? '')}
              />
            </label>
            <div className="master-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                編集をやめる
              </button>
              <button type="submit" className="primary" disabled={busy}>
                材料を保存
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="secondary" disabled={busy} onClick={close}>
          閉じる
        </button>
      </footer>
      {option && (
        <TakeoffDialog
          title={option.kind === 'part' ? '部位を追加' : '単位を追加'}
          close={() => setOption(null)}
          busy={busy}
        >
          <form
            className="summary-edit-form"
            onKeyDown={advanceMaterialField}
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError('')
              try {
                await unwrap(window.sekisan.addCatalogOption(option))
                await refresh()
                setOption(null)
              } catch (e) {
                setError(e instanceof Error ? e.message : '追加できませんでした。')
              } finally {
                setBusy(false)
              }
            }}
          >
            <label>
              {option.kind === 'part' ? '部位名' : '単位名'}
              <input
                aria-label={option.kind === 'part' ? '追加する部位名' : '追加する単位名'}
                autoFocus
                required
                maxLength={option.kind === 'part' ? 120 : 20}
                value={option.name}
                disabled={busy}
                onChange={(e) => setOption({ ...option, name: e.target.value })}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="primary" disabled={busy}>
              追加して保存
            </button>
          </form>
        </TakeoffDialog>
      )}
      {remove && (
        <TakeoffDialog title="仕上げ材を削除" close={() => setRemove(null)} busy={busy}>
          <div className="preview-body">
            <p>
              「{remove.name}」を{scope === 'global' ? '共通' : '物件'}
              マスタから削除します。取り込み済みの物件材料と、保存済みの拾い出しは保持します。
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
          <footer className="modal-footer">
            <button className="secondary" disabled={busy} onClick={() => setRemove(null)}>
              戻る
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void change({ kind: 'delete', id: remove.id })}
            >
              削除する
            </button>
          </footer>
        </TakeoffDialog>
      )}
    </TakeoffDialog>
  )
}
