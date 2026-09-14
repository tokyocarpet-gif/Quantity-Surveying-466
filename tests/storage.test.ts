import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  renameSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import { PDFDocument } from 'pdf-lib'
import { Storage } from '../src/main/storage'

async function fixture(): Promise<{
  folder: string
  storage: Storage
  pdf: string
  cleanup: () => void
}> {
  const folder = mkdtempSync(join(tmpdir(), '積算管理 test '))
  const storage = new Storage(join(folder, 'app'))
  const document = await PDFDocument.create()
  document.addPage([400, 300])
  document.addPage([300, 400])
  const pdf = join(folder, '日本語 図面.pdf')
  writeFileSync(pdf, await document.save())
  return {
    folder,
    storage,
    pdf,
    cleanup: () => {
      storage.close()
      rmSync(folder, { recursive: true, force: true })
    }
  }
}
function project(storage: Storage) {
  const client = storage.createClient('株式会社 テスト')
  const item = storage.createProject({
    clientId: client.id,
    name: '内装改修',
    memo: '3階',
    status: 'active'
  })
  return { client, item }
}

test('顧客・案件・設定を保存し、再起動で復元する', async () => {
  const f = await fixture()
  try {
    const { client, item } = project(f.storage)
    f.storage.saveSelection({ clientId: client.id, projectId: item.id })
    f.storage.updateProject(item.id, {
      clientId: client.id,
      name: '改修 更新',
      memo: '日本語\nメモ',
      status: 'completed'
    })
    f.storage.close()
    const reopened = new Storage(join(f.folder, 'app'))
    try {
      assert.equal(reopened.workspace().projects[0].status, 'completed')
      assert.equal(reopened.workspace().projects[0].memo, '日本語\nメモ')
      assert.equal(reopened.workspace().selection.projectId, item.id)
    } finally {
      reopened.close()
    }
  } finally {
    f.cleanup()
  }
})

test('空名・無効な状態・存在しない参照・顧客と案件の選択不一致を拒否する', async () => {
  const f = await fixture()
  try {
    const { item } = project(f.storage)
    const other = f.storage.createClient('別顧客')
    assert.throws(() => f.storage.createClient('   '))
    assert.throws(() =>
      f.storage.createProject({ clientId: other.id, name: 'A', memo: '', status: 'bad' })
    )
    assert.throws(() => f.storage.saveSelection({ clientId: other.id, projectId: item.id }))
    assert.throws(() => f.storage.renameClient('invalid', 'A'))
    assert.equal(f.storage.workspace().projects.length, 1)
  } finally {
    f.cleanup()
  }
})

test('同名の顧客と案件をIDで区別する', async () => {
  const f = await fixture()
  try {
    const a = project(f.storage),
      b = project(f.storage)
    assert.notEqual(a.client.id, b.client.id)
    assert.notEqual(a.item.id, b.item.id)
    assert.equal(f.storage.workspace().projects.length, 2)
  } finally {
    f.cleanup()
  }
})

test('PDFを一意にコピーし、原本削除後も複数ページを読み取れる', async () => {
  const f = await fixture()
  try {
    const { item } = project(f.storage)
    const result = await f.storage.importPdfs(item.id, [f.pdf, f.pdf])
    assert.equal(result.imported.length, 2)
    assert.equal(result.imported[0].pageCount, 2)
    assert.notEqual(result.imported[0].id, result.imported[1].id)
    rmSync(f.pdf)
    const pdf = await PDFDocument.load(f.storage.readPdf(result.imported[0].id))
    assert.equal(pdf.getPageCount(), 2)
  } finally {
    f.cleanup()
  }
})

test('一括取り込みで不正なPDFを拒否し、正常なPDFだけ保存する', async () => {
  const f = await fixture()
  try {
    const { item } = project(f.storage)
    const bad = join(f.folder, '不正.pdf')
    writeFileSync(bad, 'not a pdf')
    const result = await f.storage.importPdfs(item.id, [bad, f.pdf])
    assert.equal(result.imported.length, 1)
    assert.equal(result.failures.length, 1)
    assert.equal(f.storage.workspace().drawings.length, 1)
  } finally {
    f.cleanup()
  }
})

test('バックアップを別環境へ復元し、図面・設定が一致する', async () => {
  const f = await fixture()
  let second: Storage | undefined
  try {
    const { client, item } = project(f.storage)
    const imported = await f.storage.importPdfs(item.id, [f.pdf])
    f.storage.saveSelection({ clientId: client.id, projectId: item.id })
    const backup = join(f.folder, 'バックアップ.sekisan-backup')
    await f.storage.createBackup(backup)
    second = new Storage(join(f.folder, '別環境'))
    second.createClient('復元前の顧客')
    const recovery = await second.restoreBackup(backup)
    assert.equal(second.workspace().clients[0].name, client.name)
    assert.equal(second.workspace().selection.projectId, item.id)
    assert.deepEqual(
      second.readPdf(imported.imported[0].id),
      f.storage.readPdf(imported.imported[0].id)
    )
    assert.ok(existsSync(join(recovery, 'db/sekisan-kanri.db')))
    const old = new Database(join(recovery, 'db/sekisan-kanri.db'), { readonly: true })
    try {
      assert.equal(
        (old.prepare('SELECT name FROM clients').get() as { name: string }).name,
        '復元前の顧客'
      )
    } finally {
      old.close()
    }
  } finally {
    second?.close()
    f.cleanup()
  }
})

