/**
 * 기하 — 선택 판정, 바운딩 박스, 엣지 라우팅.
 * 렌더러와 내보내기가 같은 함수를 쓴다. 화면과 파일이 어긋나면 안 되기 때문이다.
 */
import type {
  Anchor, BoxElement, EdgeElement, Rect, SceneDoc, SceneElement, Vec,
} from './types'
import { isBox } from './types'
import { boundaryPoint } from './shapes'

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function boxRect(el: BoxElement): Rect {
  return { x: el.x - el.w / 2, y: el.y - el.h / 2, w: el.w, h: el.h }
}

export function rectCenter(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function rectContains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 }
}

/** 요소 하나의 경계 상자 (엣지·손그림 포함) */
export function elementBounds(doc: SceneDoc, el: SceneElement): Rect | null {
  if (isBox(el)) return boxRect(el)
  if (el.kind === 'edge') {
    const pts = edgePoints(doc, el)
    if (pts.length < 2) return null
    const rects: Rect[] = pts.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 }))
    // 라벨 상자도 경계에 넣어야 한다. 빼면 화면에는 보이는 긴 라벨이 내보낸 파일에서 잘린다.
    if (el.label) {
      const m = measureText(el.label, el.style.fontSize, el.style.fontWeight)
      const p = pointAt(pts, el.labelPos ?? 0.5)
      const off = el.labelOffset ?? { x: 0, y: 0 }
      rects.push({
        x: p.x + off.x - m.w / 2 - 6,
        y: p.y + off.y - m.h / 2 - 3,
        w: m.w + 12,
        h: m.h + 6,
      })
    }
    return unionRects(rects)
  }
  if (el.kind === 'freedraw') {
    if (!el.points.length) return null
    return unionRects(el.points.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 })))
  }
  return null
}

export function sceneBounds(doc: SceneDoc, ids?: string[]): Rect | null {
  const list = (ids ?? doc.order).map(id => doc.elements[id]).filter(Boolean) as SceneElement[]
  const rects = list.map(el => elementBounds(doc, el)).filter(Boolean) as Rect[]
  const box = unionRects(rects)
  if (box) return box
  // 자유 편집이 안 되는 종류(시퀀스·간트 등)는 요소가 없다. mermaid SVG 의 크기를 경계로 쓴다.
  if (!ids && doc.nativeSvg && doc.nativeSize) {
    return { x: 0, y: 0, w: doc.nativeSize.w, h: doc.nativeSize.h }
  }
  return null
}

// ── 앵커 ────────────────────────────────────────────────────────────
const ANCHOR_N: Record<string, { nx: number; ny: number }> = {
  t: { nx: 0.5, ny: 0 },
  r: { nx: 1, ny: 0.5 },
  b: { nx: 0.5, ny: 1 },
  l: { nx: 0, ny: 0.5 },
  tl: { nx: 0, ny: 0 },
  tr: { nx: 1, ny: 0 },
  bl: { nx: 0, ny: 1 },
  br: { nx: 1, ny: 1 },
}

export const ANCHOR_KEYS = ['t', 'r', 'b', 'l', 'tl', 'tr', 'bl', 'br'] as const

export function anchorPoint(el: BoxElement, anchor: Anchor, toward: Vec): Vec {
  if (anchor === 'auto') {
    const shape = el.kind === 'node' ? el.shape : 'rect'
    const radius = 'style' in el ? el.style.radius : 0
    return boundaryPoint(shape, el.x, el.y, el.w, el.h, toward, radius)
  }
  const n = typeof anchor === 'object' ? anchor : ANCHOR_N[anchor] ?? ANCHOR_N.t
  return {
    x: el.x - el.w / 2 + n.nx * el.w,
    y: el.y - el.h / 2 + n.ny * el.h,
  }
}

/** 앵커가 가리키는 방향(바깥쪽 법선). 직교 라우팅의 첫 걸음을 정한다. */
export function anchorNormal(el: BoxElement, anchor: Anchor, toward: Vec): Vec {
  if (anchor === 'auto') {
    const d = sub(toward, { x: el.x, y: el.y })
    return Math.abs(d.x) * el.h > Math.abs(d.y) * el.w
      ? { x: Math.sign(d.x) || 1, y: 0 }
      : { x: 0, y: Math.sign(d.y) || 1 }
  }
  const n = typeof anchor === 'object' ? anchor : ANCHOR_N[anchor] ?? ANCHOR_N.t
  if (n.ny === 0 && n.nx === 0.5) return { x: 0, y: -1 }
  if (n.ny === 1 && n.nx === 0.5) return { x: 0, y: 1 }
  if (n.nx === 0 && n.ny === 0.5) return { x: -1, y: 0 }
  if (n.nx === 1 && n.ny === 0.5) return { x: 1, y: 0 }
  return { x: n.nx < 0.5 ? -1 : 1, y: 0 }
}

