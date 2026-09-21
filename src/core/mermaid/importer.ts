/**
 * mermaid 코드 → Scene 변환.
 *
 * 두 곳에서 정보를 가져와 합친다.
 *   구조(누가 누구와 연결되는가, 도형 종류, 라벨, 스타일) ← 파서 db
 *   기하(어디에 얼마 크기로 놓이는가)                     ← 렌더된 SVG
 *
 * SVG 는 문자열이 아니라 실제 DOM 에 붙여서 읽는다. getBBox() 를 써야
 * path 로 그려진 도형(원통, 문서 등)의 크기를 정확히 알 수 있기 때문이다.
 */
import { nanoid } from 'nanoid'
import type {
  Direction, EdgeElement, EdgeStyle, GroupElement, MarkerKind, NodeElement,
  NodeStyle, SceneDoc, SceneElement, ShapeKind, Vec,
} from '../types'
import { emptyDoc } from '../types'
import { getTheme } from '../theme'
import { measureText } from '../geometry'
import { detectType, getDiagramDb, isEditableType, parseMermaid, renderMermaid, type ParseIssue } from './engine'
import { readLayoutComment } from './emitter'

// ── mermaid vertex.type → 우리 도형 ─────────────────────────────────
const SHAPE_MAP: Record<string, ShapeKind> = {
  square: 'rect',
  rect: 'rect',
  round: 'round',
  stadium: 'stadium',
  subroutine: 'subroutine',
  cylinder: 'cylinder',
  circle: 'circle',
  doublecircle: 'doublecircle',
  odd: 'asymmetric',
  odd_right: 'asymmetric',
  diamond: 'diamond',
  hexagon: 'hexagon',
  lean_right: 'parallelogram',
  lean_left: 'parallelogramAlt',
  trapezoid: 'trapezoid',
  inv_trapezoid: 'trapezoidAlt',
  ellipse: 'ellipse',          // A(-텍스트-)
  text: 'text',
  group: 'rect',
  // mermaid v11+ 신규 shape 이름 (A@{ shape: ... })
  'rounded': 'round',
  'stadium-shape': 'stadium',
  'sm-circ': 'circle',
  'framed-circle': 'doublecircle',
  'lin-cyl': 'cylinder',
  'cyl': 'cylinder',
  'diam': 'diamond',
  'hex': 'hexagon',
  'lean-r': 'parallelogram',
  'lean-l': 'parallelogramAlt',
  'trap-b': 'trapezoid',
  'trap-t': 'trapezoidAlt',
  'doc': 'document',
  'notch-rect': 'rect',
  'tri': 'triangle',
  'flip-tri': 'triangleDown',
  'cloud': 'cloud',
  'brace': 'note',
  'win-pane': 'note',
  'curv-trap': 'display',
  'das': 'rect',
  // v12 @{shape:...} 별칭 — 자주 쓰이는 것들
  proc: 'rect',
  process: 'rect',
  rectangle: 'rect',
  squareRect: 'rect',
  event: 'round',
  roundedRect: 'round',
  terminal: 'stadium',
  pill: 'stadium',
  db: 'cylinder',
  database: 'cylinder',
  datastore: 'cylinder',
  disk: 'cylinder',
  decision: 'diamond',
  question: 'diamond',
  prepare: 'hexagon',
  'in-out': 'parallelogram',
  'out-in': 'parallelogramAlt',
  'lean-right': 'parallelogram',
  'lean-left': 'parallelogramAlt',
  'inv-trapezoid': 'trapezoidAlt',
  'priority': 'trapezoidAlt',
  'manual': 'trapezoidAlt',
  'trapezoid-bottom': 'trapezoid',
  'trapezoid-top': 'trapezoidAlt',
  'dbl-circ': 'doublecircle',
  'fr-circ': 'doublecircle',
  'circ': 'circle',
  'small-circle': 'circle',
  'start': 'circle',
  'stop': 'doublecircle',
  'document': 'document',
  'docs': 'document',
  'lined-document': 'document',
  'paper-tape': 'document',
  'comment': 'note',
  'card': 'note',
  'notched-rectangle': 'rect',
  'triangle': 'triangle',
  'extract': 'triangle',
  'flipped-triangle': 'triangleDown',
  'manual-file': 'triangleDown',
  'bolt': 'arrowShape',
  'com-link': 'arrowShape',
  'display': 'display',
  'curved-trapezoid': 'display',
  'flag': 'asymmetric',
  'junction': 'circle',
  'summary': 'cross',
  'crossed-circle': 'cross',
  'hourglass': 'diamond',
  'collate': 'diamond',
  'braces': 'note',
  'brace-r': 'note',
  'brace-l': 'note',
}

