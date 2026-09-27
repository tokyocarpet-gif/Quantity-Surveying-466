import { Storage } from '../src/main/storage'
import { PDFDocument } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emptyFinishes } from '../src/shared/takeoff'
const root = process.argv[2],
  storage = new Storage(join(root, 'data'))
const client = storage.createClient('見積テスト顧客'),
  project = storage.createProject({
    clientId: client.id,
    name: 'モダン帳票検証工事',
    memo: '',
    status: 'active'
  })
const pdf = await PDFDocument.create()
pdf.addPage([842, 595])
const path = join(root, 'drawing.pdf')
writeFileSync(path, await pdf.save())
const drawing = (await storage.importPdfs(project.id, [path])).imported[0],
  address = { drawingId: drawing.id, pageNumber: 1 },
  polygon = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 }
  ]
storage.applyTakeoff({
  ...address,
  expectedRevision: 0,
  change: { kind: 'scale', points: [polygon[0], polygon[1]], lengthMm: 4000 }
})
const finishes = emptyFinishes()
finishes.floor = { name: '床材', unitPrice: 1000 }
storage.applyTakeoff({
  ...address,
  expectedRevision: 1,
  change: {
    kind: 'room',
    id: randomUUID(),
    input: {
      name: '会議室',
      polygon,
      color: '#327e6d',
      heightMm: 2400,
      finishes,
      sleeveWalls: [],
      enabledCategories: ['floor']
    }
  }
})
const report = storage.readSummary({ projectId: project.id })
const doc = storage.createEstimate({ request: report.request, fingerprint: report.fingerprint })
doc.body.issuer =
  '東京カーペット加工株式会社\n〒130-0012 東京都墨田区太平4-6-6\nTEL 03-3625-4169　FAX 03-3626-2669'
doc.body.lines = Array.from({ length: 30 }, (_, i) => ({
  ...doc.body.lines[0],
  id: randomUUID(),
  itemNo: String(i + 1),
  name: i % 2 ? '壁紙' : '床材',
  specification: 'RE55223',
  quantity: '2.0',
  section: i < 25 ? '販売センター' : 'モデルルーム'
}))
const saved = storage.saveEstimate({ id: doc.id, expectedRevision: 1, body: doc.body })
writeFileSync(
  join(root, 'fixture.json'),
  JSON.stringify({
    id: saved.id,
    projectId: project.id,
    address,
    takeoff: storage.readTakeoff(address)
  })
)
storage.close()