test('破損したバックアップを拒否し、現在のデータを保持する', async () => {
  const f = await fixture()
  try {
    const { item } = project(f.storage)
    await f.storage.importPdfs(item.id, [f.pdf])
    const backup = join(f.folder, 'original.sekisan-backup')
    await f.storage.createBackup(backup)
    const zip = new AdmZip(backup)
    zip.updateFile('db/sekisan-kanri.db', Buffer.from('corrupt'))
    const bad = join(f.folder, 'bad.sekisan-backup')
    zip.writeZip(bad)
    const before = f.storage.workspace()
    await assert.rejects(f.storage.restoreBackup(bad))
    assert.deepEqual(f.storage.workspace(), before)
  } finally {
    f.cleanup()
  }
})

test('バックアップに余分なファイルがある場合は展開しない', async () => {
  const f = await fixture()
  try {
    project(f.storage)
    const backup = join(f.folder, 'original.sekisan-backup')
    await f.storage.createBackup(backup)
    const zip = new AdmZip(backup)
    zip.addFile('unexpected.txt', Buffer.from('unexpected'))
    zip.writeZip(backup)
    await assert.rejects(f.storage.restoreBackup(backup))
    assert.equal(f.storage.workspace().clients.length, 1)
    assert.equal(existsSync(join(f.storage.dataPath, 'unexpected.txt')), false)
  } finally {
    f.cleanup()
  }
})

test('復元後のDB再接続失敗で、退避した元データへロールバックする', async () => {
  const f = await fixture()
  try {
    const { client } = project(f.storage)
    const backup = join(f.folder, 'original.sekisan-backup')
    await f.storage.createBackup(backup)
    f.storage.renameClient(client.id, '復元前の新しい名前')
    const internal = f.storage as unknown as { open: () => void }
    const open = internal.open.bind(f.storage)
    let first = true
    internal.open = () => {
      if (first) {
        first = false
        throw new Error('injected open failure')
      }
      open()
    }
    await assert.rejects(f.storage.restoreBackup(backup), /injected open failure/)
    assert.equal(f.storage.workspace().clients[0].name, '復元前の新しい名前')
  } finally {
    f.cleanup()
  }
})

test('復元中に終了した状態から次回起動時に元データへ戻る', async () => {
  const f = await fixture()
  try {
    project(f.storage)
    f.storage.close()
    const name = 'before-restore-123-00000000-0000-4000-8000-000000000000'
    const recovery = join(f.storage.root, 'recovery', name)
    mkdirSync(join(f.storage.root, 'recovery'))
    renameSync(f.storage.dataPath, recovery)
    writeFileSync(
      join(f.storage.root, 'restore-journal.json'),
      JSON.stringify({ recoveryName: name })
    )
    const reopened = new Storage(f.storage.root)
    try {
      assert.equal(reopened.workspace().clients.length, 1)
      assert.equal(existsSync(join(f.storage.root, 'restore-journal.json')), false)
    } finally {
      reopened.close()
    }
  } finally {
    f.cleanup()
  }
})

test('顧客削除の連鎖は選択した顧客の案件・管理図面だけに適用する', async () => {
  const f = await fixture()
  try {
    const a = project(f.storage),
      b = project(f.storage)
    await f.storage.importPdfs(a.item.id, [f.pdf])
    assert.deepEqual(f.storage.deleteImpact('clients', a.client.id), {
      name: a.client.name,
      projects: 1,
      drawings: 1
    })
    f.storage.delete('clients', a.client.id)
    assert.equal(f.storage.workspace().clients.length, 1)
    assert.equal(f.storage.workspace().projects[0].id, b.item.id)
    assert.equal(f.storage.workspace().drawings.length, 0)
    assert.ok(existsSync(f.pdf))
  } finally {
    f.cleanup()
  }
})

test('処理を直列化し、取り込み途中のバックアップを作らない', async () => {
  const f = await fixture()
  try {
    const { item } = project(f.storage)
    const backup = join(f.folder, 'ordered.sekisan-backup')
    await Promise.all([
      f.storage.run(() => f.storage.importPdfs(item.id, [f.pdf])),
      f.storage.run(() => f.storage.createBackup(backup))
    ])
    const zip = new AdmZip(backup)
    const manifest = JSON.parse(zip.readAsText('manifest.json'))
    assert.equal(manifest.files.length, 2)
    await assert.rejects(
      f.storage.run(() => {
        throw new Error('test')
      })
    )
    assert.equal(await f.storage.run(() => f.storage.workspace().drawings.length), 1)
  } finally {
    f.cleanup()
  }
})

test('元図面が欠けた時に既存のバックアップを上書きしない', async () => {
  const f = await fixture()
  try {
    const { item } = project(f.storage)
    const result = await f.storage.importPdfs(item.id, [f.pdf])
    const backup = join(f.folder, 'safe.sekisan-backup')
    await f.storage.createBackup(backup)
    const original = readFileSync(backup)
    rmSync(join(f.storage.dataPath, 'drawings', `${result.imported[0].id}.pdf`))
    await assert.rejects(f.storage.createBackup(backup))
    assert.deepEqual(readFileSync(backup), original)
  } finally {
    f.cleanup()
  }
})