function mapShape(type: string | undefined): ShapeKind {
  if (!type) return 'rect'
  return SHAPE_MAP[type] ?? 'rect'
}

// ── mermaid edge.type → 마커 ────────────────────────────────────────
function mapMarkers(type: string | undefined): { start: MarkerKind; end: MarkerKind } {
  switch (type) {
    case 'arrow_point': return { start: 'none', end: 'arrow' }
    case 'arrow_circle': return { start: 'none', end: 'circle' }
    case 'arrow_cross': return { start: 'none', end: 'cross' }
    case 'arrow_open': return { start: 'none', end: 'none' }
    case 'double_arrow_point': return { start: 'arrow', end: 'arrow' }
    case 'double_arrow_circle': return { start: 'circle', end: 'circle' }
    case 'double_arrow_cross': return { start: 'cross', end: 'cross' }
    default: return { start: 'none', end: 'arrow' }
  }
}

function mapStroke(stroke: string | undefined): { strokeStyle: 'solid' | 'dashed' | 'dotted'; widthScale: number; invisible: boolean } {
  switch (stroke) {
    case 'thick': return { strokeStyle: 'solid', widthScale: 2.2, invisible: false }
    case 'dotted': return { strokeStyle: 'dashed', widthScale: 1, invisible: false }
    case 'invisible': return { strokeStyle: 'solid', widthScale: 1, invisible: true }
    default: return { strokeStyle: 'solid', widthScale: 1, invisible: false }
  }
}

// ── mermaid style 문자열 → 우리 스타일 ──────────────────────────────
const CSS_TO_NODE: Record<string, (v: string, s: Partial<NodeStyle>) => void> = {
  fill: (v, s) => { s.fill = v },
  stroke: (v, s) => { s.stroke = v },
  'stroke-width': (v, s) => { s.strokeWidth = parseFloat(v) || 1.5 },
  color: (v, s) => { s.color = v },
  'font-size': (v, s) => { s.fontSize = parseFloat(v) || 14 },
  'font-weight': (v, s) => { s.fontWeight = (parseInt(v, 10) || (v === 'bold' ? 700 : 500)) as NodeStyle['fontWeight'] },
  'font-style': (v, s) => { s.italic = v === 'italic' },
  opacity: (v, s) => { s.opacity = parseFloat(v) },
  'stroke-dasharray': (v, s) => {
    const n = parseFloat(v)
    s.strokeStyle = !v || v === 'none' || n === 0 ? 'solid' : n <= 2 ? 'dotted' : 'dashed'
  },
  rx: (v, s) => { s.radius = parseFloat(v) || 0 },
}

export function parseStyleDecls(decls: string[] | undefined): Partial<NodeStyle> {
  const out: Partial<NodeStyle> = {}
  for (const decl of decls || []) {
    for (const part of String(decl).split(/[;,](?![^(]*\))/)) {
      const idx = part.indexOf(':')
      if (idx < 0) continue
      const key = part.slice(0, idx).trim().toLowerCase()
      const val = part.slice(idx + 1).trim()
      CSS_TO_NODE[key]?.(val, out)
    }
  }
  return out
}

// ── 텍스트 정리 ─────────────────────────────────────────────────────
/**
 * db 가 돌려주는 라벨은 원문이 아니다.
 * mermaid 는 파싱 전에 엔티티를 내부 플레이스홀더로 바꿔 두고(encodeEntities),
 * 렌더 직전에야 되돌린다. 우리는 렌더 결과가 아니라 db 를 읽으므로 직접 되돌려야 한다.
 * 이 단계를 빼면 화면에 'ﬂ°quot¶ß' 같은 글자가 그대로 나온다.
 */
const PLACEHOLDER_HASH = String.fromCharCode(0xfb02, 0xb0, 0xb0) // ﬂ°°  -> &#
const PLACEHOLDER_AMP = String.fromCharCode(0xfb02, 0xb0)       // ﬂ°   -> &
const PLACEHOLDER_SEMI = String.fromCharCode(0xb6, 0xdf)        // ¶ß   -> ;

let entityDecoder: HTMLTextAreaElement | null = null

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  try {
    if (!entityDecoder) entityDecoder = document.createElement('textarea')
    // textarea 의 내용은 RCDATA 라 엔티티만 해석되고 태그는 글자로 남는다 — 우리가 원하는 동작이다.
    entityDecoder.innerHTML = s
    return entityDecoder.value
  } catch {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#35;/g, '#')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
  }
}

