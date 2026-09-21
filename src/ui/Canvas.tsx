/**
 * 캔버스 — 보기와 편집.
 *
 * 인터랙션 원칙 (macOS 트랙패드 1순위)
 *  - 두 손가락 스크롤 = 팬,  핀치(= wheel + ctrlKey) = 커서 기준 줌,  ⌘+휠 = 줌
 *  - 스페이스 드래그 / 가운데 버튼 드래그 / 빈 곳 우클릭 드래그 = 팬
 *  - 빈 곳 드래그 = 사각 선택(교차 방식 — draw.io·Figma 와 동일하게 걸치기만 해도 선택)
 *  - 노드에 마우스를 올리면 4방향 연결점이 뜨고, 거기서 끌면 연결선이 생긴다.
 *    빈 곳에 놓으면 새 노드를 만들어 바로 잇는다(draw.io 방식).
 *
 * 되돌리기 경계는 pointerdown/pointerup 이다. 드래그 중에는 커밋하지 않는다.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, EdgeElement, ID, Rect, SceneElement, Vec } from '../core/types'
import { GRID_SIZE, SNAP_THRESHOLD, isBox } from '../core/types'
import {
  ANCHOR_KEYS, anchorPoint, boxRect, computeSnap, edgePoints, elementBounds,
  expandRect, nearPolyline, pointAt, rectIntersects, sceneBounds, type SnapGuide,
} from '../core/geometry'
import { SceneDefs, SceneLayer, docBackground, FONT_STACK } from '../render/SceneView'
import { clampZoom, maybeSnap, screenToWorld, useStore, worldToScreen } from '../store/useStore'
import { getTheme } from '../core/theme'

type Interaction =
  | { type: 'none' }
  | { type: 'pan'; startScreen: Vec; startViewport: { x: number; y: number } }
  | { type: 'marquee'; start: Vec; cur: Vec; mode: 'replace' | 'add' }
  | { type: 'move'; start: Vec; last: Vec; moved: boolean }
  | { type: 'resize'; handle: string; start: Vec; origin: Map<ID, Rect>; keepAspect: boolean }
  | { type: 'connect'; from: ID; anchor: Anchor; cur: Vec; target: ID | null }
  | { type: 'waypoint'; edgeId: ID; index: number }
  | { type: 'draw'; points: Vec[] }

const HANDLES: { key: string; nx: number; ny: number; cursor: string }[] = [
  { key: 'nw', nx: 0, ny: 0, cursor: 'nwse-resize' },
  { key: 'n', nx: 0.5, ny: 0, cursor: 'ns-resize' },
  { key: 'ne', nx: 1, ny: 0, cursor: 'nesw-resize' },
  { key: 'e', nx: 1, ny: 0.5, cursor: 'ew-resize' },
  { key: 'se', nx: 1, ny: 1, cursor: 'nwse-resize' },
  { key: 's', nx: 0.5, ny: 1, cursor: 'ns-resize' },
  { key: 'sw', nx: 0, ny: 1, cursor: 'nesw-resize' },
  { key: 'w', nx: 0, ny: 0.5, cursor: 'ew-resize' },
]

export function Canvas() {
  const doc = useStore(s => s.doc)
  const viewport = useStore(s => s.viewport)
  const selection = useStore(s => s.selection)
  const tool = useStore(s => s.tool)
  const hoverId = useStore(s => s.hoverId)
  const editing = useStore(s => s.editing)
  const ui = useStore(s => s.ui)

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const interactionRef = useRef<Interaction>({ type: 'none' })
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender(n => n + 1), [])
  const [spaceDown, setSpaceDown] = useState(false)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const theme = getTheme(doc.themeId)

  const rect = () => containerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 800, 600)

  // ── 첫 진입 시 화면 맞춤 ──
  const fittedFor = useRef<string>('')
  useLayoutEffect(() => {
    const key = doc.id + ':' + doc.order.length
    if (!doc.order.length && !doc.nativeSvg) return
    if (fittedFor.current === key) return
    const r = containerRef.current?.getBoundingClientRect()
    // 크기가 아직 0 이면 이번 차례를 건너뛴다. key 를 기록하지 않아야 다음 렌더에서 다시 시도한다.
    if (!r || r.width < 80 || r.height < 80) return
    fittedFor.current = key
    useStore.getState().fitToScreen(r)
  }, [doc.id, doc.order.length, doc.nativeSvg])

  // ── 휠: 팬/줌 ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      // macOS 트랙패드 핀치는 ctrlKey 가 켜진 wheel 로 온다
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0125)
        useStore.getState().zoomAt(factor, { x: e.clientX, y: e.clientY }, r)
      } else {
        const v = useStore.getState().viewport
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
        useStore.getState().setViewport({ x: v.x - e.deltaX * k, y: v.y - e.deltaY * k })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── 스페이스바 팬 ──
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ── 적중 판정 ──
  const hitTest = useCallback(
    (world: Vec): SceneElement | null => {
      const tol = 8 / viewport.zoom
      // 앞에 그려진 것부터 (order 역순)
      for (let i = doc.order.length - 1; i >= 0; i--) {
        const el = doc.elements[doc.order[i]]
        if (!el || el.hidden) continue
        if (el.kind === 'edge') {
          const pts = edgePoints(doc, el)
          if (pts.length >= 2 && nearPolyline(pts, world, tol + el.style.strokeWidth)) return el
          continue
        }
        if (el.kind === 'freedraw') {
          if (nearPolyline(el.points, world, tol + el.style.strokeWidth)) return el
          continue
        }
        if (isBox(el)) {
          const r = boxRect(el)
          if (el.kind === 'group') {
            // 그룹은 테두리와 제목 영역만 잡는다. 안쪽을 클릭하면 내부 요소가 잡혀야 한다.
            const inner = { x: r.x + 6, y: r.y + 30, w: Math.max(0, r.w - 12), h: Math.max(0, r.h - 36) }
            const insideOuter = world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h
            const insideInner = world.x >= inner.x && world.x <= inner.x + inner.w && world.y >= inner.y && world.y <= inner.y + inner.h
            if (insideOuter && !insideInner) return el
            continue
          }
          if (world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h) return el
        }
      }
      return null
    },
    [doc, viewport.zoom],
  )

  // ── 포인터 ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) commitEditing()
    const r = rect()
    const world = screenToWorld({ x: e.clientX, y: e.clientY }, viewport, r)
    const st = useStore.getState()
    const target = e.target as Element
    const handleKey = target.getAttribute?.('data-handle')
    const portInfo = target.getAttribute?.('data-port')
    const wpInfo = target.getAttribute?.('data-waypoint')
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)

    // 팬
    if (spaceDown || e.button === 1 || tool === 'pan' || (e.button === 2 && !hitTest(world))) {
      interactionRef.current = {
        type: 'pan',
        startScreen: { x: e.clientX, y: e.clientY },
        startViewport: { x: viewport.x, y: viewport.y },
      }
      rerender()
      return
    }
    if (e.button !== 0) return

    // 경유점 드래그
    if (wpInfo) {
      const [edgeId, idxStr] = wpInfo.split(':')
      st.beginInteraction()
      interactionRef.current = { type: 'waypoint', edgeId, index: Number(idxStr) }
      rerender()
      return
    }

    // 연결점에서 끌기
    if (portInfo) {
      const [nodeId, anchorKey] = portInfo.split(':')
      interactionRef.current = { type: 'connect', from: nodeId, anchor: anchorKey as Anchor, cur: world, target: null }
      rerender()
      return
    }

    // 리사이즈 핸들
    if (handleKey) {
      const origin = new Map<ID, Rect>()
      for (const id of selection) {
        const el = doc.elements[id]
        if (isBox(el)) origin.set(id, boxRect(el))
      }
      st.beginInteraction()
      interactionRef.current = { type: 'resize', handle: handleKey, start: world, origin, keepAspect: e.shiftKey }
      rerender()
      return
    }

    // 도구별 생성
    if (tool === 'node') {
      const id = st.addNode({ x: maybeSnap(world.x, ui.snapEnabled), y: maybeSnap(world.y, ui.snapEnabled) })
      st.setTool('select')
      st.setEditing({ id })
      return
    }
    if (tool === 'text') {
      const id = st.addText({ x: world.x, y: world.y })
      st.setTool('select')
      st.setEditing({ id })
      return
    }
    if (tool === 'freedraw') {
      st.beginInteraction()
      interactionRef.current = { type: 'draw', points: [world] }
      rerender()
      return
    }

    const hit = hitTest(world)
    if (hit) {
      const already = selection.includes(hit.id)
      if (e.shiftKey || e.metaKey) {
        st.select([hit.id], 'toggle')
      } else if (!already) {
        st.select([hit.id], 'replace')
      }
      if (tool === 'edge') {
        interactionRef.current = { type: 'connect', from: hit.id, anchor: 'auto', cur: world, target: null }
        rerender()
        return
      }
      st.beginInteraction()
      interactionRef.current = { type: 'move', start: world, last: world, moved: false }
      rerender()
      return
    }

    // 빈 곳 → 사각 선택
    if (!e.shiftKey && !e.metaKey) st.clearSelection()
    interactionRef.current = { type: 'marquee', start: world, cur: world, mode: e.shiftKey || e.metaKey ? 'add' : 'replace' }
    rerender()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const r = rect()
    const world = screenToWorld({ x: e.clientX, y: e.clientY }, viewport, r)
    const it = interactionRef.current
    const st = useStore.getState()

    if (it.type === 'none') {
      const hit = hitTest(world)
      if (hit?.id !== hoverId) st.setHover(hit?.id ?? null)
      return
    }

    switch (it.type) {
      case 'pan': {
        st.setViewport({
          x: it.startViewport.x + (e.clientX - it.startScreen.x),
          y: it.startViewport.y + (e.clientY - it.startScreen.y),
        })
        break
      }
      case 'marquee': {
        it.cur = world
        rerender()
        const box = normRect(it.start, it.cur)
        const hits: ID[] = []
        for (const id of doc.order) {
          const el = doc.elements[id]
          if (!el || el.hidden || el.locked) continue
          const b = elementBounds(doc, el)
          if (b && rectIntersects(box, b)) hits.push(id)
        }
        st.select(hits, it.mode === 'add' ? 'add' : 'replace')
        break
      }
      case 'move': {
        let dx = world.x - it.last.x
        let dy = world.y - it.last.y
        if (!it.moved && Math.hypot(world.x - it.start.x, world.y - it.start.y) < 2 / viewport.zoom) break
        it.moved = true

        // 스마트 가이드 — 선택 묶음의 경계 상자를 다른 요소들에 맞춘다
        if (ui.snapEnabled && selection.length) {
          const moving = sceneBounds(doc, selection)
          if (moving) {
            const candidate = { ...moving, x: moving.x + dx, y: moving.y + dy }
            const others: Rect[] = []
            const sel = new Set(selection)
            for (const id of doc.order) {
              if (sel.has(id)) continue
              const el = doc.elements[id]
              if (!isBox(el)) continue
              others.push(boxRect(el))
            }
            const snap = computeSnap(candidate, others, SNAP_THRESHOLD / viewport.zoom)
            dx += snap.dx
            dy += snap.dy
            setGuides(snap.guides)
          }
        }
        st.moveBy(selection, dx, dy)
        it.last = { x: it.last.x + dx, y: it.last.y + dy }
        break
      }
      case 'resize': {
        const dx = world.x - it.start.x
        const dy = world.y - it.start.y
        for (const [id, orig] of it.origin) {
          const next = resizeRect(orig, it.handle, dx, dy, it.keepAspect)
          st.updateElement(id, {
            x: next.x + next.w / 2,
            y: next.y + next.h / 2,
            w: Math.max(20, next.w),
            h: Math.max(16, next.h),
            pinned: true,
          } as Partial<SceneElement>)
        }
        break
      }
      case 'connect': {
        it.cur = world
        const hit = hitTest(world)
        it.target = hit && isBox(hit) && hit.id !== it.from ? hit.id : null
        rerender()
        break
      }
      case 'waypoint': {
        const edge = doc.elements[it.edgeId]
        if (edge?.kind !== 'edge' || !edge.waypoints) break
        const wp = [...edge.waypoints]
        wp[it.index] = { x: maybeSnap(world.x, ui.snapEnabled), y: maybeSnap(world.y, ui.snapEnabled) }
        st.updateElement(it.edgeId, { waypoints: wp, autoWaypoints: false, routing: 'custom' } as Partial<SceneElement>)
        break
      }
      case 'draw': {
        it.points.push(world)
        rerender()
        break
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const it = interactionRef.current
    const st = useStore.getState()
    const r = rect()
    const world = screenToWorld({ x: e.clientX, y: e.clientY }, viewport, r)

    if (it.type === 'move' || it.type === 'resize' || it.type === 'waypoint') {
      // 위치·크기만 바뀌었다 — 코드 본문은 그대로 두고 배치 주석만 갱신한다
      st.endInteraction('geometry')
    } else if (it.type === 'connect') {
      const src = doc.elements[it.from]
      // 노드 생성 + 연결선 생성을 한 번의 되돌리기 단위로 묶는다
      st.beginInteraction()
      if (it.target) {
        st.addEdge(it.from, it.target, { sourceAnchor: it.anchor })
      } else if (isBox(src)) {
        // 빈 곳에 놓았다 — 충분히 끌었으면 거기에 새 노드를 만들어 잇는다
        const dragged = Math.hypot(world.x - src.x, world.y - src.y) > Math.max(src.w, src.h) / 2 + 24
        if (dragged) {
          const newId = st.addNode(
            { x: maybeSnap(world.x, ui.snapEnabled), y: maybeSnap(world.y, ui.snapEnabled) },
            { shape: src.kind === 'node' ? src.shape : 'rect', w: src.w, h: src.h },
          )
          st.addEdge(it.from, newId, { sourceAnchor: it.anchor })
          st.select([newId])
          st.setEditing({ id: newId })
        }
      }
      st.endInteraction()
      st.setTool('select')
    } else if (it.type === 'draw') {
      if (it.points.length > 2) {
        const themeNow = getTheme(doc.themeId)
        const id = `fd_${Date.now().toString(36)}`
        st.setDoc({
          ...st.doc,
          elements: {
            ...st.doc.elements,
            [id]: { id, kind: 'freedraw', points: it.points, style: { ...themeNow.edge, strokeWidth: 2.4 } },
          },
          order: [...st.doc.order, id],
          freeEdits: true,
        })
      }
      st.endInteraction()
    }

    interactionRef.current = { type: 'none' }
    setGuides([])
    rerender()
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const r = rect()
    const world = screenToWorld({ x: e.clientX, y: e.clientY }, viewport, r)
    const hit = hitTest(world)
    const st = useStore.getState()
    if (!hit) {
      const id = st.addNode({ x: maybeSnap(world.x, ui.snapEnabled), y: maybeSnap(world.y, ui.snapEnabled) })
      st.setEditing({ id })
      return
    }
    if (hit.kind === 'edge') {
      // 선분 위를 더블클릭하면 경유점을 추가한다
      const pts = edgePoints(doc, hit)
      const wp = hit.waypoints ? [...hit.waypoints] : []
      let insertAt = wp.length
      let bestD = Infinity
      for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.hypot((pts[i].x + pts[i + 1].x) / 2 - world.x, (pts[i].y + pts[i + 1].y) / 2 - world.y)
        if (d < bestD) {
          bestD = d
          insertAt = Math.min(i, wp.length)
        }
      }
      st.beginInteraction()
      wp.splice(insertAt, 0, world)
      st.updateElement(hit.id, { waypoints: wp, routing: 'custom', autoWaypoints: false } as Partial<SceneElement>)
      st.endInteraction()
      return
    }
    st.select([hit.id])
    st.setEditing({ id: hit.id })
  }

  /**
   * 편집기를 '그냥 닫으면' 안 된다.
   * setEditing(null) 만 하면 textarea 가 사라지면서 blur 가 오지 않아 finish() 가 실행되지 않고,
   * 캔버스 글자와 코드가 영구히 어긋난다(저장까지 그대로 나간다).
   * 먼저 blur 를 보내 finish() 를 태우고, 혹시 못 돌았을 때만 강제로 닫는다.
   */
  const commitEditing = () => {
    const ta = document.querySelector<HTMLTextAreaElement>('.inline-editor')
    if (ta) ta.blur()
    if (useStore.getState().editing) useStore.getState().setEditing(null)
  }

  // ── 화면 좌표 도우미 ──
  const toScreen = (p: Vec) => worldToScreen(p, viewport)

  const selectionBoxes = useMemo(
    () => selection.map(id => doc.elements[id]).filter(isBox),
    [selection, doc.elements],
  )
  const selBounds = useMemo(() => sceneBounds(doc, selection), [doc, selection])
  const selectedEdges = useMemo(
    () => selection.map(id => doc.elements[id]).filter(e => e?.kind === 'edge') as EdgeElement[],
    [selection, doc.elements],
  )

  const hoverEl = hoverId ? doc.elements[hoverId] : null
  const showPorts =
    tool === 'select' && hoverEl && hoverEl.kind === 'node' && interactionRef.current.type === 'none'

  const it = interactionRef.current
  const cursor =
    spaceDown || it.type === 'pan' ? 'grabbing'
      : tool === 'pan' ? 'grab'
        : tool === 'node' || tool === 'text' ? 'crosshair'
          : tool === 'freedraw' ? 'crosshair'
            : 'default'

  return (
    <div
      ref={containerRef}
      className="canvas-root"
      style={{ background: docBackground(doc), cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={e => e.preventDefault()}
    >
      <svg ref={svgRef} className="canvas-svg" width="100%" height="100%" data-diagrammer-canvas>
        <SceneDefs doc={doc} />
        {ui.showGrid && <GridPattern viewport={viewport} color={theme.grid} />}

        <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
          {doc.nativeSvg ? <NativeSvgLayer svg={doc.nativeSvg} /> : <SceneLayer doc={doc} />}
        </g>

        {/* 상호작용 오버레이 — 내보내기에는 포함되지 않는다 */}
        <g data-export="skip">
          {guides.map((g, i) => {
            const a = toScreen(g.axis === 'x' ? { x: g.value, y: g.from } : { x: g.from, y: g.value })
            const b = toScreen(g.axis === 'x' ? { x: g.value, y: g.to } : { x: g.to, y: g.value })
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff4d8d" strokeWidth={1} strokeDasharray="4 3" />
          })}

          {selectionBoxes.map(el => {
            const r0 = boxRect(el)
            const a = toScreen({ x: r0.x, y: r0.y })
            const b = toScreen({ x: r0.x + r0.w, y: r0.y + r0.h })
            return (
              <rect
                key={el.id}
                x={a.x - 1}
                y={a.y - 1}
                width={b.x - a.x + 2}
                height={b.y - a.y + 2}
                fill="none"
                stroke="#4d9fff"
                strokeWidth={1.5}
                rx={3}
              />
            )
          })}

          {selectedEdges.map(edge => {
            const pts = edgePoints(doc, edge)
            const scr = pts.map(toScreen)
            return (
              <g key={edge.id}>
                <polyline points={scr.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4d9fff" strokeWidth={1.5} opacity={0.65} />
                {(edge.waypoints ?? []).map((wp, i) => {
                  const p = toScreen(wp)
                  return (
                    <circle
                      key={i}
                      data-waypoint={`${edge.id}:${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={5}
                      fill="#fff"
                      stroke="#4d9fff"
                      strokeWidth={1.6}
                      style={{ cursor: 'move' }}
                    />
                  )
                })}
              </g>
            )
          })}

          {selBounds && selection.length > 0 && selectionBoxes.length > 0 && (
            <ResizeHandles bounds={selBounds} toScreen={toScreen} />
          )}

          {showPorts && hoverEl && isBox(hoverEl) && <Ports el={hoverEl} toScreen={toScreen} />}

          {it.type === 'marquee' && (
            <MarqueeRect start={toScreen(it.start)} cur={toScreen(it.cur)} />
          )}

          {it.type === 'connect' && (
            <ConnectPreview
              from={(() => {
                const src = doc.elements[it.from]
                return isBox(src) ? toScreen(anchorPoint(src, it.anchor, it.cur)) : null
              })()}
              to={toScreen(it.cur)}
              snapped={!!it.target}
            />
          )}

          {it.type === 'draw' && it.points.length > 1 && (
            <polyline
              points={it.points.map(p => { const q = toScreen(p); return `${q.x},${q.y}` }).join(' ')}
              fill="none"
              stroke={theme.edge.stroke}
              strokeWidth={2.4 * viewport.zoom}
              strokeLinecap="round"
            />
          )}
        </g>
      </svg>

      {editing && <InlineEditor key={editing.id} id={editing.id} viewport={viewport} onDone={commitEditing} />}

      <ZoomBadge />
    </div>
  )
}

// ── 보조 컴포넌트 ───────────────────────────────────────────────────
function GridPattern({ viewport, color }: { viewport: { x: number; y: number; zoom: number }; color: string }) {
  const size = GRID_SIZE * viewport.zoom
  if (size < 5) return null
  const major = size * 5
  return (
    <>
      <defs>
        <pattern id="dgm-grid" width={size} height={size} patternUnits="userSpaceOnUse" x={viewport.x} y={viewport.y}>
          <path d={`M${size} 0 L0 0 0 ${size}`} fill="none" stroke={color} strokeWidth={0.6} />
        </pattern>
        <pattern id="dgm-grid-major" width={major} height={major} patternUnits="userSpaceOnUse" x={viewport.x} y={viewport.y}>
          <rect width={major} height={major} fill="url(#dgm-grid)" />
          <path d={`M${major} 0 L0 0 0 ${major}`} fill="none" stroke={color} strokeWidth={1.2} />
        </pattern>
      </defs>
      <rect data-export="skip" width="100%" height="100%" fill="url(#dgm-grid-major)" />
    </>
  )
}

const NATIVE_ID = 'dgm-native'

/**
 * mermaid 가 그린 SVG 를 그대로 얹는다(자유 편집 불가 타입).
 *
 * 함정: mermaid 의 <style> 은 `#원본SVG아이디 .messageText {...}` 처럼 **루트 id 로 스코프**되어 있다.
 * inner 만 꺼내 다른 svg 안에 넣으면 그 id 가 사라져 CSS 가 전부 매칭에 실패한다.
 * 화면에서는 우연히 괜찮아 보여도 내보낸 파일에서 글자색이 통째로 날아간다.
 * 그래서 스코프 id 를 우리가 붙이는 고정 id 로 바꿔 쓴다.
 */
function NativeSvgLayer({ svg }: { svg: string }) {
  const html = useMemo(() => {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = parsed.querySelector('svg')
    if (!root) return svg
    const vb = (root.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number)
    const rootId = root.getAttribute('id')

    if (rootId) {
      // CSS 안의 #rootId 를 우리 id 로 치환한다 (정규식 특수문자 이스케이프 필수)
      const esc = rootId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp('#' + esc + '(?![\\w-])', 'g')
      root.querySelectorAll('style').forEach(st => {
        st.textContent = (st.textContent || '').replace(re, '#' + NATIVE_ID)
      })
      // url(#rootId_marker) 형태의 참조는 id 자체가 바뀌지 않으므로 그대로 둔다
    }

    return `<g id="${NATIVE_ID}" transform="translate(${-vb[0]},${-vb[1]})">${root.innerHTML}</g>`
  }, [svg])
  return <g data-layer="scene" dangerouslySetInnerHTML={{ __html: html }} />
}

function ResizeHandles({ bounds, toScreen }: { bounds: Rect; toScreen: (p: Vec) => Vec }) {
  const a = toScreen({ x: bounds.x, y: bounds.y })
  const b = toScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h })
  const w = b.x - a.x
  const h = b.y - a.y
  return (
    <g>
      {HANDLES.map(hd => (
        <rect
          key={hd.key}
          data-handle={hd.key}
          x={a.x + w * hd.nx - 4.5}
          y={a.y + h * hd.ny - 4.5}
          width={9}
          height={9}
          rx={2}
          fill="#fff"
          stroke="#4d9fff"
          strokeWidth={1.4}
          style={{ cursor: hd.cursor }}
        />
      ))}
    </g>
  )
}

function Ports({ el, toScreen }: { el: SceneElement & { x: number; y: number; w: number; h: number }; toScreen: (p: Vec) => Vec }) {
  const keys: Anchor[] = ['t', 'r', 'b', 'l']
  return (
    <g>
      {keys.map(k => {
        const p = toScreen(anchorPoint(el as any, k, { x: el.x, y: el.y }))
        return (
          <circle
            key={String(k)}
            data-port={`${el.id}:${k}`}
            cx={p.x}
            cy={p.y}
            r={5.5}
            fill="#4d9fff"
            stroke="#fff"
            strokeWidth={1.6}
            style={{ cursor: 'crosshair' }}
          >
            <title>끌어서 연결 · 빈 곳에 놓으면 새 노드</title>
          </circle>
        )
      })}
    </g>
  )
}

function MarqueeRect({ start, cur }: { start: Vec; cur: Vec }) {
  const x = Math.min(start.x, cur.x)
  const y = Math.min(start.y, cur.y)
  return (
    <rect
      x={x}
      y={y}
      width={Math.abs(cur.x - start.x)}
      height={Math.abs(cur.y - start.y)}
      fill="rgba(77,159,255,0.12)"
      stroke="#4d9fff"
      strokeWidth={1}
      strokeDasharray="4 3"
    />
  )
}

function ConnectPreview({ from, to, snapped }: { from: Vec | null; to: Vec; snapped: boolean }) {
  if (!from) return null
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#4d9fff" strokeWidth={2} strokeDasharray="5 4" />
      <circle cx={to.x} cy={to.y} r={snapped ? 8 : 4} fill={snapped ? 'rgba(77,159,255,0.35)' : '#4d9fff'} stroke="#4d9fff" strokeWidth={1.5} />
    </g>
  )
}

function ZoomBadge() {
  const zoom = useStore(s => s.viewport.zoom)
  return <div className="zoom-badge">{Math.round(zoom * 100)}%</div>
}

/**
 * 인라인 텍스트 편집기.
 * SVG foreignObject 가 아니라 HTML 오버레이다 — 한글 IME 조합이 정상 동작하고,
 * 내보낸 SVG 에 편집용 요소가 섞이지 않는다.
 */
function InlineEditor({ id, viewport, onDone }: { id: ID; viewport: { x: number; y: number; zoom: number }; onDone: () => void }) {
  const el = useStore(s => s.doc.elements[id])
  const setText = useStore(s => s.setText)
  const autoSize = useStore(s => s.autoSizeNode)
  const commit = useStore(s => s.commit)
  const syncCode = useStore(s => s.syncCodeFromScene)
  const ref = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const committed = useRef(false)

  const initial = useMemo(() => {
    if (!el) return ''
    if (el.kind === 'group') return el.title
    if (el.kind === 'edge') return el.label
    return 'text' in el ? el.text : ''
  }, [id])

  useEffect(() => {
    commit()
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!el) return null

  let box: Rect
  if (isBox(el)) box = boxRect(el)
  else if (el.kind === 'edge') {
    const pts = edgePoints(useStore.getState().doc, el)
    const p = pointAt(pts, el.labelPos ?? 0.5)
    box = { x: p.x - 70, y: p.y - 14, w: 140, h: 28 }
  } else return null

  const a = worldToScreen({ x: box.x, y: box.y }, viewport)
  // 엣지 라벨은 EdgeStyle 이라 align/fontFamily 가 없다. 노드류만 좁혀서 읽는다.
  const boxStyle = el.kind === 'node' || el.kind === 'text' || el.kind === 'group' ? el.style : null
  const style = 'style' in el ? el.style : null
  const fontSize = (style?.fontSize ?? 14) * viewport.zoom

  const finish = () => {
    if (committed.current) return
    committed.current = true
    if (el.kind === 'node' || el.kind === 'text') autoSize(id)
    syncCode()
    onDone()
  }

  return (
    <textarea
      ref={ref}
      className="inline-editor"
      defaultValue={initial}
      style={{
        left: a.x,
        top: a.y,
        width: box.w * viewport.zoom,
        height: box.h * viewport.zoom,
        fontSize,
        lineHeight: 1.35,
        fontFamily: boxStyle?.fontFamily || FONT_STACK,
        fontWeight: style?.fontWeight ?? 500,
        color: style?.color ?? '#fff',
        textAlign: (boxStyle?.align ?? 'center') as React.CSSProperties['textAlign'],
      }}
      onChange={e => setText(id, e.target.value)}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false }}
      onBlur={finish}
      onKeyDown={e => {
        e.stopPropagation()
        // 한글 조합 중의 Enter 는 글자 확정이지 편집 종료가 아니다
        if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
          e.preventDefault()
          finish()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setText(id, initial)
          finish()
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          finish()
        }
      }}
    />
  )
}

// ── 순수 함수 ───────────────────────────────────────────────────────
function normRect(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

function resizeRect(r: Rect, handle: string, dx: number, dy: number, keepAspect: boolean): Rect {
  let { x, y, w, h } = r
  if (handle.includes('w')) {
    x += dx
    w -= dx
  }
  if (handle.includes('e')) w += dx
  if (handle.includes('n')) {
    y += dy
    h -= dy
  }
  if (handle.includes('s')) h += dy
  if (keepAspect && r.w > 0 && r.h > 0) {
    const ratio = r.w / r.h
    if (Math.abs(w / (h || 1) - ratio) > 0.001) {
      h = w / ratio
      if (handle.includes('n')) y = r.y + r.h - h
    }
  }
  if (w < 0) {
    x += w
    w = -w
  }
  if (h < 0) {
    y += h
    h = -h
  }
  return { x, y, w, h }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || !!el.closest?.('.cm-editor')
}
