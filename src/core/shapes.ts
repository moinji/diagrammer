/**
 * 도형 카탈로그.
 *
 * 각 도형은 (0,0) 을 중심으로 하는 좌표계에서 정의된다. 렌더러가 g.transform 으로 옮기므로
 * 도형 함수는 크기만 신경 쓰면 된다.
 *
 * 두 가지를 제공한다:
 *  - path(w,h)    : 그리기용 SVG path d
 *  - outline(w,h) : 엣지 끝점 계산용 다각형. 원/타원도 다각형으로 근사해서
 *                   "중심에서 쏜 광선과 경계의 교점"을 한 가지 코드로 처리한다.
 *  - inset(w,h)   : 라벨이 도형 밖으로 삐져나오지 않도록 하는 안쪽 여백
 */
import type { ShapeKind, Vec } from './types'

export interface Inset {
  top: number
  right: number
  bottom: number
  left: number
}

const NONE: Inset = { top: 0, right: 0, bottom: 0, left: 0 }
const uniform = (v: number): Inset => ({ top: v, right: v, bottom: v, left: v })

/** 다각형을 path d 로 */
function poly(pts: Vec[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`).join(' ') + ' Z'
}
function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** 타원 위의 점 n개 */
function ellipsePoints(rx: number, ry: number, n = 48): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push({ x: Math.cos(t) * rx, y: Math.sin(t) * ry })
  }
  return out
}

function roundedRectPath(w: number, h: number, r: number): string {
  const hw = w / 2
  const hh = h / 2
  const rr = Math.max(0, Math.min(r, hw, hh))
  if (rr <= 0.01) return poly([{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }])
  return [
    `M${round(-hw + rr)},${round(-hh)}`,
    `H${round(hw - rr)}`,
    `A${round(rr)},${round(rr)} 0 0 1 ${round(hw)},${round(-hh + rr)}`,
    `V${round(hh - rr)}`,
    `A${round(rr)},${round(rr)} 0 0 1 ${round(hw - rr)},${round(hh)}`,
    `H${round(-hw + rr)}`,
    `A${round(rr)},${round(rr)} 0 0 1 ${round(-hw)},${round(hh - rr)}`,
    `V${round(-hh + rr)}`,
    `A${round(rr)},${round(rr)} 0 0 1 ${round(-hw + rr)},${round(-hh)}`,
    'Z',
  ].join(' ')
}

export interface ShapeDef {
  /** 주 경로 */
  path: (w: number, h: number, radius: number) => string
  /** 보조 경로(원통 뚜껑, 이중원 안쪽 등) — 채우기 없이 선만 그린다 */
  decor?: (w: number, h: number) => string[]
  outline: (w: number, h: number, radius: number) => Vec[]
  inset: (w: number, h: number) => Inset
  /** 라벨을 도형 아래에 그려야 하는가 (사람 아이콘 등) */
  labelBelow?: boolean
  /** 가로세로 비율 고정 */
  aspect?: number
}

const rectOutline = (w: number, h: number): Vec[] => {
  const hw = w / 2
  const hh = h / 2
  return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
}

export const SHAPES: Record<ShapeKind, ShapeDef> = {
  rect: {
    path: (w, h) => roundedRectPath(w, h, 0),
    outline: rectOutline,
    inset: () => uniform(10),
  },
  round: {
    path: (w, h, r) => roundedRectPath(w, h, r || 10),
    outline: rectOutline,
    inset: () => uniform(10),
  },
  stadium: {
    path: (w, h) => roundedRectPath(w, h, h / 2),
    outline: rectOutline,
    inset: (_w, h) => ({ top: 8, right: Math.min(28, h * 0.4), bottom: 8, left: Math.min(28, h * 0.4) }),
  },
  subroutine: {
    path: (w, h) => roundedRectPath(w, h, 0),
    decor: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(10, w * 0.12)
      return [
        `M${round(-hw + d)},${round(-hh)} V${round(hh)}`,
        `M${round(hw - d)},${round(-hh)} V${round(hh)}`,
      ]
    },
    outline: rectOutline,
    inset: () => ({ top: 10, right: 18, bottom: 10, left: 18 }),
  },
  cylinder: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const ry = Math.min(h * 0.18, 16)
      return [
        `M${round(-hw)},${round(-hh + ry)}`,
        `A${round(hw)},${round(ry)} 0 0 1 ${round(hw)},${round(-hh + ry)}`,
        `V${round(hh - ry)}`,
        `A${round(hw)},${round(ry)} 0 0 1 ${round(-hw)},${round(hh - ry)}`,
        'Z',
      ].join(' ')
    },
    decor: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const ry = Math.min(h * 0.18, 16)
      return [`M${round(-hw)},${round(-hh + ry)} A${round(hw)},${round(ry)} 0 0 0 ${round(hw)},${round(-hh + ry)}`]
    },
    outline: rectOutline,
    inset: (_w, h) => ({ top: Math.min(h * 0.32, 26), right: 10, bottom: 10, left: 10 }),
  },
  circle: {
    path: (w, h) => {
      const r = Math.min(w, h) / 2
      return `M${round(-r)},0 a${round(r)},${round(r)} 0 1 0 ${round(r * 2)},0 a${round(r)},${round(r)} 0 1 0 ${round(-r * 2)},0 Z`
    },
    outline: (w, h) => ellipsePoints(Math.min(w, h) / 2, Math.min(w, h) / 2),
    inset: (w, h) => uniform(Math.min(w, h) * 0.16),
    aspect: 1,
  },
  doublecircle: {
    path: (w, h) => {
      const r = Math.min(w, h) / 2
      return `M${round(-r)},0 a${round(r)},${round(r)} 0 1 0 ${round(r * 2)},0 a${round(r)},${round(r)} 0 1 0 ${round(-r * 2)},0 Z`
    },
    decor: (w, h) => {
      const r = Math.min(w, h) / 2 - 5
      return [`M${round(-r)},0 a${round(r)},${round(r)} 0 1 0 ${round(r * 2)},0 a${round(r)},${round(r)} 0 1 0 ${round(-r * 2)},0`]
    },
    outline: (w, h) => ellipsePoints(Math.min(w, h) / 2, Math.min(w, h) / 2),
    inset: (w, h) => uniform(Math.min(w, h) * 0.2),
    aspect: 1,
  },
  ellipse: {
    path: (w, h) => {
      const rx = w / 2
      const ry = h / 2
      return `M${round(-rx)},0 a${round(rx)},${round(ry)} 0 1 0 ${round(rx * 2)},0 a${round(rx)},${round(ry)} 0 1 0 ${round(-rx * 2)},0 Z`
    },
    outline: (w, h) => ellipsePoints(w / 2, h / 2),
    inset: (w, h) => ({ top: h * 0.14, right: w * 0.14, bottom: h * 0.14, left: w * 0.14 }),
  },
  asymmetric: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(h * 0.4, 22)
      return poly([
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
        { x: -hw + d, y: 0 },
      ])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(h * 0.4, 22)
      return [
        { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh },
        { x: -hw, y: hh }, { x: -hw + d, y: 0 },
      ]
    },
    inset: () => ({ top: 10, right: 12, bottom: 10, left: 24 }),
  },
  diamond: {
    path: (w, h) => poly([{ x: 0, y: -h / 2 }, { x: w / 2, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: 0 }]),
    outline: (w, h) => [{ x: 0, y: -h / 2 }, { x: w / 2, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: 0 }],
    inset: (w, h) => ({ top: h * 0.24, right: w * 0.24, bottom: h * 0.24, left: w * 0.24 }),
  },
  hexagon: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.2, h * 0.5)
      return poly([
        { x: -hw + d, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: 0 },
        { x: hw - d, y: hh }, { x: -hw + d, y: hh }, { x: -hw, y: 0 },
      ])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.2, h * 0.5)
      return [
        { x: -hw + d, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: 0 },
        { x: hw - d, y: hh }, { x: -hw + d, y: hh }, { x: -hw, y: 0 },
      ]
    },
    inset: w => ({ top: 10, right: Math.min(w * 0.22, 30), bottom: 10, left: Math.min(w * 0.22, 30) }), // w 기준이 맞다
  },
  parallelogram: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.8)
      return poly([{ x: -hw + d, y: -hh }, { x: hw, y: -hh }, { x: hw - d, y: hh }, { x: -hw, y: hh }])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.8)
      return [{ x: -hw + d, y: -hh }, { x: hw, y: -hh }, { x: hw - d, y: hh }, { x: -hw, y: hh }]
    },
    inset: w => ({ top: 10, right: Math.min(w * 0.2, 28), bottom: 10, left: Math.min(w * 0.2, 28) }),
  },
  parallelogramAlt: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.8)
      return poly([{ x: -hw, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: hh }, { x: -hw + d, y: hh }])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.8)
      return [{ x: -hw, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: hh }, { x: -hw + d, y: hh }]
    },
    inset: w => ({ top: 10, right: Math.min(w * 0.2, 28), bottom: 10, left: Math.min(w * 0.2, 28) }),
  },
  trapezoid: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.9)
      return poly([{ x: -hw + d, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.9)
      return [{ x: -hw + d, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
    },
    inset: w => ({ top: 10, right: Math.min(w * 0.2, 28), bottom: 10, left: Math.min(w * 0.2, 28) }),
  },
  trapezoidAlt: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.9)
      return poly([{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw - d, y: hh }, { x: -hw + d, y: hh }])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.18, h * 0.9)
      return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw - d, y: hh }, { x: -hw + d, y: hh }]
    },
    inset: w => ({ top: 10, right: Math.min(w * 0.2, 28), bottom: 10, left: Math.min(w * 0.2, 28) }),
  },
  text: {
    path: () => '',
    outline: rectOutline,
    inset: () => uniform(4),
  },
  triangle: {
    path: (w, h) => poly([{ x: 0, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }]),
    outline: (w, h) => [{ x: 0, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }],
    inset: (w, h) => ({ top: h * 0.42, right: w * 0.2, bottom: 8, left: w * 0.2 }),
  },
  triangleDown: {
    path: (w, h) => poly([{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: 0, y: h / 2 }]),
    outline: (w, h) => [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: 0, y: h / 2 }],
    inset: (w, h) => ({ top: 8, right: w * 0.2, bottom: h * 0.42, left: w * 0.2 }),
  },
  star: {
    path: (w, h) => {
      const R = Math.min(w, h) / 2
      const r = R * 0.42
      const pts: Vec[] = []
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? R : r
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad })
      }
      return poly(pts)
    },
    outline: (w, h) => {
      const R = Math.min(w, h) / 2
      const r = R * 0.42
      const pts: Vec[] = []
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? R : r
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad })
      }
      return pts
    },
    inset: (w, h) => uniform(Math.min(w, h) * 0.26),
    aspect: 1,
  },
  cloud: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      return [
        `M${round(-hw * 0.55)},${round(hh * 0.6)}`,
        `a${round(hw * 0.3)},${round(hh * 0.34)} 0 0 1 ${round(-hw * 0.2)},${round(-hh * 0.86)}`,
        `a${round(hw * 0.32)},${round(hh * 0.4)} 0 0 1 ${round(hw * 0.55)},${round(-hh * 0.5)}`,
        `a${round(hw * 0.36)},${round(hh * 0.42)} 0 0 1 ${round(hw * 0.86)},${round(hh * 0.06)}`,
        `a${round(hw * 0.3)},${round(hh * 0.36)} 0 0 1 ${round(hw * 0.28)},${round(hh * 0.9)}`,
        `a${round(hw * 0.26)},${round(hh * 0.3)} 0 0 1 ${round(-hw * 0.42)},${round(hh * 0.4)}`,
        'Z',
      ].join(' ')
    },
    outline: (w, h) => ellipsePoints(w * 0.46, h * 0.42),
    inset: (w, h) => ({ top: h * 0.26, right: w * 0.18, bottom: h * 0.2, left: w * 0.18 }),
  },
  note: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w, h) * 0.22
      return poly([
        { x: -hw, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: -hh + d },
        { x: hw, y: hh }, { x: -hw, y: hh },
      ])
    },
    decor: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w, h) * 0.22
      return [`M${round(hw - d)},${round(-hh)} V${round(-hh + d)} H${round(hw)}`]
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w, h) * 0.22
      return [{ x: -hw, y: -hh }, { x: hw - d, y: -hh }, { x: hw, y: -hh + d }, { x: hw, y: hh }, { x: -hw, y: hh }]
    },
    inset: () => ({ top: 14, right: 14, bottom: 10, left: 10 }),
  },
  document: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const wave = h * 0.16
      return [
        `M${round(-hw)},${round(-hh)}`,
        `H${round(hw)}`,
        `V${round(hh - wave)}`,
        `q${round(-w * 0.25)},${round(wave * 1.6)} ${round(-w * 0.5)},0`,
        `q${round(-w * 0.25)},${round(-wave * 1.6)} ${round(-w * 0.5)},0`,
        'Z',
      ].join(' ')
    },
    outline: rectOutline,
    inset: (_w, h) => ({ top: 10, right: 10, bottom: Math.min(h * 0.3, 20), left: 10 }),
  },
  pentagon: {
    path: (w, h) => {
      const pts: Vec[] = []
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
        pts.push({ x: (Math.cos(a) * w) / 2, y: (Math.sin(a) * h) / 2 })
      }
      return poly(pts)
    },
    outline: (w, h) => {
      const pts: Vec[] = []
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
        pts.push({ x: (Math.cos(a) * w) / 2, y: (Math.sin(a) * h) / 2 })
      }
      return pts
    },
    inset: (w, h) => ({ top: h * 0.26, right: w * 0.2, bottom: h * 0.18, left: w * 0.2 }),
  },
  arrowShape: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const head = Math.min(w * 0.3, 40)
      const body = hh * 0.5
      return poly([
        { x: -hw, y: -body }, { x: hw - head, y: -body }, { x: hw - head, y: -hh },
        { x: hw, y: 0 }, { x: hw - head, y: hh }, { x: hw - head, y: body }, { x: -hw, y: body },
      ])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const head = Math.min(w * 0.3, 40)
      const body = hh * 0.5
      return [
        { x: -hw, y: -body }, { x: hw - head, y: -body }, { x: hw - head, y: -hh },
        { x: hw, y: 0 }, { x: hw - head, y: hh }, { x: hw - head, y: body }, { x: -hw, y: body },
      ]
    },
    inset: w => ({ top: 6, right: Math.min(w * 0.34, 44), bottom: 6, left: 10 }),
  },
  cross: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const t = Math.min(w, h) * 0.28
      return poly([
        { x: -t, y: -hh }, { x: t, y: -hh }, { x: t, y: -t }, { x: hw, y: -t },
        { x: hw, y: t }, { x: t, y: t }, { x: t, y: hh }, { x: -t, y: hh },
        { x: -t, y: t }, { x: -hw, y: t }, { x: -hw, y: -t }, { x: -t, y: -t },
      ])
    },
    outline: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const t = Math.min(w, h) * 0.28
      return [
        { x: -t, y: -hh }, { x: t, y: -hh }, { x: t, y: -t }, { x: hw, y: -t },
        { x: hw, y: t }, { x: t, y: t }, { x: t, y: hh }, { x: -t, y: hh },
        { x: -t, y: t }, { x: -hw, y: t }, { x: -hw, y: -t }, { x: -t, y: -t },
      ]
    },
    inset: (w, h) => uniform(Math.min(w, h) * 0.3),
  },
  person: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const headR = Math.min(w, h) * 0.18
      const headCy = -hh + headR
      return [
        `M${round(-headR)},${round(headCy)}`,
        `a${round(headR)},${round(headR)} 0 1 0 ${round(headR * 2)},0`,
        `a${round(headR)},${round(headR)} 0 1 0 ${round(-headR * 2)},0 Z`,
        `M0,${round(headCy + headR)} V${round(hh * 0.3)}`,
        `M${round(-hw * 0.55)},${round(headCy + headR * 1.6)} H${round(hw * 0.55)}`,
        `M0,${round(hh * 0.3)} L${round(-hw * 0.45)},${round(hh)}`,
        `M0,${round(hh * 0.3)} L${round(hw * 0.45)},${round(hh)}`,
      ].join(' ')
    },
    outline: rectOutline,
    inset: () => uniform(6),
    labelBelow: true,
  },
  database: {
    path: (w, h) => SHAPES.cylinder.path(w, h, 0),
    decor: (w, h) => SHAPES.cylinder.decor!(w, h),
    outline: rectOutline,
    inset: (_w, h) => ({ top: Math.min(h * 0.32, 26), right: 10, bottom: 10, left: 10 }),
  },
  display: {
    path: (w, h) => {
      const hw = w / 2
      const hh = h / 2
      const d = Math.min(w * 0.16, 26)
      return [
        `M${round(-hw + d)},${round(-hh)}`,
        `H${round(hw - d)}`,
        `q${round(d * 1.6)},${round(hh)} 0,${round(h)}`,
        `H${round(-hw + d)}`,
        `q${round(-d * 1.2)},${round(-hh)} ${round(-d)},${round(-hh)}`,
        `q${round(0)},${round(0)} ${round(d)},${round(-hh)}`,
        'Z',
      ].join(' ')
    },
    outline: rectOutline,
    inset: w => ({ top: 10, right: Math.min(w * 0.18, 28), bottom: 10, left: Math.min(w * 0.18, 28) }),
  },
}

/** 도형 경계와 "중심 → 바깥점" 광선의 교점. 엣지 끝을 도형에 붙일 때 쓴다. */
export function boundaryPoint(
  shape: ShapeKind,
  cx: number,
  cy: number,
  w: number,
  h: number,
  toward: Vec,
  radius = 0,
): Vec {
  const def = SHAPES[shape] ?? SHAPES.rect
  const pts = def.outline(w, h, radius)
  const dx = toward.x - cx
  const dy = toward.y - cy
  const len = Math.hypot(dx, dy)
  if (len < 0.0001) return { x: cx, y: cy }
  // 도형을 확실히 벗어나는 지점까지 광선을 쏜다
  const far = { x: dx / len * 10000, y: dy / len * 10000 }
  let best: Vec | null = null
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const hit = segIntersect({ x: 0, y: 0 }, far, a, b)
    if (hit) {
      const d = Math.hypot(hit.x, hit.y)
      if (d < bestD) {
        bestD = d
        best = hit
      }
    }
  }
  if (!best) return { x: cx, y: cy }
  return { x: cx + best.x, y: cy + best.y }
}

function segIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): Vec | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-9) return null
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
}

/** 텍스트가 들어갈 수 있는 도형 내부 영역 (도형 중심 기준) */
export function labelBox(shape: ShapeKind, w: number, h: number, padding = 0) {
  const def = SHAPES[shape] ?? SHAPES.rect
  if (def.labelBelow) {
    return { x: -w / 2, y: h / 2 + 4, w, h: 20 }
  }
  const ins = def.inset(w, h)
  const p = padding
  return {
    x: -w / 2 + ins.left + p,
    y: -h / 2 + ins.top + p,
    w: Math.max(8, w - ins.left - ins.right - p * 2),
    h: Math.max(8, h - ins.top - ins.bottom - p * 2),
  }
}

export const SHAPE_GROUPS: { title: string; shapes: ShapeKind[] }[] = [
  { title: '기본', shapes: ['rect', 'round', 'stadium', 'circle', 'ellipse', 'diamond', 'hexagon'] },
  { title: '흐름도', shapes: ['parallelogram', 'parallelogramAlt', 'trapezoid', 'trapezoidAlt', 'subroutine', 'asymmetric', 'document', 'display'] },
  { title: '데이터', shapes: ['cylinder', 'database', 'doublecircle', 'note'] },
  { title: '자유', shapes: ['triangle', 'triangleDown', 'pentagon', 'star', 'cloud', 'arrowShape', 'cross', 'person', 'text'] },
]