export function cleanLabel(raw: string | undefined): string {
  if (!raw) return ''
  let s = String(raw)
  // 1) mermaid 내부 플레이스홀더 복원 (순서 중요: 긴 것부터)
  s = s.split(PLACEHOLDER_HASH).join('&#')
  s = s.split(PLACEHOLDER_AMP).join('&')
  s = s.split(PLACEHOLDER_SEMI).join(';')
  // 2) 줄바꿈
  s = s.replace(/<br\s*\/?>/gi, '\n')
  // 3) 남은 태그 제거 (엔티티 복원 전에 해야 <b> 같은 실제 태그만 지워진다)
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '')
  // 4) HTML 엔티티를 먼저 푼다.
  //    순서가 중요하다. 아래 5)의 '#35; → #' 치환을 먼저 돌리면 '&#35;' 안쪽을 먹어
  //    '&#' 만 남는다(실측으로 잡은 결함).
  s = decodeEntities(s)
  // 5) 사람이 직접 쓴 mermaid 고유 표기(& 없는 #quot; 형태)를 마지막 폴백으로 푼다.
  s = s.replace(/#quot;/g, '"').replace(/#35;/g, '#').replace(/#59;/g, ';')
       .replace(/#lt;/g, '<').replace(/#gt;/g, '>').replace(/#amp;/g, '&')
  return s.trim()
}

// ── 렌더된 SVG 에서 기하 회수 ───────────────────────────────────────
interface NodeGeom { x: number; y: number; w: number; h: number }

function readTranslate(el: Element): Vec {
  const t = el.getAttribute('transform') || ''
  const m = t.match(/translate\(\s*([-\d.eE]+)[ ,]+([-\d.eE]+)/)
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) }
  try {
    const mat = (el as SVGGraphicsElement).transform?.baseVal?.consolidate()?.matrix
    if (mat) return { x: mat.e, y: mat.f }
  } catch { /* 무시 */ }
  return { x: 0, y: 0 }
}

/** 노드 g 안에서 "도형" 요소를 찾아 크기를 잰다. 라벨은 제외한다. */
function measureShape(g: SVGGElement): { w: number; h: number } {
  const candidates = g.querySelectorAll<SVGGraphicsElement>(
    'rect.label-container, polygon.label-container, circle.label-container, ellipse.label-container, path.label-container, .basic, rect:not(.label rect), polygon, circle, ellipse, path',
  )
  let best: { w: number; h: number } | null = null
  for (const el of Array.from(candidates)) {
    // 라벨 내부의 배경 rect 는 건너뛴다
    if (el.closest('.label') && !el.classList.contains('label-container')) continue
    let w = 0
    let h = 0
    if (el.tagName === 'rect') {
      w = parseFloat(el.getAttribute('width') || '0')
      h = parseFloat(el.getAttribute('height') || '0')
    } else if (el.tagName === 'circle') {
      const r = parseFloat(el.getAttribute('r') || '0')
      w = h = r * 2
    } else if (el.tagName === 'ellipse') {
      w = parseFloat(el.getAttribute('rx') || '0') * 2
      h = parseFloat(el.getAttribute('ry') || '0') * 2
    } else {
      try {
        const bb = el.getBBox()
        w = bb.width
        h = bb.height
      } catch { /* 분리된 DOM 이면 실패 */ }
    }
    if (w > 0 && h > 0 && (!best || w * h > best.w * best.h)) best = { w, h }
  }
  if (best) return best
  try {
    const bb = g.getBBox()
    return { w: bb.width, h: bb.height }
  } catch {
    return { w: 140, h: 48 }
  }
}

/**
 * 엣지 폴리라인 회수.
 *
 * data-points 는 dagre 가 계산한 좌표를 base64 로 박아 둔 것이라 보통 정확하지만,
 * subgraph(cluster) 경계를 넘는 엣지는 그 스냅샷을 찍은 **뒤에** cutPathAtIntersect 로
 * 다시 잘리므로 실제 그려진 d 와 어긋난다. 그런 엣지는 path 를 직접 샘플링해야 한다.
 */
function decodePoints(path: Element, preferPath = false): Vec[] | null {
  const raw = preferPath ? null : path.getAttribute('data-points')
  if (raw) {
    try {
      const json = JSON.parse(atob(raw))
      if (Array.isArray(json) && json.length >= 2) {
        return json.map((p: any) => ({ x: Number(p.x), y: Number(p.y) }))
      }
    } catch { /* 아래 폴백 */ }
  }
  // 폴백(또는 경계를 넘는 엣지): path 를 균등 샘플링
  try {
    const p = path as SVGPathElement
    const len = p.getTotalLength?.()
    if (len && len > 0) {
      const n = Math.max(2, Math.min(28, Math.round(len / 22)))
      const out: Vec[] = []
      for (let i = 0; i <= n; i++) {
        const pt = p.getPointAtLength((len * i) / n)
        out.push({ x: pt.x, y: pt.y })
      }
      return out
    }
  } catch { /* 무시 */ }
  return null
}

