/**
 * Scene IR — 다이아그래머의 문서 모델.
 *
 * 설계 원칙
 * 1) mermaid 는 "파서 + 레이아웃 엔진"이다. 화면에 그려지는 것은 항상 이 Scene 이다.
 *    따라서 mermaid 가 표현하지 못하는 편집(자유 위치, 임의 도형, 주석, 이미지)도 가능하다.
 * 2) mermaid 왕복을 위해 각 요소는 `mid`(mermaid 식별자)를 기억한다.
 *    코드를 다시 파싱해도 `mid` 가 같은 요소는 사용자가 옮긴 위치와 색을 잃지 않는다.
 * 3) 좌표계는 하나뿐이다: 월드 좌표(px). 화면 변환은 Viewport 가 전담한다.
 */

export type ID = string

export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// ── 도형 ────────────────────────────────────────────────────────────
/**
 * 도형 카탈로그. mermaid 어휘 + draw.io 스타일 자유 도형.
 * 렌더러(shapes.ts)가 각 kind 에 대해 경로와 라벨 여백을 계산한다.
 */
export type ShapeKind =
  // mermaid flowchart 대응
  | 'rect'            // A[..]
  | 'round'           // A(..)
  | 'stadium'         // A([..])
  | 'subroutine'      // A[[..]]
  | 'cylinder'        // A[(..)]
  | 'circle'          // A((..))
  | 'doublecircle'    // A(((..)))
  | 'asymmetric'      // A>..]
  | 'diamond'         // A{..}
  | 'hexagon'         // A{{..}}
  | 'parallelogram'   // A[/../]
  | 'parallelogramAlt' // A[\..\]
  | 'trapezoid'       // A[/..\]
  | 'trapezoidAlt'    // A[\../]
  | 'text'            // 테두리 없는 텍스트
  // 자유 도형 (mermaid 로 내보낼 때는 가장 가까운 형태로 근사)
  | 'triangle'
  | 'triangleDown'
  | 'star'
  | 'cloud'
  | 'note'            // 접힌 모서리 메모
  | 'document'        // 아래가 물결인 문서
  | 'ellipse'
  | 'pentagon'
  | 'arrowShape'      // 블록 화살표
  | 'cross'
  | 'person'          // 액터(졸라맨)
  | 'database'
  | 'display'

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: '사각형',
  round: '둥근 사각형',
  stadium: '알약',
  subroutine: '서브루틴',
  cylinder: '원통(DB)',
  circle: '원',
  doublecircle: '이중 원',
  asymmetric: '비대칭',
  diamond: '마름모(조건)',
  hexagon: '육각형',
  parallelogram: '평행사변형',
  parallelogramAlt: '평행사변형(역)',
  trapezoid: '사다리꼴',
  trapezoidAlt: '사다리꼴(역)',
  text: '텍스트만',
  triangle: '삼각형',
  triangleDown: '역삼각형',
  star: '별',
  cloud: '구름',
  note: '메모',
  document: '문서',
  ellipse: '타원',
  pentagon: '오각형',
  arrowShape: '블록 화살표',
  cross: '십자',
  person: '사람',
  database: '데이터베이스',
  display: '디스플레이',
}

/** mermaid 로 왕복 가능한 도형인지. 아니면 근사해서 내보낸다. */
export const MERMAID_NATIVE_SHAPES: ShapeKind[] = [
  'rect', 'round', 'stadium', 'subroutine', 'cylinder', 'circle', 'doublecircle',
  'asymmetric', 'diamond', 'hexagon', 'parallelogram', 'parallelogramAlt',
  'trapezoid', 'trapezoidAlt', 'text',
]

// ── 스타일 ──────────────────────────────────────────────────────────
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type FontWeight = 400 | 500 | 600 | 700
export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'

export interface NodeStyle {
  fill: string
  stroke: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  color: string          // 글자색
  fontSize: number
  fontWeight: FontWeight
  fontFamily?: string
  italic?: boolean
  align: TextAlign
  valign: VerticalAlign
  radius: number         // round 계열의 모서리 반경
  opacity: number
  shadow?: boolean
  padding: number
}

export type MarkerKind = 'none' | 'arrow' | 'arrowOpen' | 'cross' | 'circle' | 'diamond' | 'diamondFilled'

export interface EdgeStyle {
  stroke: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  color: string          // 라벨 글자색
  fontSize: number
  fontWeight: FontWeight
  opacity: number
  labelBg: string        // 라벨 배경(선 위에 얹힐 때 가독성)
  animated?: boolean
}

