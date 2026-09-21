/**
 * 테마 — 문서의 기본 색/글꼴.
 *
 * mermaid 의 테마와 분리되어 있다. 우리가 직접 그리기 때문에 mermaid 테마 CSS 에 묶이지 않는다.
 * 노드 개별 색은 style 로 덮어쓰며, 덮어쓰지 않은 값은 테마에서 온다.
 */
import type { DiagramTheme, EdgeStyle, NodeStyle } from './types'

const baseNode = (over: Partial<NodeStyle>): NodeStyle => ({
  fill: '#ffffff',
  stroke: '#111827',
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  color: '#111827',
  fontSize: 14,
  fontWeight: 500,
  align: 'center',
  valign: 'middle',
  radius: 8,
  opacity: 1,
  padding: 8,
  ...over,
})

const baseEdge = (over: Partial<EdgeStyle>): EdgeStyle => ({
  stroke: '#4b5563',
  strokeWidth: 1.6,
  strokeStyle: 'solid',
  color: '#374151',
  fontSize: 12,
  fontWeight: 500,
  opacity: 1,
  labelBg: '#ffffff',
  ...over,
})

export const THEMES: DiagramTheme[] = [
  {
    id: 'midnight',
    name: '미드나잇',
    dark: true,
    background: '#0f1115',
    grid: '#1c2029',
    node: baseNode({
      fill: '#1a1f2b',
      stroke: '#3b4457',
      color: '#e6e9ef',
    }),
    edge: baseEdge({ stroke: '#5b6679', color: '#aab3c2', labelBg: '#0f1115' }),
    group: baseNode({
      fill: 'rgba(90,120,190,0.07)',
      stroke: '#39445a',
      color: '#8f9bb3',
      strokeStyle: 'dashed',
      align: 'left',
      valign: 'top',
      radius: 12,
    }),
    accents: ['#6ea8fe', '#7ee0a8', '#f5c977', '#f08c8c', '#c69bf0', '#6fd6d6'],
  },
  {
    id: 'paper',
    name: '페이퍼',
    dark: false,
    background: '#fbfbfa',
    grid: '#eceae5',
    node: baseNode({ fill: '#ffffff', stroke: '#2f3437', color: '#2f3437' }),
    edge: baseEdge({ stroke: '#5c6063', color: '#4a4f52', labelBg: '#fbfbfa' }),
    group: baseNode({
      fill: 'rgba(55,90,160,0.05)',
      stroke: '#c4c0b8',
      color: '#6b6f72',
      strokeStyle: 'dashed',
      align: 'left',
      valign: 'top',
      radius: 12,
    }),
    accents: ['#2f6fd0', '#1f9d63', '#d08b1f', '#cc4f4f', '#8a54c9', '#1f9d9d'],
  },
  {
    id: 'blueprint',
    name: '블루프린트',
    dark: true,
    background: '#0b2545',
    grid: '#123058',
    node: baseNode({
      fill: 'rgba(255,255,255,0.05)',
      stroke: '#8ecae6',
      color: '#e8f4fb',
      strokeWidth: 1.4,
      radius: 2,
    }),
    edge: baseEdge({ stroke: '#8ecae6', color: '#cfe8f5', labelBg: '#0b2545' }),
    group: baseNode({
      fill: 'rgba(142,202,230,0.06)',
      stroke: '#5f93b3',
      color: '#a9cfe3',
      strokeStyle: 'dashed',
      align: 'left',
      valign: 'top',
      radius: 2,
    }),
    accents: ['#ffd166', '#06d6a0', '#ef476f', '#8ecae6', '#c77dff', '#ff9f1c'],
  },
  {
    id: 'mono',
    name: '모노',
    dark: false,
    background: '#ffffff',
    grid: '#f0f0f0',
    node: baseNode({ fill: '#ffffff', stroke: '#000000', color: '#000000', strokeWidth: 2, radius: 0 }),
    edge: baseEdge({ stroke: '#000000', color: '#000000', strokeWidth: 2, labelBg: '#ffffff' }),
    group: baseNode({
      fill: 'transparent',
      stroke: '#000000',
      color: '#000000',
      strokeStyle: 'dashed',
      align: 'left',
      valign: 'top',
      radius: 0,
    }),
    accents: ['#000000', '#555555', '#888888'],
  },
  {
    id: 'sunset',
    name: '선셋',
    dark: false,
    background: '#fff8f2',
    grid: '#f7e8db',
    node: baseNode({ fill: '#ffffff', stroke: '#c2410c', color: '#7c2d12', radius: 10 }),
    edge: baseEdge({ stroke: '#ea580c', color: '#9a3412', labelBg: '#fff8f2' }),
    group: baseNode({
      fill: 'rgba(234,88,12,0.06)',
      stroke: '#f3b28a',
      color: '#9a3412',
      strokeStyle: 'dashed',
      align: 'left',
      valign: 'top',
      radius: 12,
    }),
    accents: ['#ea580c', '#0891b2', '#16a34a', '#7c3aed', '#db2777', '#ca8a04'],
  },
]

