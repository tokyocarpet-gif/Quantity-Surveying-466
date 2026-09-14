import { cpSync, mkdirSync } from 'node:fs'
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  const target = `src/renderer/public/pdf/${folder}`
  mkdirSync(target, { recursive: true })
  cpSync(`node_modules/pdfjs-dist/${folder}`, target, { recursive: true })
}
