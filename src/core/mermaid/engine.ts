/**
 * mermaid 래퍼.
 *
 * mermaid 를 화면 렌더러로 쓰지 않는다. 두 가지 목적으로만 부른다.
 *  1) parse : 문법 검증 + 오류 위치
 *  2) render: dagre 가 계산한 좌표를 회수 (결과 SVG 는 버리고 좌표만 취한다)
 */
import mermaid from 'mermaid'

export type MermaidTheme = 'default' | 'dark'

let currentTheme: MermaidTheme | null = null

/**
 * theme 이 중요한 곳은 자유 편집이 안 되는 종류(시퀀스·간트 등)뿐이다.
 * 그 종류는 mermaid 가 그린 SVG 가 그대로 최종 결과물이라, 어두운 캔버스에 밝은 테마를 얹으면
 * 글자가 묻힌다. flowchart 는 SVG 를 버리고 좌표만 쓰므로 항상 'default' 로 재어 일관성을 지킨다.
 */
export function initMermaid(theme: MermaidTheme = 'default') {
  if (currentTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme,
    fontFamily:
      'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    /**
     * dagre 로 고정한다. mermaid 12 의 기본값은 elk 인데,
     *  - Obsidian 이 내장한 mermaid 11.13 에는 elk 가 없어 같은 코드가 다르게 그려지고,
     *  - elk 는 비동기 로드라 첫 렌더가 느리다.
     * 우리가 쓰는 것은 좌표뿐이므로 Obsidian 과 같은 엔진으로 맞추는 편이 이득이다.
     */
    layout: 'dagre',
    /**
     * htmlLabels:false 가 핵심이다. true 면 라벨이 foreignObject 로 그려지는데,
     * foreignObject 가 섞인 SVG 는 <img>/canvas 로 구울 때 외부 CSS·폰트가 해소되지 않아
     * 라벨 스타일이 통째로 날아간다(Obsidian 임베드, PNG 내보내기 모두 해당).
     * 편집 불가 타입은 mermaid SVG 를 그대로 보여주고 내보내므로 여기서 막아야 한다.
     */
    htmlLabels: false,
    flowchart: { htmlLabels: false, curve: 'basis', padding: 12, nodeSpacing: 60, rankSpacing: 60 },
    sequence: { useMaxWidth: false },
    er: { useMaxWidth: false },
    // 렌더 중 오류가 나도 예외로 받는다 (화면에 mermaid 의 빨간 에러 그림을 띄우지 않는다)
    suppressErrorRendering: true,
  })
  currentTheme = theme
}

export interface ParseIssue {
  message: string
  line?: number
  column?: number
  hint?: string
}

const HINTS: { test: RegExp; hint: string }[] = [
  { test: /got 'PS'|got 'SQS'|Expecting .*'SQE'/i, hint: '대괄호/괄호가 짝이 맞는지 확인하세요. 예: A[텍스트], B(텍스트), C{텍스트}' },
  { test: /got 'NEWLINE'/i, hint: '줄이 끝나지 않았습니다. 화살표(-->)나 노드 정의가 중간에 끊겼는지 확인하세요.' },
  { test: /No diagram type detected/i, hint: '첫 줄에 다이어그램 종류를 적어야 합니다. 예: flowchart TD, sequenceDiagram, classDiagram' },
  { test: /got 'STR'/i, hint: '따옴표 안에 대괄호나 특수문자가 있으면 " " 로 감싸세요. 예: A["a[b]"]' },
  { test: /Expecting .*'DIR'/i, hint: '방향 지정이 잘못됐습니다. TD, TB, LR, RL, BT 중 하나여야 합니다.' },
]

function toIssue(e: unknown): ParseIssue {
  const raw = e instanceof Error ? e.message : String(e)
  // mermaid 는 "Parse error on line 3:" 형태로 알려준다
  const m = raw.match(/on line (\d+)/i)
  const col = raw.match(/column (\d+)/i)
  const hint = HINTS.find(h => h.test.test(raw))?.hint
  // 장황한 jison 덤프에서 사람이 읽을 만한 앞부분만 남긴다
  const firstLines = raw.split('\n').slice(0, 4).join('\n')
  return {
    message: firstLines.trim(),
    line: m ? Number(m[1]) : undefined,
    column: col ? Number(col[1]) : undefined,
    hint,
  }
}

/**
 * mermaid 는 파싱 전에 `%%` 로 시작하는 줄을 통째로 지운다.
 * 그래서 오류 메시지의 줄 번호는 "주석을 뺀 코드" 기준이라 에디터 줄 번호와 어긋난다.
 * 지워진 줄 수만큼 되돌려 실제 줄 번호로 바꾼다.
 */