/** SVG 를 화면 밖 컨테이너에 붙여 실제 DOM API 로 잴 수 있게 한다. */
function mountOffscreen(svgText: string): { svg: SVGSVGElement; dispose: () => void } {
  const host = document.createElement('div')
  host.setAttribute('data-diagrammer-measure', '')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:4000px;height:4000px;opacity:0;pointer-events:none;overflow:hidden;'
  host.innerHTML = svgText
  document.body.appendChild(host)
  const svg = host.querySelector('svg') as SVGSVGElement
  return { svg, dispose: () => host.remove() }
}

/**
 * mermaid 가 정한 크기를 우리 글자에 맞게 다듬는다.
 *
 * mermaid 는 원·마름모·육각형의 크기를 라벨 상자를 **외접**시켜 정하고 최소 라벨 폭도 넉넉히 잡는다.
 * 그래서 두 글자짜리 원이 지름 186px 로 나오는 일이 생긴다.
 * 우리는 라벨을 직접 그리므로 실제 글자 크기를 알고 있다 — 너무 부푼 경우만 줄인다.
 * (약간 큰 것은 그대로 둔다. mermaid 와 비슷해 보이는 편이 코드를 붙여넣은 사람의 기대에 맞는다)
 */
const INFLATED_SHAPES: Partial<Record<ShapeKind, { padX: number; padY: number; ratio: number }>> = {
  circle: { padX: 34, padY: 34, ratio: 1.25 },
  doublecircle: { padX: 42, padY: 42, ratio: 1.25 },
  diamond: { padX: 56, padY: 34, ratio: 1.3 },
  hexagon: { padX: 46, padY: 18, ratio: 1.35 },
  ellipse: { padX: 34, padY: 20, ratio: 1.3 },
}

function rightSize(shape: ShapeKind, text: string, w: number, h: number, fontSize: number, fontWeight: number): { w: number; h: number } {
  const rule = INFLATED_SHAPES[shape]
  if (!rule) return { w, h }
  const m = measureText(text || ' ', fontSize, fontWeight)
  let needW = m.w + rule.padX
  let needH = m.h + rule.padY
  if (shape === 'circle' || shape === 'doublecircle') {
    // 원은 글자 상자를 외접해야 하므로 대각선 기준
    const d = Math.max(56, Math.hypot(m.w, m.h) + rule.padX)
    needW = d
    needH = d
  }
  const limitW = needW * rule.ratio
  const limitH = needH * rule.ratio
  return {
    w: w > limitW ? Math.round(Math.max(needW, limitW)) : w,
    h: h > limitH ? Math.round(Math.max(needH, limitH)) : h,
  }
}

// ── 본체 ────────────────────────────────────────────────────────────
export interface ImportOptions {
  themeId?: string
  /** 이전 문서 — mid 가 같은 요소의 사용자 편집(위치·스타일)을 이어받는다 */
  prev?: SceneDoc
  title?: string
  /** 이전 위치를 유지할지 (false 면 레이아웃을 그대로 따른다 = 자동 정렬) */
  preservePositions?: boolean
}

export type ImportResult =
  | { ok: true; doc: SceneDoc; warnings: string[] }
  | { ok: false; issue: ParseIssue }

