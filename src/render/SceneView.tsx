/**
 * Scene 렌더러.
 *
 * 화면에 보이는 것과 내보낸 파일이 같아야 하므로, 이 컴포넌트 하나만 쓴다.
 * 내보내기는 여기서 만들어진 실제 DOM 을 복제해 직렬화한다.
 *
 * 이식성 규칙(Illustrator/Inkscape/Obsidian 에서도 열리도록):
 *  - CSS 클래스에 의존하지 않는다. 모든 시각 속성은 presentation attribute 로 박는다.
 *  - dominant-baseline 대신 줄마다 baseline y 를 직접 계산한다.
 *  - marker 는 (종류 × 색) 조합마다 따로 만든다. context-stroke 는 쓰지 않는다.
 */
import React, { memo, useMemo } from 'react'
import type {
  EdgeElement, FreedrawElement, GroupElement, ImageElement, MarkerKind,
  NodeElement, SceneDoc, SceneElement, TextElement, Vec,
} from '../core/types'
import { SHAPES, labelBox } from '../core/shapes'
import { edgePoints, pointAt, pointsToPath, measureText, wrapText } from '../core/geometry'
import { getTheme } from '../core/theme'

export const FONT_STACK =
  'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", "Malgun Gothic", system-ui, sans-serif'

const LINE_HEIGHT = 1.35
const ASCENT = 0.76

export function dashArray(style: string, width: number): string | undefined {
  if (style === 'dashed') return `${Math.max(4, width * 3)} ${Math.max(3, width * 2)}`
  if (style === 'dotted') return `${Math.max(1, width)} ${Math.max(2, width * 2.2)}`
  return undefined
}

// ── 마커 ────────────────────────────────────────────────────────────
/**
 * 마커 id.
 * 색 문자열에서 비영숫자를 '지우면' rgb(1,23,4) 와 rgb(12,3,4) 가 같은 id 가 되어
 * 한쪽 화살표가 남의 색으로 그려진다. 짧은 해시를 덧붙여 충돌을 없앤다.
 */
