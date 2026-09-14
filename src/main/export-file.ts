import { realpathSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Keep a failed export from replacing an existing file or any application data. */
export function savePdfFile(path: string, bytes: Buffer, dataRoot: string): string {
  return saveReportFile(path, bytes, dataRoot, '.pdf')
}
export function saveReportFile(
  path: string,
  bytes: Buffer,
  dataRoot: string,
  extension: '.pdf' | '.xlsx'
): string {
  if (extname(path).toLowerCase() !== extension)
    throw new Error(`拡張子${extension}で保存してください。`)
  const target = join(realpathSync(dirname(resolve(path))), basename(path))
  const normalize = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value
  const root = normalize(realpathSync(dataRoot)),
    destination = normalize(target)
  if (destination === root || destination.startsWith(root + sep))
    throw new Error('アプリのデータ保存先以外を指定してください。')
  const temporary = target + '.tmp-' + randomUUID()
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', flush: true })
    renameSync(temporary, target)
    return target
  } finally {
    rmSync(temporary, { force: true })
  }
}
