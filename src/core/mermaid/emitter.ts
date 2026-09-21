/**
 * Scene → mermaid 코드 역생성.
 *
 * 한계를 숨기지 않는다. mermaid 가 표현하지 못하는 편집(자유 위치, 임의 도형, 이미지, 손그림)은
 * warnings 로 돌려주고, 앱은 그것을 사용자에게 그대로 보여준다.
 * 위치는 선택적으로 %% 주석에 실어 왕복시킨다(파서는 주석을 무시하므로 안전하다).
 */
import type { EdgeElement, GroupElement, MarkerKind, NodeElement, SceneDoc, ShapeKind } from '../types'
import { getTheme } from '../theme'

const SHAPE_WRAP: Partial<Record<ShapeKind, [string, string]>> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  doublecircle: ['(((', ')))'],
  asymmetric: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
  parallelogramAlt: ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  trapezoidAlt: ['[\\', '/]'],
  text: ['[', ']'],
}
/**
 * 타원은 일부러 뺐다.
 * mermaid 문법에는 A(-텍스트-) 가 남아 있지만, 12.0.0 런타임은 도형 목록에 'ellipse' 가 없어
 * "No such shape: ellipse" 로 **파싱을 거부한다**(실측). 내보내면 열리지 않는 코드가 된다.
 * 캔버스에서는 타원을 그대로 쓰고, 코드로 나갈 때만 원으로 근사한다.
 */

/** mermaid 로 직접 표현 못하는 도형 → 가장 가까운 표현 */
const SHAPE_FALLBACK: Partial<Record<ShapeKind, ShapeKind>> = {
  triangle: 'diamond',
  triangleDown: 'diamond',
  star: 'circle',
  cloud: 'round',
  note: 'rect',
  document: 'rect',
  pentagon: 'hexagon',
  arrowShape: 'rect',
  cross: 'rect',
  person: 'stadium',
  database: 'cylinder',
  display: 'trapezoid',
  ellipse: 'circle',
}

/**
 * 라벨 이스케이프.
 *
 * 다섯 글자를 반드시 바꿔야 한다. 하나라도 빠뜨리면 **에러 없이 글자가 사라진다.**
 *  "  → #quot;  (따옴표가 그대로면 라벨이 조용히 잘린다)
 *  <  → #lt;    ('<' 뒤에 영문자가 오면 DOMPurify 가 미완성 태그로 보고 뒤를 통째로 지운다)
 *  >  → #gt;
 *  &  → #amp;   (사용자가 친 &amp; 가 이중 해석되는 것을 막는다)
 *  #  → #35;    (# 이스케이프 자신을 보호)
 * 줄바꿈은 <br/> 로 바꾼다.
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '#amp;',
  '<': '#lt;',
  '>': '#gt;',
  '"': '#quot;',
  '#': '#35;',
}

export function escapeLabel(text: string): string {
  const s = String(text ?? '')
    .normalize('NFC')
    .replace(/[&<>"#]/g, c => ESCAPE_MAP[c])
    .replace(/\r\n?|\n/g, '<br/>')
  return `"${s}"`
}

/**
 * mermaid 예약어. 노드 id 로 쓰면 파스 에러가 나거나 엉뚱하게 해석된다.
 * 특히 'end' 는 subgraph 를 조기 종료시켜 다이어그램 전체를 망가뜨린다.
 */
const RESERVED = new Set([
  'graph', 'flowchart', 'subgraph', 'end', 'style', 'linkstyle', 'classdef', 'class',
  'click', 'direction', 'default', 'interpolate', 'call', 'href', 'callback',
])

/**
 * 소문자 o / x 만 따로 막는다. 이 둘은 `A o--o B`, `A x--x B` 의 화살촉 표기와 겹쳐
 * 문장 앞에 오면 파서가 링크 조각으로 읽는다. 대문자 O·X 는 문제없다.
 * (여기서 대소문자를 무시하면 사용자가 쓴 멀쩡한 id 'X' 가 조용히 개명된다)
 */
const RESERVED_EXACT = new Set(['o', 'x'])

/**
 * 한글/특수문자 라벨에서 안전한 mermaid 식별자를 만든다.
 * 한글만 있는 라벨은 남는 글자가 없으므로 fallback(n1, n2 …)을 쓴다.
 */
/**
 * mermaid 노드 id 로 쓸 수 있는 글자.
 * 영문·숫자·밑줄에 더해 한글과 한자를 허용한다. mermaid 는 이들을 id 로 받아들이며,
 * 굳이 n1/n2 로 바꾸면 사용자가 쓴 `시작 --> 끝` 이 통째로 재작성되어 diff 가 못 쓰게 된다.
 * 공백과 [](){}|<>-=.;,:"'#&/\\ 처럼 문법상 의미가 있는 글자만 막는다.
 */