export async function importMermaid(code: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const trimmed = code.trim()
  if (!trimmed) {
    return {
      ok: true,
      doc: emptyDoc({ code: '', title: opts.title ?? '무제 다이어그램', themeId: opts.themeId, elements: {}, order: [] }),
      warnings: [],
    }
  }

  const parsed = await parseMermaid(trimmed)
  if (!parsed.ok) return { ok: false, issue: parsed.issue }

  const theme = getTheme(opts.themeId ?? opts.prev?.themeId)
  // 렌더 전에 종류를 먼저 판정한다. 뷰어 전용 종류는 SVG 자체가 결과물이라 테마를 맞춰 그려야 한다.
  const guessed = parsed.diagramType || detectType(trimmed)
  const viewerOnly = !isEditableType(guessed)

  let rendered
  try {
    rendered = await renderMermaid(trimmed, viewerOnly && theme.dark ? 'dark' : 'default')
  } catch (e) {
    return { ok: false, issue: { message: e instanceof Error ? e.message : String(e) } }
  }

  const diagramType = rendered.diagramType || parsed.diagramType
  const warnings: string[] = []

  // 자유 편집이 불가능한 종류 — mermaid SVG 를 그대로 보여준다
  if (!isEditableType(diagramType)) {
    const vb = rendered.svg.match(/viewBox="([-\d.eE]+)[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)"/)
    const nativeSize = vb
      ? { w: Math.max(1, parseFloat(vb[3])), h: Math.max(1, parseFloat(vb[4])) }
      : { w: 800, h: 600 }
    return {
      ok: true,
      doc: emptyDoc({
        ...(opts.prev ?? {}),
        id: opts.prev?.id ?? nanoid(10),
        title: opts.title ?? opts.prev?.title ?? '무제 다이어그램',
        code: trimmed,
        diagramType,
        editable: false,
        nativeSvg: rendered.svg,
        nativeSize,
        elements: {},
        order: [],
        themeId: theme.id,
        modified: Date.now(),
      }),
      warnings: ['이 종류는 코드로만 편집할 수 있습니다. 도형을 직접 옮기려면 flowchart 로 만드세요.'],
    }
  }

  const info = await getDiagramDb(trimmed)
  const db = info?.db
  if (!db) return { ok: false, issue: { message: '다이어그램 구조를 읽지 못했습니다.' } }

  const { svg, dispose } = mountOffscreen(rendered.svg)
  try {
    const doc = buildScene({ code: trimmed, diagramType, db, svg, theme: theme.id, opts, warnings })
    applyLayoutComment(doc, trimmed)
    return { ok: true, doc, warnings }
  } finally {
    dispose()
  }
}

/**
 * 코드 끝에 숨겨진 `%% dgr:layout:v1 {...}` 주석의 좌표를 되살린다.
 * 이전 문서(prev)로 위치를 이어받지 못하는 경우 —
 * 예를 들어 사용자가 다른 곳에서 코드만 복사해 붙여넣은 경우 — 에 배치가 살아난다.
 */
function applyLayoutComment(doc: SceneDoc, code: string): void {
  const layout = readLayoutComment(code)
  if (!layout) return
  let applied = 0
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'node' || !el.mid) continue
    const v = layout[el.mid]
    if (!Array.isArray(v) || v.length < 2) continue
    const [x, y, w, h] = v
    if (typeof x !== 'number' || typeof y !== 'number') continue
    el.x = x
    el.y = y
    if (typeof w === 'number' && w > 0) el.w = w
    if (typeof h === 'number' && h > 0) el.h = h
    el.pinned = true
    applied++
  }
  // 고정된 노드에 붙은 엣지만 레이아웃 경유점을 버린다.
  // 전부 버리면 손대지 않은 나머지 연결선까지 곡선을 잃고 꺾은선이 된다.
  if (applied > 0) {
    const pinned = new Set(
      Object.values(doc.elements).filter(el => el.kind === 'node' && el.pinned).map(el => el.id),
    )
    for (const el of Object.values(doc.elements)) {
      if (el.kind !== 'edge' || !el.autoWaypoints) continue
      if (!pinned.has(el.source) && !pinned.has(el.target)) continue
      el.waypoints = undefined
      el.autoWaypoints = false
      el.routing = 'orthogonal'
    }
  }
}

function toEntries(v: any): [string, any][] {
  if (!v) return []
  if (v instanceof Map) return Array.from(v.entries())
  if (Array.isArray(v)) return v.map((x: any) => [x?.id ?? String(x), x])
  return Object.entries(v)
}

interface BuildArgs {
  code: string
  diagramType: string
  db: any
  svg: SVGSVGElement
  theme: string
  opts: ImportOptions
  warnings: string[]
}