// ── 엣지 경로 ───────────────────────────────────────────────────────
/** 엣지가 지나는 점들(월드 좌표). 첫 점 = 출발 도형 경계, 끝 점 = 도착 도형 경계 */
export function edgePoints(doc: SceneDoc, edge: EdgeElement): Vec[] {
  const src = doc.elements[edge.source]
  const tgt = doc.elements[edge.target]
  if (!isBox(src) || !isBox(tgt)) return []

  const waypoints = edge.routing === 'custom' && edge.waypoints?.length ? edge.waypoints : []

  const firstTarget = waypoints[0] ?? { x: tgt.x, y: tgt.y }
  const lastTarget = waypoints[waypoints.length - 1] ?? { x: src.x, y: src.y }

  const start = anchorPoint(src, edge.sourceAnchor, firstTarget)
  const end = anchorPoint(tgt, edge.targetAnchor, lastTarget)

  if (waypoints.length) return [start, ...waypoints, end]

  if (edge.routing === 'orthogonal') {
    return orthogonalRoute(src, tgt, edge, start, end)
  }
  // straight / curved 는 두 점만으로 충분. 곡선은 path 생성 단계에서 휜다.
  return [start, end]
}

function orthogonalRoute(src: BoxElement, tgt: BoxElement, edge: EdgeElement, start: Vec, end: Vec): Vec[] {
  const sn = anchorNormal(src, edge.sourceAnchor, { x: tgt.x, y: tgt.y })
  const tn = anchorNormal(tgt, edge.targetAnchor, { x: src.x, y: src.y })
  const pad = 22
  const a = { x: start.x + sn.x * pad, y: start.y + sn.y * pad }
  const b = { x: end.x + tn.x * pad, y: end.y + tn.y * pad }

  const pts: Vec[] = [start, a]
  const horizontalFirst = Math.abs(sn.x) > 0
  if (horizontalFirst) {
    pts.push({ x: a.x, y: a.y }, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y })
  } else {
    pts.push({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 })
  }
  pts.push(b, end)
  return dedupe(pts)
}

function dedupe(pts: Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p)
  }
  return out
}