export const DEFAULT_THEME_ID = 'midnight'

export function getTheme(id: string | undefined): DiagramTheme {
  return THEMES.find(t => t.id === id) ?? THEMES[0]
}

/** 노드 스타일 = 테마 기본 + 개별 오버라이드 */
export function resolveNodeStyle(theme: DiagramTheme, over?: Partial<NodeStyle>): NodeStyle {
  return { ...theme.node, ...(over || {}) }
}
export function resolveEdgeStyle(theme: DiagramTheme, over?: Partial<EdgeStyle>): EdgeStyle {
  return { ...theme.edge, ...(over || {}) }
}

/** 색상 팔레트 — 인스펙터의 색 선택기에서 사용 */
export const SWATCHES = {
  fill: [
    'transparent', '#ffffff', '#f3f4f6', '#e5e7eb', '#1a1f2b', '#0f1115',
    '#dbeafe', '#bfdbfe', '#dcfce7', '#bbf7d0', '#fef9c3', '#fde68a',
    '#fee2e2', '#fecaca', '#f3e8ff', '#e9d5ff', '#cffafe', '#a5f3fc',
    '#1e3a5f', '#14532d', '#713f12', '#7f1d1d', '#4c1d95', '#164e63',
  ],
  stroke: [
    'transparent', '#000000', '#374151', '#6b7280', '#9ca3af', '#e5e7eb', '#ffffff',
    '#2563eb', '#3b82f6', '#16a34a', '#22c55e', '#ca8a04', '#eab308',
    '#dc2626', '#ef4444', '#9333ea', '#a855f7', '#0891b2', '#06b6d4',
  ],
  text: [
    '#000000', '#111827', '#374151', '#6b7280', '#9ca3af', '#e6e9ef', '#ffffff',
    '#1d4ed8', '#15803d', '#a16207', '#b91c1c', '#7e22ce', '#0e7490',
  ],
}

/** 자주 쓰는 조합 프리셋 — 한 번 클릭으로 노드 외형을 바꾼다 */
export interface StylePreset {
  name: string
  style: Partial<NodeStyle>
}

export const NODE_PRESETS: StylePreset[] = [
  { name: '기본', style: {} },
  { name: '강조', style: { fill: '#2563eb', stroke: '#1d4ed8', color: '#ffffff', fontWeight: 600 } },
  { name: '성공', style: { fill: '#16a34a', stroke: '#15803d', color: '#ffffff', fontWeight: 600 } },
  { name: '경고', style: { fill: '#eab308', stroke: '#ca8a04', color: '#422006', fontWeight: 600 } },
  { name: '위험', style: { fill: '#dc2626', stroke: '#b91c1c', color: '#ffffff', fontWeight: 600 } },
  { name: '비활성', style: { fill: 'transparent', stroke: '#9ca3af', color: '#9ca3af', strokeStyle: 'dashed' } },
  { name: '노트', style: { fill: '#fef9c3', stroke: '#eab308', color: '#713f12' } },
  { name: '외곽선만', style: { fill: 'transparent' } },
]