const ID_BODY = 'A-Za-z0-9_\\uAC00-\\uD7A3\\u3131-\\u318E\\u4E00-\\u9FFF'
const ID_START = 'A-Za-z_\\uAC00-\\uD7A3\\u3131-\\u318E\\u4E00-\\u9FFF'
const ID_RE = new RegExp(`^[${ID_START}][${ID_BODY}]*$`)
const ID_BAD_RE = new RegExp(`[^${ID_BODY}]`, 'g')

export function safeMermaidId(seed: string, taken: Set<string>, fallback = 'n'): string {
  let base = String(seed || '')
    .normalize('NFC')
    .replace(ID_BAD_RE, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  if (!base) base = fallback
  if (!new RegExp(`^[${ID_START}]`).test(base)) base = 'n_' + base
  if (RESERVED.has(base.toLowerCase()) || RESERVED_EXACT.has(base)) base = 'n_' + base
  let id = base
  let i = 2
  while (taken.has(id)) {
    id = `${base}_${i++}`
  }
  taken.add(id)
  return id
}

export function isSafeMermaidId(id: string): boolean {
  return ID_RE.test(id) && !RESERVED.has(id.toLowerCase()) && !RESERVED_EXACT.has(id)
}

const HEAD: Partial<Record<MarkerKind, string>> = { arrow: '>', cross: 'x', circle: 'o' }

/**
 * mermaid 링크 연산자를 만든다.
 *   ---  -->  --o  --x        일반
 *   ===  ==>  ==o  ==x        굵게 (stroke-width >= 3)
 *   -.-  -.->                 점선
 *   <--> <==> <-.->  o--o  x--x   양방향
 * mermaid 에는 "역방향만"(<--) 표기가 없다. 그 경우 호출측이 방향을 뒤집는다.
 */
function edgeOperator(edge: EdgeElement): { op: string; swap: boolean } {
  const thick = edge.style.strokeWidth >= 3
  const dotted = edge.style.strokeStyle !== 'solid'
  let startH = HEAD[edge.startMarker] ?? ''
  let endH = HEAD[edge.endMarker] ?? ''
  let swap = false

  // 역방향만 있는 경우 → 출발/도착을 바꿔 정방향으로 쓴다
  if (startH && !endH) {
    endH = startH
    startH = ''
    swap = true
  }

  const body = dotted ? '-.-' : thick ? '==' : '--'
  if (!startH && !endH) return { op: dotted ? '-.-' : thick ? '===' : '---', swap }
  if (!startH) return { op: body + endH, swap }
  const pre = startH === '>' ? '<' : startH
  return { op: pre + body + (endH || '>'), swap }
}

function styleDecls(style: Record<string, any>, base: Record<string, any>, isEdge: boolean): string[] {
  const out: string[] = []
  const eq = (a: unknown, b: unknown) => String(a) === String(b)
  if (!isEdge && !eq(style.fill, base.fill)) out.push(`fill:${style.fill === 'transparent' ? 'none' : style.fill}`)
  if (!eq(style.stroke, base.stroke)) out.push(`stroke:${style.stroke === 'transparent' ? 'none' : style.stroke}`)
  if (!eq(style.strokeWidth, base.strokeWidth)) out.push(`stroke-width:${style.strokeWidth}px`)
  if (!eq(style.color, base.color)) out.push(`color:${style.color}`)
  if (!eq(style.fontSize, base.fontSize)) out.push(`font-size:${style.fontSize}px`)
  if (style.strokeStyle !== base.strokeStyle && style.strokeStyle !== 'solid') {
    out.push(`stroke-dasharray:${style.strokeStyle === 'dotted' ? '2 3' : '6 4'}`)
  }
  return out
}

export interface EmitOptions {
  /** 노드 좌표를 %% 주석으로 함께 내보낸다 (다이아그래머가 다시 열 때 배치를 복원) */
  includeLayout?: boolean
  /** 스타일 지시자(style/classDef) 포함 */
  includeStyles?: boolean
}

export interface EmitResult {
  code: string
  warnings: string[]
  /** 코드로 표현하지 못해 누락된 요소 id */
  dropped: string[]
  /**
   * 이번에 배정한 Scene id → mermaid id 대응표.
   * 호출측이 이 값을 요소의 mid 에 적어 두면 다음 생성에서 같은 id 가 유지된다.
   * (적어 두지 않으면 라벨을 고칠 때마다 id 가 바뀌어 코드 diff 와 배치 주석이 계속 흔들린다)
   */
  midOf: Map<string, string>
}

export function sceneToMermaid(doc: SceneDoc, opts: EmitOptions = {}): EmitResult {
  const includeLayout = opts.includeLayout !== false
  const includeStyles = opts.includeStyles !== false
  const theme = getTheme(doc.themeId)
  const warnings: string[] = []
  const dropped: string[] = []

  const nodes: NodeElement[] = []
  const edges: EdgeElement[] = []
  const groups: GroupElement[] = []

  for (const id of doc.order) {
    const el = doc.elements[id]
    if (!el || el.hidden) continue
    if (el.kind === 'node') nodes.push(el)
    else if (el.kind === 'edge') edges.push(el)
    else if (el.kind === 'group') groups.push(el)
    else {
      dropped.push(el.id)
    }
  }

  if (dropped.length) {
    warnings.push(`자유 텍스트·이미지·손그림 ${dropped.length}개는 mermaid 코드로 옮길 수 없어 빠졌습니다. (캔버스와 파일 저장에는 그대로 남습니다)`)
  }

  // ── mermaid id 배정 ──
  // 원칙: 기존 mid 를 최대한 그대로 쓴다. id 가 매번 바뀌면 코드 diff 와 배치 주석이 계속 흔들린다.
  // 노드와 그룹은 같은 이름 공간을 쓰므로 한 번에 배정해야 서로 선점하지 않는다.
  const taken = new Set<string>()
  const midOf = new Map<string, string>()

  // 1패스 — 이미 가진 id 를 먼저 예약한다 (신규 요소가 기존 id 를 뺏지 못하게)
  for (const n of nodes) {
    if (n.mid && !taken.has(n.mid) && isSafeMermaidId(n.mid)) {
      taken.add(n.mid)
      midOf.set(n.id, n.mid)
    }
  }
  for (const g of groups) {
    const seed = g.mid?.replace(/^sg:/, '')
    if (seed && !taken.has(seed) && isSafeMermaidId(seed)) {
      taken.add(seed)
      midOf.set(g.id, seed)
    }
  }
  // 2패스 — 남은 것에 새 id 를 준다
  let anonNode = 0
  for (const n of nodes) {
    if (!midOf.has(n.id)) midOf.set(n.id, safeMermaidId(n.text ?? '', taken, `n${++anonNode}`))
  }
  let anonGroup = 0
  for (const g of groups) {
    if (!midOf.has(g.id)) midOf.set(g.id, safeMermaidId(g.title ?? '', taken, `g${++anonGroup}`))
  }

  const lines: string[] = []
  lines.push(`flowchart ${doc.direction || 'TB'}`)

  const nodeLine = (n: NodeElement): string => {
    const shape = SHAPE_WRAP[n.shape] ? n.shape : (SHAPE_FALLBACK[n.shape] ?? 'rect')
    if (shape !== n.shape) {
      warnings.push(`'${n.text || midOf.get(n.id)}' 의 도형(${n.shape})은 mermaid 에 없어 비슷한 모양으로 바꿨습니다.`)
    }
    const [open, close] = SHAPE_WRAP[shape] ?? ['[', ']']
    return `${midOf.get(n.id)}${open}${escapeLabel(n.text)}${close}`
  }

  // ── subgraph 는 중첩을 유지해 써야 한다 ──
  // 평탄하게 늘어놓으면 부모가 멤버 0 인 빈 상자가 되고, 다시 읽으면 중첩이 사라진다.
  const childNodes = new Map<string, NodeElement[]>()
  const childGroups = new Map<string, GroupElement[]>()
  const looseNodes: NodeElement[] = []
  const rootGroups: GroupElement[] = []
  const isGroup = (id: string | undefined) => !!id && doc.elements[id]?.kind === 'group'

  for (const n of nodes) {
    if (isGroup(n.parent)) {
      const arr = childNodes.get(n.parent!) ?? []
      arr.push(n)
      childNodes.set(n.parent!, arr)
    } else looseNodes.push(n)
  }
  for (const g of groups) {
    if (isGroup(g.parent) && g.parent !== g.id) {
      const arr = childGroups.get(g.parent!) ?? []
      arr.push(g)
      childGroups.set(g.parent!, arr)
    } else rootGroups.push(g)
  }

  for (const n of looseNodes) lines.push('    ' + nodeLine(n))

  const seenGroups = new Set<string>()
  const writeGroup = (g: GroupElement, depth: number) => {
    if (seenGroups.has(g.id)) return // 순환 방어
    seenGroups.add(g.id)
    const pad = '    '.repeat(depth + 1)
    lines.push(`${pad}subgraph ${midOf.get(g.id)} [${escapeLabel(g.title || '')}]`)
    for (const n of childNodes.get(g.id) ?? []) lines.push(pad + '    ' + nodeLine(n))
    for (const sub of childGroups.get(g.id) ?? []) writeGroup(sub, depth + 1)
    lines.push(`${pad}end`)
  }
  for (const g of rootGroups) writeGroup(g, 0)

  if (edges.length) lines.push('')
  // linkStyle 의 인덱스는 '실제로 출력된 링크의 순번' 이다.
  // 빠진 엣지가 있는데 배열 인덱스를 쓰면 번호가 밀려 엉뚱한 선에 스타일이 붙거나 파스 에러가 난다.
  const edgeIndex = new Map<string, number>()
  let emitted = 0
  for (const e of edges) {
    const s = midOf.get(e.source)
    const t = midOf.get(e.target)
    if (!s || !t) {
      dropped.push(e.id)
      continue
    }
    edgeIndex.set(e.id, emitted++)
    const { op, swap } = edgeOperator(e)
    const label = e.label ? `|${escapeLabel(e.label)}|` : ''
    const [from, to] = swap ? [t, s] : [s, t]
    lines.push(`    ${from} ${op}${label} ${to}`)
  }
  if (dropped.some(id => doc.elements[id]?.kind === 'edge')) {
    warnings.push('도형이 아닌 것(텍스트·이미지)에 붙은 연결선은 코드로 옮길 수 없어 빠졌습니다.')
  }

  if (includeStyles) {
    const styleLines: string[] = []
    for (const n of nodes) {
      const decls = styleDecls(n.style, theme.node, false)
      if (decls.length) styleLines.push(`    style ${midOf.get(n.id)} ${decls.join(',')}`)
    }
    /**
     * 그룹(subgraph)에는 style 지시자를 쓰지 않는다.
     * mermaid 는 subgraph id 에 style 을 걸면 같은 이름의 **노드를 새로 만들어** 버린다.
     * 그룹 색은 문서(JSON)에만 남기고 코드에는 싣지 않는다 — 유령 노드가 생기는 것보다 낫다.
     */
    const groupStyled = groups.filter(g => styleDecls(g.style, theme.group, false).length)
    if (groupStyled.length) {
      warnings.push(`그룹 ${groupStyled.length}개의 색은 mermaid 코드로 옮기지 않았습니다. (코드에 싣면 같은 이름의 빈 노드가 생깁니다 — 캔버스와 저장 파일에는 그대로 남습니다)`)
    }
    for (const e of edges) {
      const idx = edgeIndex.get(e.id)
      if (idx === undefined) continue
      const decls = styleDecls(e.style, theme.edge, true)
      if (decls.length) styleLines.push(`    linkStyle ${idx} ${decls.join(',')}`)
    }
    if (styleLines.length) {
      lines.push('')
      lines.push(...styleLines)
    }
  }

  if (includeLayout) {
    const layout: Record<string, [number, number, number, number]> = {}
    for (const n of nodes) {
      if (!n.pinned) continue
      layout[midOf.get(n.id)!] = [round(n.x), round(n.y), round(n.w), round(n.h)]
    }
    if (Object.keys(layout).length) {
      lines.push('')
      // prefix 는 반드시 '%% dgr:' — '%%{' 로 시작하면 mermaid 가 init 디렉티브로 오인해 설정이 바뀐다.
      lines.push(`${LAYOUT_PREFIX} ${JSON.stringify(layout)}`)
    }
  }

  return { code: lines.join('\n') + '\n', warnings, dropped, midOf }
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

export const LAYOUT_PREFIX = '%% dgr:layout:v1'
const LAYOUT_RE = /^%%\s*dgr:layout:v1\s*(\{.*\})\s*$/m

/**
 * 코드에 숨겨둔 배치 주석을 읽는다.
 * mermaid 는 `%%` 로 시작하는 줄을 파싱 전에 통째로 지우므로 렌더에는 아무 영향이 없고,
 * 코드를 복사해 어디로 가져가든 배치가 함께 따라간다.
 */
export function readLayoutComment(code: string): Record<string, [number, number, number, number]> | null {
  const m = code.match(LAYOUT_RE)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1])
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function stripLayoutComment(code: string): string {
  return code
    .replace(/^%%\s*dgr:layout:v1.*$/gm, '')
    .replace(/^%%\s*@다이아그래머:배치.*$/gm, '') // 예전 형식도 지운다
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n'
}