function colorKey(color: string): string {
  let h = 2166136261
  for (let i = 0; i < color.length; i++) {
    h ^= color.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function markerId(kind: MarkerKind, color: string, end: boolean): string {
  return `dgm-${kind}-${end ? 'e' : 's'}-${colorKey(color)}`
}

function MarkerDef({ kind, color, end }: { kind: MarkerKind; color: string; end: boolean }) {
  if (kind === 'none') return null
  const id = markerId(kind, color, end)
  // refX 를 마커 끝에 맞춰 선이 화살촉 뒤로 숨게 한다
  const common = { id, markerUnits: 'userSpaceOnUse' as const, orient: 'auto-start-reverse' as const }
  switch (kind) {
    case 'arrow':
      return (
        <marker {...common} viewBox="0 0 10 10" refX={end ? 9.5 : 0.5} refY={5} markerWidth={11} markerHeight={11}>
          <path d="M0.5,1 L9.5,5 L0.5,9 z" fill={color} />
        </marker>
      )
    case 'arrowOpen':
      return (
        <marker {...common} viewBox="0 0 10 10" refX={end ? 9.5 : 0.5} refY={5} markerWidth={12} markerHeight={12}>
          <path d="M1,1.5 L9,5 L1,8.5" fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      )
    case 'circle':
      return (
        <marker {...common} viewBox="0 0 10 10" refX={end ? 9 : 1} refY={5} markerWidth={9} markerHeight={9}>
          <circle cx={5} cy={5} r={3.6} fill={color} />
        </marker>
      )
    case 'cross':
      return (
        <marker {...common} viewBox="0 0 10 10" refX={end ? 9 : 1} refY={5} markerWidth={10} markerHeight={10}>
          <path d="M2,2 L8,8 M8,2 L2,8" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
        </marker>
      )
    case 'diamond':
      return (
        <marker {...common} viewBox="0 0 12 10" refX={end ? 11 : 1} refY={5} markerWidth={12} markerHeight={10}>
          <path d="M1,5 L6,1.5 L11,5 L6,8.5 z" fill="none" stroke={color} strokeWidth={1.4} />
        </marker>
      )
    case 'diamondFilled':
      return (
        <marker {...common} viewBox="0 0 12 10" refX={end ? 11 : 1} refY={5} markerWidth={12} markerHeight={10}>
          <path d="M1,5 L6,1.5 L11,5 L6,8.5 z" fill={color} />
        </marker>
      )
    default:
      return null
  }
}

/** 문서에서 실제로 쓰이는 마커 조합만 defs 로 만든다 */
export function useMarkerDefs(doc: SceneDoc): React.ReactNode {
  return useMemo(() => {
    const combos = new Map<string, { kind: MarkerKind; color: string; end: boolean }>()
    for (const id of doc.order) {
      const el = doc.elements[id]
      if (!el || el.kind !== 'edge') continue
      if (el.startMarker !== 'none') {
        combos.set(markerId(el.startMarker, el.style.stroke, false), { kind: el.startMarker, color: el.style.stroke, end: false })
      }
      if (el.endMarker !== 'none') {
        combos.set(markerId(el.endMarker, el.style.stroke, true), { kind: el.endMarker, color: el.style.stroke, end: true })
      }
    }
    return Array.from(combos.entries()).map(([key, c]) => <MarkerDef key={key} {...c} />)
  }, [doc.elements, doc.order])
}

// ── 텍스트 ──────────────────────────────────────────────────────────
interface TextBlockProps {
  text: string
  box: { x: number; y: number; w: number; h: number }
  fill: string
  fontSize: number
  fontWeight: number
  align: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  italic?: boolean
  fontFamily?: string
}

export const TextBlock = memo(function TextBlock({
  text, box, fill, fontSize, fontWeight, align, valign, italic, fontFamily,
}: TextBlockProps) {
  const family = fontFamily || FONT_STACK
  const lines = useMemo(
    () => (text ? wrapText(text, Math.max(20, box.w), fontSize, fontWeight, family) : []),
    [text, box.w, fontSize, fontWeight, family],
  )
  if (!lines.length) return null

  const lineH = fontSize * LINE_HEIGHT
  const blockH = lines.length * lineH
  const top =
    valign === 'top' ? box.y
      : valign === 'bottom' ? box.y + box.h - blockH
        : box.y + (box.h - blockH) / 2

  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2

  return (
    <text
      fontFamily={family}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={italic ? 'italic' : undefined}
      fill={fill}
      textAnchor={anchor}
      style={{ userSelect: 'none', pointerEvents: 'none' }}
      xmlSpace="preserve"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={top + i * lineH + fontSize * ASCENT}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  )
})

// ── 노드 ────────────────────────────────────────────────────────────
export const NodeView = memo(function NodeView({ el }: { el: NodeElement }) {
  const def = SHAPES[el.shape] ?? SHAPES.rect
  const s = el.style
  const d = el.shape === 'text' ? '' : def.path(el.w, el.h, s.radius)
  const decor = def.decor?.(el.w, el.h) ?? []
  const lb = labelBox(el.shape, el.w, el.h, 2)
  const strokeOnly = el.shape === 'person'

  return (
    <g
      transform={`translate(${r2(el.x)},${r2(el.y)})${el.rotation ? ` rotate(${el.rotation})` : ''}`}
      opacity={s.opacity !== 1 ? s.opacity : undefined}
      data-el={el.id}
    >
      {d && (
        <path
          d={d}
          fill={strokeOnly ? 'none' : s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          strokeDasharray={dashArray(s.strokeStyle, s.strokeWidth)}
          strokeLinejoin="round"
          filter={s.shadow ? 'url(#dgm-shadow)' : undefined}
        />
      )}
      {decor.map((dd, i) => (
        <path key={i} d={dd} fill="none" stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <TextBlock
        text={el.text}
        box={lb}
        fill={s.color}
        fontSize={s.fontSize}
        fontWeight={s.fontWeight}
        align={s.align}
        valign={def.labelBelow ? 'top' : s.valign}
        italic={s.italic}
        fontFamily={s.fontFamily}
      />
      {el.link ? <title>{el.link}</title> : el.tooltip ? <title>{el.tooltip}</title> : null}
    </g>
  )
})

// ── 그룹 ────────────────────────────────────────────────────────────
export const GroupView = memo(function GroupView({ el }: { el: GroupElement }) {
  const s = el.style
  const titleH = 26
  return (
    <g transform={`translate(${r2(el.x - el.w / 2)},${r2(el.y - el.h / 2)})`} data-el={el.id} opacity={s.opacity !== 1 ? s.opacity : undefined}>
      <rect
        x={0}
        y={0}
        width={el.w}
        height={el.h}
        rx={s.radius}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        strokeDasharray={dashArray(s.strokeStyle, s.strokeWidth)}
      />
      {el.title ? (
        <TextBlock
          text={el.title}
          box={{ x: 12, y: 4, w: Math.max(20, el.w - 24), h: titleH }}
          fill={s.color}
          fontSize={s.fontSize}
          fontWeight={600}
          align={s.align === 'center' ? 'center' : 'left'}
          valign="middle"
          fontFamily={s.fontFamily}
        />
      ) : null}
    </g>
  )
})

// ── 엣지 ────────────────────────────────────────────────────────────
export const EdgeView = memo(function EdgeView({ doc, el }: { doc: SceneDoc; el: EdgeElement }) {
  const pts = useMemo(() => edgePoints(doc, el), [doc.elements, el])
  if (pts.length < 2) return null
  const d = pointsToPath(pts, el.routing)
  const s = el.style
  const labelP = el.labelPos ?? 0.5
  const lp = pointAt(pts, labelP)
  const lo = el.labelOffset ?? { x: 0, y: 0 }

  const label = el.label
  const m = label ? measureText(label, s.fontSize, s.fontWeight) : null

  return (
    <g data-el={el.id} opacity={s.opacity !== 1 ? s.opacity : undefined}>
      <path
        d={d}
        fill="none"
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        strokeDasharray={dashArray(s.strokeStyle, s.strokeWidth)}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerStart={el.startMarker !== 'none' ? `url(#${markerId(el.startMarker, s.stroke, false)})` : undefined}
        markerEnd={el.endMarker !== 'none' ? `url(#${markerId(el.endMarker, s.stroke, true)})` : undefined}
      />
      {label && m ? (
        <g transform={`translate(${r2(lp.x + lo.x)},${r2(lp.y + lo.y)})`}>
          <rect
            x={-m.w / 2 - 5}
            y={-m.h / 2 - 2}
            width={m.w + 10}
            height={m.h + 4}
            rx={4}
            fill={s.labelBg}
            opacity={s.labelBg === 'transparent' ? 0 : 0.92}
          />
          <TextBlock
            text={label}
            box={{ x: -m.w / 2 - 2, y: -m.h / 2, w: m.w + 4, h: m.h }}
            fill={s.color}
            fontSize={s.fontSize}
            fontWeight={s.fontWeight}
            align="center"
            valign="middle"
          />
        </g>
      ) : null}
    </g>
  )
})

// ── 텍스트/이미지/손그림 ────────────────────────────────────────────
export const TextView = memo(function TextView({ el }: { el: TextElement }) {
  const s = el.style
  return (
    <g transform={`translate(${r2(el.x - el.w / 2)},${r2(el.y - el.h / 2)})${el.rotation ? ` rotate(${el.rotation},${el.w / 2},${el.h / 2})` : ''}`} data-el={el.id}>
      {s.fill && s.fill !== 'transparent' ? (
        <rect x={0} y={0} width={el.w} height={el.h} rx={s.radius} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      ) : null}
      <TextBlock
        text={el.text}
        box={{ x: 4, y: 2, w: Math.max(10, el.w - 8), h: Math.max(10, el.h - 4) }}
        fill={s.color}
        fontSize={s.fontSize}
        fontWeight={s.fontWeight}
        align={s.align}
        valign={s.valign}
        italic={s.italic}
        fontFamily={s.fontFamily}
      />
    </g>
  )
})

export const ImageView = memo(function ImageView({ el }: { el: ImageElement }) {
  return (
    <image
      data-el={el.id}
      href={el.src}
      x={r2(el.x - el.w / 2)}
      y={r2(el.y - el.h / 2)}
      width={el.w}
      height={el.h}
      opacity={el.opacity ?? 1}
      preserveAspectRatio="xMidYMid meet"
      transform={el.rotation ? `rotate(${el.rotation},${r2(el.x)},${r2(el.y)})` : undefined}
    />
  )
})

export const FreedrawView = memo(function FreedrawView({ el }: { el: FreedrawElement }) {
  if (el.points.length < 2) return null
  const d = smoothPath(el.points)
  return (
    <path
      data-el={el.id}
      d={d}
      fill="none"
      stroke={el.style.stroke}
      strokeWidth={el.style.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={el.style.opacity}
    />
  )
})

function smoothPath(pts: Vec[]): string {
  let d = `M${r2(pts[0].x)},${r2(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2
    const my = (pts[i].y + pts[i + 1].y) / 2
    d += ` Q${r2(pts[i].x)},${r2(pts[i].y)} ${r2(mx)},${r2(my)}`
  }
  const last = pts[pts.length - 1]
  d += ` L${r2(last.x)},${r2(last.y)}`
  return d
}

// ── 레이어 ──────────────────────────────────────────────────────────
export function ElementView({ doc, el }: { doc: SceneDoc; el: SceneElement }) {
  if (el.hidden) return null
  switch (el.kind) {
    case 'node': return <NodeView el={el} />
    case 'group': return <GroupView el={el} />
    case 'edge': return <EdgeView doc={doc} el={el} />
    case 'text': return <TextView el={el} />
    case 'image': return <ImageView el={el} />
    case 'freedraw': return <FreedrawView el={el} />
    default: return null
  }
}

/**
 * 문서 전체를 그리는 레이어. 내보내기가 이 g 를 통째로 복제한다.
 *
 * 그리는 순서는 doc.order 를 **그대로** 따른다.
 * 예전에는 종류별로(그룹→엣지→나머지) 다시 묶었는데, 그러면 '맨 앞으로' 명령이
 * 엣지·그룹에는 아무 효과가 없다. 대신 문서를 만들 때 order 를
 * [그룹 … 엣지 … 노드] 순으로 쌓아 기본 모양을 맞춘다(importer 참고).
 */
export const SceneLayer = memo(function SceneLayer({ doc }: { doc: SceneDoc }) {
  return (
    <g data-layer="scene">
      {doc.order.map(id => (doc.elements[id] ? <ElementView key={id} doc={doc} el={doc.elements[id]} /> : null))}
    </g>
  )
})

export function SceneDefs({ doc }: { doc: SceneDoc }) {
  const markers = useMarkerDefs(doc)
  return (
    <defs>
      {markers}
      <filter id="dgm-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.22" />
      </filter>
    </defs>
  )
}

export function docBackground(doc: SceneDoc): string {
  return doc.background ?? getTheme(doc.themeId).background
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
