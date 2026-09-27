import type { WallPanelResult } from './wall-panels'
import type { WallBody, WallResult } from './wall-layout'
/** Same vector drawing in the editor and PDF; x=left, y=height above floor. */
export function WallElevation({
  body: b,
  result: r
}: {
  body: WallBody
  result: Pick<WallResult, 'widthMm' | 'drops'> & { panel?: WallPanelResult | null }
}) {
  const scale = Math.min(760 / r.widthMm, 300 / b.heightMm)
  const w = r.widthMm * scale,
    h = b.heightMm * scale
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w + 120} ${h + 125}`}
      role="img"
      aria-label="壁の展開図"
      style={{ width: '100%', maxHeight: 280, background: 'white' }}
    >
      <g transform="translate(65 60)" fontFamily="sans-serif" fontSize="12">
        <text x={w / 2} y={-42} textAnchor="middle" fill="#327e6d" fontSize="10">
          {b.startSide === 'right' ? '← 右から割り付け' : '左から割り付け →'}
        </text>
        <rect width={w} height={h} fill="#f5f8f6" stroke="#698777" />
        {r.drops.map((d) => (
          <g key={d.number} data-drop-number={d.number}>
            <rect
              x={d.xMm * scale}
              y={0}
              width={d.widthMm * scale}
              height={h}
              fill={d.skipped ? '#eee' : d.number % 2 ? '#e1efe9' : '#f1f7f4'}
              stroke="#698777"
              strokeWidth="0.7"
            />
            {d.widthMm * scale > 22 && (
              <text x={(d.xMm + d.widthMm / 2) * scale} y={h + 20} textAnchor="middle">
                {d.number}
              </text>
            )}
          </g>
        ))}
        {r.panel?.pieces.map((p) => {
          const largest = p.parts.reduce((a, c) => (a.w * a.h > c.w * c.h ? a : c))
          return (
            <g key={p.number} data-panel-number={p.number}>
              {p.parts.map((part, i) => (
                <rect
                  key={i}
                  x={part.x * scale}
                  y={(b.heightMm - part.y - part.h) * scale}
                  width={part.w * scale}
                  height={part.h * scale}
                  fill={p.full ? '#dcece3' : '#f8dfbd'}
                />
              ))}
              <rect
                x={Math.max(p.rect.x, 0) * scale}
                y={
                  (b.heightMm -
                    Math.min(p.rect.y + p.rect.h, r.panel!.target.y + r.panel!.target.h)) *
                  scale
                }
                width={(Math.min(p.rect.x + p.rect.w, r.widthMm) - Math.max(p.rect.x, 0)) * scale}
                height={
                  (Math.min(p.rect.y + p.rect.h, r.panel!.target.y + r.panel!.target.h) -
                    Math.max(p.rect.y, r.panel!.target.y)) *
                  scale
                }
                fill="none"
                stroke="#698777"
                strokeWidth="0.7"
              />
              {largest.w * scale > 22 && largest.h * scale > 16 && (
                <text
                  x={(largest.x + largest.w / 2) * scale}
                  y={(b.heightMm - largest.y - largest.h / 2) * scale}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="10"
                >
                  {p.number}
                </text>
              )}
            </g>
          )
        })}
        {b.openings.map((o) => (
          <g key={o.id}>
            <rect
              x={o.xMm * scale}
              y={(b.heightMm - o.bottomMm - o.heightMm) * scale}
              width={o.widthMm * scale}
              height={o.heightMm * scale}
              fill="white"
              stroke="#996843"
            />
            {o.widthMm * scale > 40 && (
              <text
                x={(o.xMm + o.widthMm / 2) * scale}
                y={(b.heightMm - o.bottomMm - o.heightMm / 2) * scale}
                textAnchor="middle"
              >
                {o.name.slice(0, 12)}
              </text>
            )}
          </g>
        ))}
        {r.panel && (r.panel.target.h !== b.heightMm || r.panel.target.y !== 0) && (
          <g fill="#a55e21">
            <path
              d={`M${w + 10},${(b.heightMm - r.panel.target.y - r.panel.target.h) * scale} h10 v${r.panel.target.h * scale} h-10`}
              fill="none"
              stroke="#a55e21"
            />
            <text
              transform={`translate(${w + 34} ${(b.heightMm - r.panel.target.y - r.panel.target.h / 2) * scale}) rotate(-90)`}
              textAnchor="middle"
            >
              施工高さ {r.panel.target.h} mm
            </text>
          </g>
        )}
        <path d={`M0,-10 v-10 H${w} v10 M-10,0 H-22 V${h} h12`} fill="none" stroke="#284638" />
        <text x={w / 2} y={-27} textAnchor="middle">
          {r.widthMm.toFixed(0)} mm
        </text>
        <text transform={`translate(-30 ${h / 2}) rotate(-90)`} textAnchor="middle">
          {b.heightMm.toFixed(0)} mm
        </text>
        <text x={0} y={h + 43}>
          左端（始点）
        </text>
        <text x={w} y={h + 43} textAnchor="end">
          右端（終点）
        </text>
      </g>
    </svg>
  )
}
