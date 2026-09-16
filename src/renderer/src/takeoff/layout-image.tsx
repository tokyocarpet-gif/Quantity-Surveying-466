import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Point } from '../../../shared/takeoff'
import { computeLayout, type LayoutBody } from '../../../shared/layout'
import { RollOverlay } from './RollLayoutView'

/** Render the selected room independently of the current screen's zoom and pan. */
export async function layoutImage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  polygon: Point[],
  scale: number,
  body: LayoutBody
): Promise<string> {
  polygon = body.customPolygon ?? polygon
  const result = computeLayout(polygon, scale, body)
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const minX = Math.min(...polygon.map((p) => p.x)),
    minY = Math.min(...polygon.map((p) => p.y))
  const maxX = Math.max(...polygon.map((p) => p.x)),
    maxY = Math.max(...polygon.map((p) => p.y))
  const pad = Math.max(20, Math.max(maxX - minX, maxY - minY) * 0.08)
  const x = Math.max(0, minX - pad),
    y = Math.max(0, minY - pad)
  const width = Math.min(base.width, maxX + pad) - x,
    height = Math.min(base.height, maxY + pad) - y
  if (width <= 0 || height <= 0) throw new Error('部屋が図面の範囲外にあります。')
  const ratio = Math.min(2200 / width, 1300 / height, 6)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * ratio)
  canvas.height = Math.ceil(height * ratio)
  await page.render({
    canvas,
    viewport: page.getViewport({ scale: ratio }),
    transform: [1, 0, 0, 1, -x * ratio, -y * ratio]
  }).promise
  const points = (ps: Point[]) => ps.map((p) => `${p.x},${p.y}`).join(' ')
  const printScale = Math.min(900 / width, 430 / height)
  const svg = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={canvas.width}
      height={canvas.height}
      viewBox={`${x} ${y} ${width} ${height}`}
    >
      <defs>
        <clipPath id="room">
          <polygon points={points(polygon)} />
        </clipPath>
      </defs>
      <g clipPath="url(#room)">
        {result.tiles.map((tile, i) => (
          <polygon
            key={i}
            points={points(tile.polygon)}
            fill={result.roll ? (i % 2 ? '#479bbb' : '#50a37c') : tile.full ? '#2b9671' : '#ed9f35'}
            fillOpacity={0.22}
            stroke="#617e73"
            strokeWidth={0.6 / printScale}
          />
        ))}
      </g>
      <polygon
        points={points(polygon)}
        fill="none"
        stroke="#184f96"
        strokeWidth={1.5 / printScale}
      />
      {result.roll && (
        <RollOverlay
          strips={result.roll.strips}
          scale={printScale}
          layoutType={body.layoutType}
          showDimensions
        />
      )}
    </svg>
  )
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    canvas.getContext('2d')!.drawImage(image, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