function buildScene({ code, diagramType, db, svg, theme: themeId, opts, warnings }: BuildArgs): SceneDoc {
  const theme = getTheme(themeId)
  const prev = opts.prev
  const preserve = opts.preservePositions !== false

  // 이전 문서를 mid 로 색인 — 사용자 편집을 이어받기 위해
  const prevByMid = new Map<string, SceneElement>()
  for (const el of Object.values(prev?.elements ?? {})) {
    if (el.mid) prevByMid.set(el.mid, el)
  }

  const elements: Record<string, SceneElement> = {}
  const order: string[] = []
  const idByMid = new Map<string, string>()

  // classDef 정의
  const classDefs = new Map<string, Partial<NodeStyle>>()
  for (const [name, def] of toEntries(db.getClasses?.())) {
    const styles: string[] = [...(def?.styles ?? []), ...(def?.textStyles ?? [])]
    classDefs.set(name, parseStyleDecls(styles))
  }

  // ── 노드 ──
  const vertices = toEntries(db.getVertices?.())
  for (const [vid, v] of vertices) {
    const domId: string = v?.domId || `flowchart-${vid}`
    const g = findNodeG(svg, domId, vid)
    const geom: NodeGeom = g
      ? { ...readTranslate(g), ...measureShape(g) }
      : { x: 0, y: 0, w: 148, h: 56 }

    let fromClasses: Partial<NodeStyle> = {}
    for (const c of (v?.classes ?? []) as string[]) {
      fromClasses = { ...fromClasses, ...(classDefs.get(c) ?? {}) }
    }
    const fromStyle = parseStyleDecls(v?.styles)
    const prevEl = prevByMid.get(vid)
    const prevNode = prevEl && prevEl.kind === 'node' ? prevEl : undefined

    const id = prevNode?.id ?? nanoid(10)
    idByMid.set(vid, id)

    const shape = mapShape(v?.type)
    const text = cleanLabel(v?.text ?? vid)
    const codeStyle = { ...fromClasses, ...fromStyle }
    const style = { ...theme.node, ...codeStyle, ...(prevNode?.over ?? {}) }
    const sized = rightSize(shape, text, Math.max(40, geom.w), Math.max(28, geom.h), style.fontSize, style.fontWeight)

    const node: NodeElement = {
      id,
      mid: vid,
      kind: 'node',
      shape: prevNode?.over && prevNode.shape !== mapShape(v?.type) && prevNode.pinned ? prevNode.shape : shape,
      x: preserve && prevNode?.pinned ? prevNode.x : geom.x,
      y: preserve && prevNode?.pinned ? prevNode.y : geom.y,
      w: preserve && prevNode?.pinned ? prevNode.w : sized.w,
      h: preserve && prevNode?.pinned ? prevNode.h : sized.h,
      text,
      style,
      over: prevNode?.over,
      codeStyle: Object.keys(codeStyle).length ? codeStyle : undefined,
      pinned: preserve ? prevNode?.pinned : false,
      classes: v?.classes?.length ? [...v.classes] : undefined,
      link: v?.link || undefined,
      tooltip: v?.tooltip || undefined,
    }
    elements[id] = node
    order.push(id)
  }

  // ── 그룹(subgraph) ──
  // mermaid 는 중첩을 '부모의 nodes 배열에 자식 subgraph id 문자열이 들어간다' 로만 표현한다.
  // 그래서 먼저 모든 그룹을 만들어 id 를 확보한 뒤, 두 번째 패스에서 부모 관계를 잇는다.
  const subgraphs: any[] = db.getSubGraphs?.() ?? []
  const groupIdBySg = new Map<string, string>()
  for (const sg of subgraphs) {
    const sgId: string = sg?.id
    if (!sgId) continue
    const cluster = findClusterG(svg, sgId)
    const prevEl = prevByMid.get('sg:' + sgId)
    const prevGroup = prevEl && prevEl.kind === 'group' ? prevEl : undefined
    const id = prevGroup?.id ?? nanoid(10)
    let geom: NodeGeom = { x: 0, y: 0, w: 200, h: 140 }
    if (cluster) {
      const t = readTranslate(cluster)
      const size = measureShape(cluster as SVGGElement)
      // cluster 의 rect 는 보통 translate 없이 x/y 로 놓인다 — bbox 로 보정
      try {
        const bb = (cluster as SVGGElement).getBBox()
        geom = { x: t.x + bb.x + bb.width / 2, y: t.y + bb.y + bb.height / 2, w: bb.width, h: bb.height }
      } catch {
        geom = { x: t.x, y: t.y, w: size.w, h: size.h }
      }
    } else {
      // SVG 에서 못 찾으면 자식 노드들의 경계로 만든다
      const childIds: string[] = (sg?.nodes ?? []).map((n: string) => idByMid.get(n)).filter(Boolean) as string[]
      const boxes = childIds.map(cid => elements[cid]).filter(e => e && 'x' in e) as NodeElement[]
      if (boxes.length) {
        const minX = Math.min(...boxes.map(b => b.x - b.w / 2)) - 24
        const maxX = Math.max(...boxes.map(b => b.x + b.w / 2)) + 24
        const minY = Math.min(...boxes.map(b => b.y - b.h / 2)) - 40
        const maxY = Math.max(...boxes.map(b => b.y + b.h / 2)) + 24
        geom = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
      }
    }

    const group: GroupElement = {
      id,
      mid: 'sg:' + sgId,
      kind: 'group',
      x: preserve && prevGroup?.pinned ? prevGroup.x : geom.x,
      y: preserve && prevGroup?.pinned ? prevGroup.y : geom.y,
      w: preserve && prevGroup?.pinned ? prevGroup.w : geom.w,
      h: preserve && prevGroup?.pinned ? prevGroup.h : geom.h,
      title: cleanLabel(sg?.title ?? sgId),
      style: { ...theme.group, ...(prevGroup?.codeStyle ?? {}), ...(prevGroup?.over ?? {}) },
      over: prevGroup?.over,
      codeStyle: prevGroup?.codeStyle,
      pinned: preserve ? prevGroup?.pinned : false,
    }
    elements[id] = group
    groupIdBySg.set(sgId, id)
    // 그룹은 노드 뒤에 그려야 하므로 order 맨 앞에 넣는다
    order.unshift(id)
  }

  // 두 번째 패스: 소속 연결 (노드 + 중첩 subgraph)
  for (const sg of subgraphs) {
    const gid = groupIdBySg.get(sg?.id)
    if (!gid) continue
    for (const childMid of (sg?.nodes ?? []) as string[]) {
      const childGroupId = groupIdBySg.get(childMid)
      if (childGroupId && childGroupId !== gid) {
        elements[childGroupId] = { ...elements[childGroupId], parent: gid }
        continue
      }
      const cid = idByMid.get(childMid)
      if (cid && elements[cid]) elements[cid] = { ...elements[cid], parent: gid }
    }
  }

  // ── 엣지 ──
  const edges = db.getEdges?.() ?? []
  // `linkStyle default ...` 는 배열 객체의 속성으로 붙는다. 없으면 무시하면 된다.
  const defaultLinkStyle = parseStyleDecls(
    Array.isArray((edges as any).defaultStyle) ? (edges as any).defaultStyle : undefined,
  )
  edges.forEach((e: any, index: number) => {
    const srcId = idByMid.get(e.start)
    const tgtId = idByMid.get(e.end)
    if (!srcId || !tgtId) {
      warnings.push(`연결 ${e.start} → ${e.end} 의 노드를 찾지 못해 건너뛰었습니다.`)
      return
    }
    const mid: string = e.id || `L_${e.start}_${e.end}_${index}`
    const prevEl = prevByMid.get(mid)
    const prevEdge = prevEl && prevEl.kind === 'edge' ? prevEl : undefined
    const id = prevEdge?.id ?? nanoid(10)

    const path = findEdgePath(svg, mid)
    const srcParent = elements[srcId]?.parent
    const tgtParent = elements[tgtId]?.parent
    const crossesCluster = srcParent !== tgtParent
    const pts = path ? decodePoints(path, crossesCluster) : null
    const markers = mapMarkers(e.type)
    const strokeInfo = mapStroke(e.stroke)
    const linkStyle = parseStyleDecls(e.style ? [String(e.style)] : undefined)

    const edgeCodeStyle: Partial<EdgeStyle> = {
      strokeWidth: theme.edge.strokeWidth * strokeInfo.widthScale,
      ...(defaultLinkStyle.stroke ? { stroke: defaultLinkStyle.stroke } : {}),
      ...(defaultLinkStyle.strokeWidth ? { strokeWidth: defaultLinkStyle.strokeWidth } : {}),
      ...(defaultLinkStyle.strokeStyle ? { strokeStyle: defaultLinkStyle.strokeStyle } : {}),
      ...(e.stroke === 'dotted' ? { strokeStyle: 'dashed' as const } : {}),
      ...(strokeInfo.invisible ? { opacity: 0 } : {}),
      ...(linkStyle.stroke ? { stroke: linkStyle.stroke } : {}),
      ...(linkStyle.strokeWidth ? { strokeWidth: linkStyle.strokeWidth } : {}),
      ...(linkStyle.strokeStyle ? { strokeStyle: linkStyle.strokeStyle } : {}),
      ...(linkStyle.color ? { color: linkStyle.color } : {}),
    }
    const style: EdgeStyle = { ...theme.edge, ...edgeCodeStyle, ...(prevEdge?.over ?? {}) }

    // 사용자가 직접 찍은 경유점이면 지키고, 아니면 mermaid 배치를 초기값으로 쓴다
    const userWaypoints = prevEdge && prevEdge.waypoints && !prevEdge.autoWaypoints
    const interior = pts && pts.length > 2 ? pts.slice(1, -1) : []

    const edge: EdgeElement = {
      id,
      mid,
      kind: 'edge',
      source: srcId,
      target: tgtId,
      sourceAnchor: prevEdge?.sourceAnchor ?? 'auto',
      targetAnchor: prevEdge?.targetAnchor ?? 'auto',
      label: cleanLabel(e.text),
      // 사용자가 라우팅을 직접 고른 선(= 레이아웃 유래 경유점이 아닌 선)은 그 선택을 지킨다.
      routing: userWaypoints
        ? 'custom'
        : prevEdge && prevEdge.routing !== 'custom' && !prevEdge.autoWaypoints
          ? prevEdge.routing
          : interior.length
            ? 'custom'
            : 'straight',
      waypoints: userWaypoints
        ? prevEdge!.waypoints
        : prevEdge && prevEdge.routing !== 'custom' && !prevEdge.autoWaypoints
          ? undefined
          : interior.length
            ? interior
            : undefined,
      autoWaypoints: userWaypoints
        ? false
        : prevEdge && prevEdge.routing !== 'custom' && !prevEdge.autoWaypoints
          ? false
          : interior.length > 0,
      style,
      over: prevEdge?.over,
      codeStyle: edgeCodeStyle,
      startMarker: prevEdge?.over ? prevEdge.startMarker : markers.start,
      endMarker: prevEdge?.over ? prevEdge.endMarker : markers.end,
      labelPos: prevEdge?.labelPos,
      labelOffset: prevEdge?.labelOffset,
    }
    elements[id] = edge
    order.push(id)
  })

  // ── 자유 편집으로 추가된 요소(코드에 대응이 없는 것)는 그대로 살린다 ──
  if (prev) {
    for (const el of Object.values(prev.elements)) {
      if (el.mid) continue
      if (elements[el.id]) continue
      // 연결이 끊긴 엣지는 버린다
      if (el.kind === 'edge' && (!elements[el.source] || !elements[el.target])) continue
      elements[el.id] = el
      order.push(el.id)
    }
  }

  const direction = (db.getDirection?.() || 'TB') as Direction

  /**
   * 렌더러는 order 를 그대로 따른다(= '맨 앞으로' 명령이 실제로 먹는다).
   * 그래서 기본 겹침 순서를 여기서 정한다: 그룹(맨 뒤) → 엣지 → 나머지(노드·텍스트).
   * 엣지를 노드 아래에 두어야 화살촉이 도형에 파묻히지 않는다.
   */
  const rank = (id: string) => {
    const k = elements[id]?.kind
    return k === 'group' ? 0 : k === 'edge' ? 1 : 2
  }
  const sortedOrder = [...new Set(order)].filter(id => elements[id])
  sortedOrder.sort((a, b) => rank(a) - rank(b))

  return {
    ...emptyDoc(),
    ...(prev ?? {}),
    id: prev?.id ?? nanoid(10),
    version: 2,
    title: opts.title ?? prev?.title ?? '무제 다이어그램',
    code,
    diagramType,
    direction: ['TB', 'BT', 'LR', 'RL'].includes(direction) ? direction : 'TB',
    editable: true,
    nativeSvg: undefined,
    nativeSize: undefined,
    elements,
    order: sortedOrder,
    themeId,
    sourceOfTruth: prev?.sourceOfTruth ?? 'code',
    freeEdits: prev?.freeEdits ?? false,
    modified: Date.now(),
  }
}

