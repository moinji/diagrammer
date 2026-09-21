/**
 * 미니맵 — 큰 다이어그램에서 지금 어디를 보고 있는지 알려준다.
 * 클릭/드래그로 그 지점으로 이동한다.
 */
import React, { useMemo, useRef } from 'react'
import { useStore } from '../store/useStore'
import { boxRect, sceneBounds } from '../core/geometry'
import { isBox } from '../core/types'
import { getTheme } from '../core/theme'

const W = 190
const H = 130
const PAD = 8

export function Minimap() {
  const doc = useStore(s => s.doc)
  const viewport = useStore(s => s.viewport)
  const selection = useStore(s => s.selection)
  const ref = useRef<SVGSVGElement>(null)
  const theme = getTheme(doc.themeId)

  const stage = () => document.querySelector('.stage')?.getBoundingClientRect() ?? new DOMRect(0, 0, 900, 700)

  const { bounds, scale } = useMemo(() => {
    const b = sceneBounds(doc)
    if (!b || b.w <= 0 || b.h <= 0) return { bounds: { x: -100, y: -70, w: 200, h: 140 }, scale: 1 }
    const s = Math.min((W - PAD * 2) / b.w, (H - PAD * 2) / b.h)
    return { bounds: b, scale: s }
  }, [doc])

  const toMini = (x: number, y: number) => ({
    x: (x - bounds.x) * scale + (W - bounds.w * scale) / 2,
    y: (y - bounds.y) * scale + (H - bounds.h * scale) / 2,
  })

  // 현재 화면이 월드에서 차지하는 영역
  const st = stage()
  const viewWorld = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: st.width / viewport.zoom,
    h: st.height / viewport.zoom,
  }
  const vTL = toMini(viewWorld.x, viewWorld.y)

  const jump = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const wx = (mx - (W - bounds.w * scale) / 2) / scale + bounds.x
    const wy = (my - (H - bounds.h * scale) / 2) / scale + bounds.y
    useStore.getState().setViewport({
      x: st.width / 2 - wx * viewport.zoom,
      y: st.height / 2 - wy * viewport.zoom,
    })
  }

  const sel = new Set(selection)

  return (
    <div className="minimap" title="클릭해서 이동">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={e => {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          jump(e)
        }}
        onPointerMove={e => e.buttons === 1 && jump(e)}
      >
        <rect width={W} height={H} fill={theme.background} opacity={0.6} />
        {doc.order.map(id => {
          const el = doc.elements[id]
          if (!el || !isBox(el) || el.hidden) return null
          const r = boxRect(el)
          const p = toMini(r.x, r.y)
          const w = Math.max(1.5, r.w * scale)
          const h = Math.max(1.5, r.h * scale)
          const isSel = sel.has(id)
          return (
            <rect
              key={id}
              x={p.x}
              y={p.y}
              width={w}
              height={h}
              rx={1.5}
              fill={
                el.kind === 'group'
                  ? 'none'
                  : isSel
                    ? '#4d9fff'
                    : el.kind === 'image'
                      ? '#8892a4'
                      : el.style.fill === 'transparent'
                        ? theme.node.stroke
                        : el.style.fill
              }
              stroke={el.kind === 'group' ? '#4d9fff' : 'none'}
              strokeWidth={el.kind === 'group' ? 0.6 : 0}
              opacity={el.kind === 'group' ? 0.5 : 0.92}
            />
          )
        })}
        <rect
          x={vTL.x}
          y={vTL.y}
          width={Math.max(4, viewWorld.w * scale)}
          height={Math.max(4, viewWorld.h * scale)}
          fill="rgba(77,159,255,0.13)"
          stroke="#4d9fff"
          strokeWidth={1}
          rx={2}
        />
      </svg>
    </div>
  )
}