/** 점들을 SVG path d 로. 곡선 옵션이면 Catmull-Rom → 베지어로 부드럽게. */
export function pointsToPath(pts: Vec[], routing: EdgeElement['routing'], cornerRadius = 8): string {
  if (pts.length < 2) return ''
  const r = (n: number) => Math.round(n * 100) / 100

  if (routing === 'straight' || pts.length === 2) {
    if (routing === 'curved' && pts.length === 2) {
      // 두 점뿐인 곡선은 살짝 휘어 보이도록 수직 방향으로 밀어준다
      const [p0, p1] = pts
      const mx = (p0.x + p1.x) / 2
      const my = (p0.y + p1.y) / 2
      const dx = p1.x - p0.x
      const dy = p1.y - p0.y
      const len = Math.hypot(dx, dy) || 1
      const off = Math.min(28, len * 0.14)
      const cx = mx + (-dy / len) * off
      const cy = my + (dx / len) * off
      return `M${r(p0.x)},${r(p0.y)} Q${r(cx)},${r(cy)} ${r(p1.x)},${r(p1.y)}`
    }
    return `M${r(pts[0].x)},${r(pts[0].y)} ` + pts.slice(1).map(p => `L${r(p.x)},${r(p.y)}`).join(' ')
  }

  if (routing === 'curved') {
    return catmullRom(pts)
  }

  // orthogonal / custom — 모서리를 둥글게
  let d = `M${r(pts[0].x)},${r(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const inLen = dist(prev, cur)
    const outLen = dist(cur, next)
    const rad = Math.min(cornerRadius, inLen / 2, outLen / 2)
    if (rad < 1) {
      d += ` L${r(cur.x)},${r(cur.y)}`
      continue
    }
    const p1 = lerpTo(cur, prev, rad)
    const p2 = lerpTo(cur, next, rad)
    d += ` L${r(p1.x)},${r(p1.y)} Q${r(cur.x)},${r(cur.y)} ${r(p2.x)},${r(p2.y)}`
  }
  const last = pts[pts.length - 1]
  d += ` L${r(last.x)},${r(last.y)}`
  return d
}

function lerpTo(from: Vec, toward: Vec, by: number): Vec {
  const d = dist(from, toward) || 1
  const t = Math.min(1, by / d)
  return { x: from.x + (toward.x - from.x) * t, y: from.y + (toward.y - from.y) * t }
}

function catmullRom(pts: Vec[]): string {
  const r = (n: number) => Math.round(n * 100) / 100
  let d = `M${r(pts[0].x)},${r(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(p2.x)},${r(p2.y)}`
  }
  return d
}

/** 점이 폴리라인 위(허용오차 내)에 있는가 — 엣지 클릭 판정 */
export function nearPolyline(pts: Vec[], p: Vec, tolerance: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointSegDistance(p, pts[i], pts[i + 1]) <= tolerance) return true
  }
  return false
}

export function pointSegDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
  t = clamp(t, 0, 1)
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** 폴리라인에서 t(0..1) 위치의 점 */
export function pointAt(pts: Vec[], t: number): Vec {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1) return pts[0]
  const segs: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const d = dist(pts[i], pts[i + 1])
    segs.push(d)
    total += d
  }
  if (total === 0) return pts[0]
  let target = clamp(t, 0, 1) * total
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const k = segs[i] === 0 ? 0 : target / segs[i]
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k }
    }
    target -= segs[i]
  }
  return pts[pts.length - 1]
}

// ── 스마트 가이드(정렬 스냅) ────────────────────────────────────────
export interface SnapGuide {
  axis: 'x' | 'y'
  value: number
  from: number
  to: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

/**
 * 이동 중인 박스를 다른 박스들의 정렬선(왼쪽/중앙/오른쪽, 위/중앙/아래)에 붙인다.
 * 임계값 안에서 가장 가까운 선 하나씩만 채택한다. 여러 선을 동시에 붙이면 떨림이 생긴다.
 */
export function computeSnap(moving: Rect, others: Rect[], threshold: number): SnapResult {
  const movX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w]
  const movY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]

  let bestX: { delta: number; guide: SnapGuide } | null = null
  let bestY: { delta: number; guide: SnapGuide } | null = null

  for (const o of others) {
    const oX = [o.x, o.x + o.w / 2, o.x + o.w]
    const oY = [o.y, o.y + o.h / 2, o.y + o.h]
    for (const mx of movX) {
      for (const ox of oX) {
        const delta = ox - mx
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = {
            delta,
            guide: {
              axis: 'x',
              value: ox,
              from: Math.min(o.y, moving.y) - 20,
              to: Math.max(o.y + o.h, moving.y + moving.h) + 20,
            },
          }
        }
      }
    }
    for (const my of movY) {
      for (const oy of oY) {
        const delta = oy - my
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = {
            delta,
            guide: {
              axis: 'y',
              value: oy,
              from: Math.min(o.x, moving.x) - 20,
              to: Math.max(o.x + o.w, moving.x + moving.w) + 20,
            },
          }
        }
      }
    }
  }

  return {
    dx: bestX?.delta ?? 0,
    dy: bestY?.delta ?? 0,
    guides: [bestX?.guide, bestY?.guide].filter(Boolean) as SnapGuide[],
  }
}

export function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid
}

// ── 텍스트 측정 ─────────────────────────────────────────────────────
let measureCtx: CanvasRenderingContext2D | null = null

export function measureText(
  text: string,
  fontSize: number,
  fontWeight: number,
  fontFamily = 'Pretendard, system-ui, sans-serif',
): { w: number; h: number; lines: string[] } {
  const lines = String(text || '').split('\n')
  if (!measureCtx) {
    const c = document.createElement('canvas')
    measureCtx = c.getContext('2d')
  }
  let w = 0
  if (measureCtx) {
    measureCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
    for (const line of lines) w = Math.max(w, measureCtx.measureText(line).width)
  } else {
    for (const line of lines) w = Math.max(w, line.length * fontSize * 0.6)
  }
  return { w, h: lines.length * fontSize * 1.35, lines }
}

/** 텍스트를 주어진 최대 폭에 맞춰 줄바꿈. 한글은 단어 경계가 드물어 글자 단위 폴백이 필요하다. */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
  fontFamily?: string,
): string[] {
  const paragraphs = String(text || '').split('\n')
  const out: string[] = []
  for (const para of paragraphs) {
    if (!para) {
      out.push('')
      continue
    }
    const words = para.split(/(\s+)/)
    let line = ''
    for (const word of words) {
      const test = line + word
      if (measureText(test, fontSize, fontWeight, fontFamily).w <= maxWidth || !line) {
        line = test
      } else {
        out.push(line.trimEnd())
        line = word.trimStart()
      }
      // 한 단어가 줄보다 길면 글자 단위로 자른다
      while (measureText(line, fontSize, fontWeight, fontFamily).w > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measureText(line.slice(0, cut), fontSize, fontWeight, fontFamily).w > maxWidth) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    out.push(line)
  }
  return out
}