export type EdgeRouting = 'orthogonal' | 'straight' | 'curved' | 'custom'

/** 연결점. 'auto' 면 두 도형의 중심을 잇는 선이 경계와 만나는 지점을 쓴다. */
export type Anchor =
  | 'auto'
  | 't' | 'r' | 'b' | 'l'
  | 'tl' | 'tr' | 'bl' | 'br'
  | { nx: number; ny: number }  // 0..1 정규화 좌표

// ── 요소 ────────────────────────────────────────────────────────────
interface ElementBase {
  id: ID
  /** mermaid 쪽 식별자. 왕복 동기화의 앵커. 자유 편집으로 만든 요소는 없을 수 있다. */
  mid?: string
  /** 그룹(subgraph) 소속 */
  parent?: ID
  locked?: boolean
  hidden?: boolean
}

export interface NodeElement extends ElementBase {
  kind: 'node'
  shape: ShapeKind
  x: number   // 중심 x
  y: number   // 중심 y
  w: number
  h: number
  rotation?: number
  text: string
  /** 렌더러가 실제로 쓰는 완성된 스타일 = 테마 + mermaid 지시자 + over */
  style: NodeStyle
  /**
   * 사용자가 UI 에서 직접 바꾼 값만 담는다.
   * 코드를 다시 파싱해 스타일을 재계산해도 이 값은 마지막에 다시 얹혀 살아남는다.
   */
  over?: Partial<NodeStyle>
  /**
   * mermaid 코드의 style/classDef 에서 온 값.
   * 테마를 바꿀 때 style = 테마 + codeStyle + over 로 다시 쌓기 위해 따로 보관한다.
   * (이게 없으면 테마 전환이 코드로 지정한 색을 지워 버리고, 다음 동기화에서 코드에서도 사라진다)
   */
  codeStyle?: Partial<NodeStyle>
  /** 사용자가 직접 옮겼는가. true 면 자동 레이아웃이 위치를 덮어쓰지 않는다. */
  pinned?: boolean
  link?: string
  tooltip?: string
  /** mermaid classDef 로 묶인 클래스 이름들 */
  classes?: string[]
}

export interface EdgeElement extends ElementBase {
  kind: 'edge'
  source: ID
  target: ID
  sourceAnchor: Anchor
  targetAnchor: Anchor
  label: string
  routing: EdgeRouting
  /** routing==='custom' 일 때 경유점(월드 좌표) */
  waypoints?: Vec[]
  /**
   * 경유점이 mermaid 레이아웃에서 유래했는가.
   * true 면 연결된 노드가 움직이는 순간 버리고 자동 라우팅으로 돌아간다.
   * (사용자가 직접 찍은 경유점은 false — 노드를 옮겨도 지키는 것이 기대 동작이다)
   */
  autoWaypoints?: boolean
  style: EdgeStyle
  over?: Partial<EdgeStyle>
  codeStyle?: Partial<EdgeStyle>
  startMarker: MarkerKind
  endMarker: MarkerKind
  /** 라벨을 선분상 어디에 놓을지 0..1 */
  labelPos?: number
  labelOffset?: Vec
}

export interface GroupElement extends ElementBase {
  kind: 'group'
  x: number
  y: number
  w: number
  h: number
  title: string
  style: NodeStyle
  over?: Partial<NodeStyle>
  codeStyle?: Partial<NodeStyle>
  /** 사용자가 직접 옮겼는가 (자동 레이아웃이 덮어쓰지 않는다) */
  pinned?: boolean
  collapsed?: boolean
}

export interface TextElement extends ElementBase {
  kind: 'text'
  x: number
  y: number
  w: number
  h: number
  text: string
  style: NodeStyle
  over?: Partial<NodeStyle>
  codeStyle?: Partial<NodeStyle>
  rotation?: number
}

export interface ImageElement extends ElementBase {
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  /** data: URI. 외부 URL 을 쓰면 PNG 내보내기에서 canvas 가 오염된다. */
  src: string
  alt?: string
  rotation?: number
  opacity?: number
}

export interface FreedrawElement extends ElementBase {
  kind: 'freedraw'
  points: Vec[]
  style: EdgeStyle
}

export type SceneElement =
  | NodeElement
  | EdgeElement
  | GroupElement
  | TextElement
  | ImageElement
  | FreedrawElement

export type BoxElement = NodeElement | GroupElement | TextElement | ImageElement