// ── SVG 조회 헬퍼 ───────────────────────────────────────────────────
function findNodeG(svg: SVGSVGElement, domId: string, vid: string): SVGGElement | null {
  if (!svg) return null
  const all = svg.querySelectorAll<SVGGElement>('g.node')
  for (const g of Array.from(all)) {
    const id = g.getAttribute('id') || ''
    if (id === domId || id.endsWith('-' + domId)) return g
  }
  // domId 를 못 맞추면 id 안에 vertex id 가 들어있는 것을 찾는다
  for (const g of Array.from(all)) {
    const id = g.getAttribute('id') || ''
    if (new RegExp(`(^|-)flowchart-${escapeRe(vid)}-\\d+$`).test(id)) return g
  }
  return null
}

function findClusterG(svg: SVGSVGElement, sgId: string): Element | null {
  if (!svg) return null
  const all = svg.querySelectorAll('g.cluster, g.subgraph')
  for (const g of Array.from(all)) {
    const id = g.getAttribute('id') || ''
    if (id === sgId || id.endsWith('-' + sgId) || id.includes(sgId)) return g
  }
  return null
}

function findEdgePath(svg: SVGSVGElement, edgeId: string): Element | null {
  if (!svg) return null
  const byData = svg.querySelector(`path[data-id="${cssEscape(edgeId)}"]`)
  if (byData) return byData
  const all = svg.querySelectorAll('path.flowchart-link, g.edgePaths path')
  for (const p of Array.from(all)) {
    const id = p.getAttribute('id') || ''
    if (id === edgeId || id.endsWith('-' + edgeId)) return p
  }
  return null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}
