import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import electron from 'electron'
const files = readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`)
const result = spawnSync(electron, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