export function isBox(el: SceneElement | undefined): el is BoxElement {
  return !!el && (el.kind === 'node' || el.kind === 'group' || el.kind === 'text' || el.kind === 'image')
}
export function isNode(el: SceneElement | undefined): el is NodeElement {
  return !!el && el.kind === 'node'
}
export function isEdge(el: SceneElement | undefined): el is EdgeElement {
  return !!el && el.kind === 'edge'
}

// ── 문서 ────────────────────────────────────────────────────────────
export type SourceLang = 'mermaid'
export type Direction = 'TB' | 'BT' | 'LR' | 'RL'

/**
 * 코드와 캔버스 중 무엇이 진실인가.
 * - 'code'  : 코드가 문서의 뼈대. 캔버스 편집은 위치/스타일 오버레이로만 남는다.
 * - 'canvas': 캔버스가 문서. 코드는 생성물(읽기 전용 미리보기)이 된다.
 *   구조를 코드로 표현할 수 없는 편집(자유 도형, 이미지, 손그림)을 하면 자동으로 'canvas' 가 된다.
 */
export type SourceOfTruth = 'code' | 'canvas'

export interface DiagramTheme {
  id: string
  name: string
  background: string
  grid: string
  node: NodeStyle
  edge: EdgeStyle
  group: NodeStyle
  /** 노드를 추가할 때 순환 배정하는 강조색 */
  accents: string[]
  dark: boolean
}

export interface SceneDoc {
  version: 2
  id: ID
  title: string
  /** 원본 mermaid 코드 */
  code: string
  diagramType: string            // 'flowchart-v2' | 'sequence' | ...
  direction: Direction
  sourceOfTruth: SourceOfTruth
  /** 코드로 표현 불가능한 편집이 존재하는가 (있으면 코드 재생성 시 경고) */
  freeEdits: boolean
  elements: Record<ID, SceneElement>
  /** z-order (뒤 → 앞) */
  order: ID[]
  themeId: string
  /** 테마 위에 덮어쓴 문서 단위 설정 */
  background?: string
  created: number
  modified: number
  tags: string[]
  /**
   * 자유 편집으로 변환할 수 없는 다이어그램 종류(시퀀스·간트 등)일 때,
   * mermaid 가 그린 SVG 를 그대로 보관한다. 이 경우 elements 는 비어 있고 캔버스는 뷰어로 동작한다.
   */
  nativeSvg?: string
  /**
   * nativeSvg 의 내용 크기(viewBox 기준). 화면 맞춤·내보내기·미니맵이 이 값을 경계로 쓴다.
   * 이게 없으면 elements 가 비어 있어 경계가 null 이 되고, 시퀀스 같은 문서는
   * 화면에 안 맞고 내보내기도 빈 상자로 나간다.
   */
  nativeSize?: { w: number; h: number }
  /** 자유 편집 가능 여부 (flowchart 계열이면 true) */
  editable: boolean
  /** 이 문서가 어디에 저장됐는지 */
  savedTo?: { library?: string; vault?: string; note?: string }
}

export interface Viewport {
  x: number     // 월드 원점이 화면 어디에 오는지 (px)
  y: number
  zoom: number
}

// ── 편집기 상태 ─────────────────────────────────────────────────────
export type Tool =
  | 'select'
  | 'pan'
  | 'node'
  | 'edge'
  | 'text'
  | 'group'
  | 'freedraw'
  | 'eraser'

export interface SelectionBox extends Rect {}

// ── 기본값 ──────────────────────────────────────────────────────────
export const DEFAULT_NODE_SIZE = { w: 148, h: 56 }
export const GRID_SIZE = 10
export const SNAP_THRESHOLD = 6

export function emptyDoc(partial: Partial<SceneDoc> = {}): SceneDoc {
  const now = Date.now()
  return {
    version: 2,
    id: partial.id ?? 'doc',
    title: partial.title ?? '무제 다이어그램',
    code: partial.code ?? '',
    diagramType: partial.diagramType ?? 'flowchart-v2',
    direction: partial.direction ?? 'TB',
    sourceOfTruth: partial.sourceOfTruth ?? 'code',
    freeEdits: partial.freeEdits ?? false,
    elements: partial.elements ?? {},
    order: partial.order ?? [],
    themeId: partial.themeId ?? 'midnight',
    editable: partial.editable ?? true,
    created: partial.created ?? now,
    modified: partial.modified ?? now,
    tags: partial.tags ?? [],
    ...partial,
  }
}