function correctLine(code: string, strippedLine: number | undefined): number | undefined {
  if (!strippedLine) return strippedLine
  const lines = code.split('\n')
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*%%(?!\{)/.test(lines[i])) continue
    seen++
    if (seen === strippedLine) return i + 1
  }
  return strippedLine
}

export async function parseMermaid(code: string): Promise<{ ok: true; diagramType: string } | { ok: false; issue: ParseIssue }> {
  initMermaid()
  try {
    const res = await mermaid.parse(code, { suppressErrors: false })
    const diagramType = typeof res === 'object' && res && 'diagramType' in res ? String((res as any).diagramType) : detectType(code)
    return { ok: true, diagramType }
  } catch (e) {
    const issue = toIssue(e)
    return { ok: false, issue: { ...issue, line: correctLine(code, issue.line) } }
  }
}

export function detectType(code: string): string {
  initMermaid()
  try {
    return mermaid.detectType(code)
  } catch {
    return 'unknown'
  }
}

let renderSeq = 0

export interface RenderResult {
  svg: string
  diagramType: string
}

/**
 * mermaid 로 렌더해서 SVG 문자열을 얻는다.
 * mermaid 는 렌더 중 document.body 에 임시 노드를 붙였다 떼므로 브라우저에서만 동작한다.
 */
export async function renderMermaid(code: string, theme: MermaidTheme = 'default'): Promise<RenderResult> {
  initMermaid(theme)
  const id = `dgm_${Date.now().toString(36)}_${renderSeq++}`
  try {
    const { svg, diagramType } = await mermaid.render(id, code)
    return { svg: sanitizeMermaidSvg(svg), diagramType: diagramType || detectType(code) }
  } finally {
    // 측정용 기본 테마로 되돌려 둔다. 다음 flowchart 렌더가 같은 조건에서 좌표를 내도록.
    if (theme !== 'default') initMermaid('default')
  }
}

/**
 * mermaid SVG 를 그대로 보여줄 때 손봐야 하는 것들.
 *
 * mermaid 12 는 엣지마다 `stroke-dasharray: 0 0 <len> 4` 를 인라인으로 박는다.
 * 이것은 선 애니메이션(animate)을 켰을 때 쓰려고 미리 심어 둔 값인데,
 * 애니메이션을 안 켜면 그냥 **점선으로 보인다**. 실선이어야 할 선이 점선으로 나오는 원인이다.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return svg
    .replace(/stroke-dasharray:\s*0\s+0\s+[\d.]+\s+[\d.]+\s*;?/g, '')
    .replace(/stroke-dashoffset:\s*[\d.]+\s*;?/g, '')
    .replace(/style="\s*;*\s*"/g, '')
}

/** 파서가 만든 구조체(db)를 꺼낸다. flowchart 만 구조 추출에 쓴다. */
export async function getDiagramDb(code: string): Promise<{ type: string; db: any } | null> {
  initMermaid()
  try {
    const d: any = await (mermaid as any).mermaidAPI.getDiagramFromText(code)
    return { type: d?.type ?? detectType(code), db: d?.db ?? null }
  } catch {
    return null
  }
}

/** 이 타입이 Scene 으로 완전 변환(자유 편집) 가능한가 */
export function isEditableType(diagramType: string): boolean {
  return diagramType === 'flowchart-v2' || diagramType === 'flowchart' || diagramType === 'graph'
}

export const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  'flowchart-v2': '플로우차트',
  flowchart: '플로우차트',
  graph: '플로우차트',
  sequence: '시퀀스 다이어그램',
  classDiagram: '클래스 다이어그램',
  class: '클래스 다이어그램',
  stateDiagram: '상태 다이어그램',
  state: '상태 다이어그램',
  er: 'ER 다이어그램',
  gantt: '간트 차트',
  pie: '파이 차트',
  journey: '사용자 여정',
  mindmap: '마인드맵',
  gitGraph: 'Git 그래프',
  timeline: '타임라인',
  quadrantChart: '사분면 차트',
  xychart: 'XY 차트',
  requirement: '요구사항 다이어그램',
  sankey: '생키 다이어그램',
  block: '블록 다이어그램',
  architecture: '아키텍처 다이어그램',
  packet: '패킷 다이어그램',
  c4: 'C4 다이어그램',
  unknown: '알 수 없음',
}

export function typeLabel(t: string): string {
  return DIAGRAM_TYPE_LABELS[t] ?? t
}
