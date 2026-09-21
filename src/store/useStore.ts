/**
 * 앱 상태.
 *
 * 되돌리기 모델: 스냅샷 방식. 다이어그램 규모(수백 요소)에서는 패치 방식보다 단순하고 안전하다.
 * 커밋 시점은 상호작용 경계에서만 잡는다(beginInteraction/endInteraction).
 * 드래그 중 60fps 로 스냅샷을 쌓으면 되돌리기가 쓸모없어진다.
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  Anchor, EdgeElement, EdgeStyle, GroupElement, ID, MarkerKind, NodeElement,
  NodeStyle, SceneDoc, SceneElement, ShapeKind, TextElement, Tool, Vec, Viewport,
} from '../core/types'
import { DEFAULT_NODE_SIZE, GRID_SIZE, emptyDoc, isBox } from '../core/types'
import { getTheme } from '../core/theme'
import { importMermaid } from '../core/mermaid/importer'
import { LAYOUT_PREFIX, sceneToMermaid } from '../core/mermaid/emitter'
import type { ParseIssue } from '../core/mermaid/engine'
import { boxRect, elementBounds, measureText, sceneBounds, snapToGrid, unionRects } from '../core/geometry'

const HISTORY_LIMIT = 120

interface Snapshot {
  elements: Record<ID, SceneElement>
  order: ID[]
  code: string
  direction: SceneDoc['direction']
  themeId: string
  title: string
  background?: string
  freeEdits: boolean
  sourceOfTruth: SceneDoc['sourceOfTruth']
  selection: ID[]
}

function snapshot(s: Store): Snapshot {
  return {
    elements: structuredClone(s.doc.elements),
    order: [...s.doc.order],
    code: s.doc.code,
    direction: s.doc.direction,
    themeId: s.doc.themeId,
    title: s.doc.title,
    background: s.doc.background,
    freeEdits: s.doc.freeEdits,
    sourceOfTruth: s.doc.sourceOfTruth,
    selection: [...s.selection],
  }
}

function restore(doc: SceneDoc, snap: Snapshot): SceneDoc {
  return {
    ...doc,
    elements: structuredClone(snap.elements),
    order: [...snap.order],
    code: snap.code,
    direction: snap.direction,
    themeId: snap.themeId,
    title: snap.title,
    background: snap.background,
    freeEdits: snap.freeEdits,
    sourceOfTruth: snap.sourceOfTruth,
    modified: Date.now(),
  }
}

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error' | 'warn'
  text: string
  action?: { label: string; run: () => void }
}

export interface UIState {
  showCode: boolean
  showGrid: boolean
  snapEnabled: boolean
  showMinimap: boolean
  codeWidth: number
  inspectorOpen: boolean
  libraryOpen: boolean
  vaultOpen: boolean
  templatesOpen: boolean
  settingsOpen: boolean
  helpOpen: boolean
  exportOpen: boolean
  paletteOpen: boolean
}

export interface Store {
  doc: SceneDoc
  viewport: Viewport
  selection: ID[]
  hoverId: ID | null
  tool: Tool
  editing: { id: ID; caret?: number } | null
  codeText: string
  codeIssue: ParseIssue | null
  /** 코드 편집 내용이 아직 캔버스에 반영되지 않음 */
  codePending: boolean
  importing: boolean
  warnings: string[]
  past: Snapshot[]
  future: Snapshot[]
  ui: UIState
  toasts: Toast[]
  dirty: boolean
  /** 마지막 저장 시각 */
  savedAt: number | null
  /** 스타일 복사(서식 복사) 버퍼 */
  styleClipboard: Partial<NodeStyle> | null

  // ── 히스토리 ──
  commit: () => void
  undo: () => void
  redo: () => void
  beginInteraction: () => void
  /**
   * kind='geometry' 면 코드 본문을 다시 만들지 않고 배치 주석 한 줄만 갱신한다.
   * 드래그할 때마다 코드를 통째로 재생성하면 사용자가 손으로 쓴 들여쓰기·주석·줄 순서가 사라진다.
   */
  endInteraction: (kind?: 'geometry' | 'structure') => void

  // ── 문서 ──
  setDoc: (doc: SceneDoc, opts?: { resetHistory?: boolean }) => void
  newDoc: (code?: string, title?: string) => Promise<void>
  setTitle: (title: string) => void
  setTheme: (themeId: string) => void
  setDirection: (dir: SceneDoc['direction']) => void
  markSaved: (where?: SceneDoc['savedTo']) => void

  // ── 코드 ──
  setCodeText: (text: string) => void
  applyCode: (opts?: { relayout?: boolean }) => Promise<void>
  syncCodeFromScene: () => void
  /** 코드 본문은 그대로 두고 `%% dgr:layout:v1` 줄만 현재 배치로 바꾼다 */
  syncLayoutComment: () => void
  relayout: () => Promise<void>

  // ── 뷰포트 ──
  setViewport: (v: Partial<Viewport>) => void
  zoomAt: (factor: number, screenPoint: Vec, rect: DOMRect) => void
  setZoom: (zoom: number, rect?: DOMRect) => void
  fitToScreen: (rect: DOMRect, ids?: ID[]) => void
  resetView: (rect: DOMRect) => void

  // ── 선택 ──
  select: (ids: ID[], mode?: 'replace' | 'add' | 'toggle') => void
  selectAll: () => void
  clearSelection: () => void
  setHover: (id: ID | null) => void
  setTool: (tool: Tool) => void
  setEditing: (e: Store['editing']) => void

  // ── 편집 ──
  addNode: (at: Vec, partial?: Partial<NodeElement>) => ID
  addText: (at: Vec, text?: string) => ID
  addEdge: (source: ID, target: ID, partial?: Partial<EdgeElement>) => ID | null
  updateElement: (id: ID, patch: Partial<SceneElement>) => void
  updateElements: (ids: ID[], fn: (el: SceneElement) => Partial<SceneElement> | null) => void
  moveBy: (ids: ID[], dx: number, dy: number) => void
  deleteElements: (ids: ID[]) => void
  duplicate: (ids: ID[]) => ID[]
  setNodeStyle: (ids: ID[], patch: Partial<NodeStyle>) => void
  setEdgeStyle: (ids: ID[], patch: Partial<EdgeStyle>) => void
  setShape: (ids: ID[], shape: ShapeKind) => void
  setText: (id: ID, text: string) => void
  autoSizeNode: (id: ID) => void
  align: (ids: ID[], how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void
  distribute: (ids: ID[], axis: 'h' | 'v') => void
  matchSize: (ids: ID[], how: 'w' | 'h' | 'both') => void
  reorder: (ids: ID[], how: 'front' | 'back' | 'forward' | 'backward') => void
  groupSelection: (ids: ID[]) => ID | null
  ungroup: (ids: ID[]) => void
  copyStyle: (id: ID) => void
  pasteStyle: (ids: ID[]) => void
  setEdgeRouting: (ids: ID[], routing: EdgeElement['routing']) => void
  setEdgeMarker: (ids: ID[], which: 'start' | 'end', marker: MarkerKind) => void
  setAnchor: (id: ID, which: 'source' | 'target', anchor: Anchor) => void

  // ── UI ──
  setUI: (patch: Partial<UIState>) => void
  toast: (kind: Toast['kind'], text: string, action?: Toast['action']) => void
  dismissToast: (id: string) => void
  setWarnings: (w: string[]) => void
}

let interactionDepth = 0
let docAtBegin: SceneDoc | null = null
let futureAtBegin: Snapshot[] = []
let dirtyAtBegin = false

const r1 = (n: number) => Math.round(n * 10) / 10

export const useStore = create<Store>((set, get) => ({
  doc: emptyDoc(),
  viewport: { x: 0, y: 0, zoom: 1 },
  selection: [],
  hoverId: null,
  tool: 'select',
  editing: null,
  codeText: '',
  codeIssue: null,
  codePending: false,
  importing: false,
  warnings: [],
  past: [],
  future: [],
  toasts: [],
  dirty: false,
  savedAt: null,
  styleClipboard: null,
  ui: {
    showCode: true,
    showGrid: true,
    snapEnabled: true,
    showMinimap: true,
    codeWidth: 400,
    inspectorOpen: true,
    libraryOpen: false,
    vaultOpen: false,
    templatesOpen: false,
    settingsOpen: false,
    helpOpen: false,
    exportOpen: false,
    paletteOpen: false,
  },

  // ── 히스토리 ────────────────────────────────────────────────────
  commit: () => {
    // 상호작용(begin~end) 안에서는 이미 경계에서 한 번 커밋했다.
    // 여기서 또 쌓으면 'Tab 으로 노드+연결선 만들기' 같은 한 동작이 ⌘Z 세 번을 요구하게 된다.
    if (interactionDepth > 0) return
    const s = get()
    const past = [...s.past, snapshot(s)].slice(-HISTORY_LIMIT)
    set({ past, future: [], dirty: true })
  },

  undo: () => {
    const s = get()
    if (!s.past.length) return
    const prev = s.past[s.past.length - 1]
    set({
      past: s.past.slice(0, -1),
      future: [...s.future, snapshot(s)].slice(-HISTORY_LIMIT),
      doc: restore(s.doc, prev),
      selection: prev.selection.filter(id => prev.elements[id]),
      editing: null,
      dirty: true,
      // 스냅샷에 코드 원문이 들어 있다. 여기서 재생성하면 사용자가 손으로 쓴
      // 들여쓰기·주석·줄 순서가 되돌리기로도 돌아오지 않는다.
      codeText: prev.code,
      codePending: false,
      codeIssue: null,
    })
  },

  redo: () => {
    const s = get()
    if (!s.future.length) return
    const next = s.future[s.future.length - 1]
    set({
      future: s.future.slice(0, -1),
      past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
      doc: restore(s.doc, next),
      selection: next.selection.filter(id => next.elements[id]),
      editing: null,
      dirty: true,
      codeText: next.code,
      codePending: false,
      codeIssue: null,
    })
  },

  beginInteraction: () => {
    if (interactionDepth === 0) {
      const before = get()
      // commit() 은 future 를 비우고 dirty 를 켠다. 아무것도 바뀌지 않았을 때
      // 그 둘까지 되돌려야 '클릭만 했는데 다시실행이 죽는' 일이 없다.
      futureAtBegin = before.future
      dirtyAtBegin = before.dirty
      before.commit()
      docAtBegin = get().doc
    }
    interactionDepth++
  },

  endInteraction: kind => {
    interactionDepth = Math.max(0, interactionDepth - 1)
    if (interactionDepth !== 0) return
    const s = get()
    // 아무것도 바뀌지 않았으면(예: 클릭만 하고 끝) 히스토리와 코드를 건드리지 않는다.
    // doc 은 변경 시 항상 새 객체가 되므로 참조 비교로 충분하다.
    if (docAtBegin && s.doc === docAtBegin) {
      set({ past: s.past.slice(0, -1), future: futureAtBegin, dirty: dirtyAtBegin })
      docAtBegin = null
      futureAtBegin = []
      return
    }
    docAtBegin = null
    if (kind === 'geometry') s.syncLayoutComment()
    else s.syncCodeFromScene()
  },

  // ── 문서 ────────────────────────────────────────────────────────
  setDoc: (doc, opts) => {
    set({
      doc,
      ...(opts?.resetHistory ? { past: [], future: [], dirty: false } : {}),
      selection: get().selection.filter(id => doc.elements[id]),
    })
  },

  newDoc: async (code, title) => {
    const template = code ?? DEFAULT_TEMPLATE
    set({ importing: true })
    const res = await importMermaid(template, { themeId: get().doc.themeId, title: title ?? '무제 다이어그램' })
    if (res.ok) {
      set({
        doc: { ...res.doc, id: nanoid(10) },
        codeText: template,
        codeIssue: null,
        codePending: false,
        past: [],
        future: [],
        selection: [],
        dirty: false,
        savedAt: null,
        importing: false,
        warnings: res.warnings,
      })
    } else {
      set({ importing: false, codeIssue: res.issue })
    }
  },

  setTitle: title => {
    get().commit()
    set(s => ({ doc: { ...s.doc, title, modified: Date.now() }, dirty: true }))
  },

  setTheme: themeId => {
    const s = get()
    s.commit()
    const theme = getTheme(themeId)
    const elements: Record<ID, SceneElement> = {}
    for (const [id, el] of Object.entries(s.doc.elements)) {
      // 테마 + 코드에서 온 스타일 + 사용자 오버라이드 순으로 다시 쌓는다.
      // codeStyle 을 빼먹으면 `style A fill:#f00` 같은 코드 지정 색이 테마 전환에 지워지고,
      // 다음 동기화에서 코드 자체에서도 사라진다.
      if (el.kind === 'node' || el.kind === 'text') {
        elements[id] = { ...el, style: { ...theme.node, ...(el.codeStyle ?? {}), ...(el.over ?? {}) } }
      } else if (el.kind === 'group') {
        elements[id] = { ...el, style: { ...theme.group, ...(el.codeStyle ?? {}), ...(el.over ?? {}) } }
      } else if (el.kind === 'edge') {
        elements[id] = { ...el, style: { ...theme.edge, ...(el.codeStyle ?? {}), ...(el.over ?? {}) } }
      } else {
        elements[id] = el
      }
    }
    set({ doc: { ...s.doc, themeId, elements, background: undefined, modified: Date.now() }, dirty: true })
  },

  setDirection: dir => {
    const s = get()
    s.commit()
    set({ doc: { ...s.doc, direction: dir, modified: Date.now() }, dirty: true })
    void get().relayout()
  },

  markSaved: where => {
    set(s => ({
      savedAt: Date.now(),
      dirty: false,
      doc: { ...s.doc, savedTo: { ...(s.doc.savedTo ?? {}), ...(where ?? {}) } },
    }))
  },

  // ── 코드 ────────────────────────────────────────────────────────
  setCodeText: text => set({ codeText: text, codePending: text !== get().doc.code }),

  applyCode: async opts => {
    const s = get()
    const text = s.codeText
    if (!text.trim()) {
      set({ codeIssue: null, codePending: false })
      return
    }
    set({ importing: true })
    const res = await importMermaid(text, {
      themeId: s.doc.themeId,
      prev: s.doc,
      title: s.doc.title,
      preservePositions: !opts?.relayout,
    })
    if (!res.ok) {
      // 실패 경로는 히스토리를 건드리지 않는다. 캔버스도 마지막 성공 상태 그대로 남는다.
      set({ importing: false, codeIssue: res.issue })
      return
    }
    /**
     * 코드 적용도 되돌릴 수 있어야 한다.
     * 코드창은 타이핑 후 자동으로 applyCode 를 부르므로, 여기서 스냅샷을 남기지 않으면
     * '코드에서 노드를 지웠는데 ⌘Z 로 못 되살리는' 상태가 된다.
     * doc 은 항상 새 객체로 교체되므로, await 전에 잡아 둔 s 는 여전히 '적용 전' 문서다.
     */
    const changed = res.doc.code !== s.doc.code || !!opts?.relayout
    const snap = changed ? snapshot(s) : null
    set(st => ({
      doc: { ...res.doc, id: s.doc.id, savedTo: s.doc.savedTo },
      ...(snap ? { past: [...st.past, snap].slice(-HISTORY_LIMIT), future: [] } : {}),
      codeIssue: null,
      codePending: false,
      importing: false,
      warnings: res.warnings,
      dirty: true,
      selection: s.selection.filter(id => res.doc.elements[id]),
    }))
  },

  syncCodeFromScene: () => {
    const s = get()
    if (!s.doc.editable) return
    const { code, warnings, midOf } = sceneToMermaid(s.doc, { includeLayout: true, includeStyles: true })

    // 이번에 배정된 mermaid id 를 요소에 새겨 둔다. 그래야 라벨을 고쳐도 id 가 그대로 남는다.
    let elements = s.doc.elements
    let touched = false
    for (const [elId, mid] of midOf) {
      const el = elements[elId]
      if (!el || (el.kind !== 'node' && el.kind !== 'group')) continue
      // 그룹의 mid 는 importer 가 'sg:' 접두사로 관리한다. 규약을 맞추지 않으면
      // 재파싱에서 짝을 잃고, 자유 편집으로 만든 그룹이 '유령 subgraph' 로 매번 늘어난다.
      const next = el.kind === 'group' ? 'sg:' + mid : mid
      if (el.mid === next) continue
      if (!touched) {
        elements = { ...elements }
        touched = true
      }
      elements[elId] = { ...el, mid: next }
    }

    set({
      doc: { ...s.doc, elements, code, modified: Date.now() },
      codeText: code,
      codePending: false,
      codeIssue: null,
      warnings,
      dirty: true,
    })
  },

  syncLayoutComment: () => {
    const s = get()
    if (!s.doc.editable) return
    const layout: Record<string, [number, number, number, number]> = {}
    for (const el of Object.values(s.doc.elements)) {
      if (el.kind !== 'node' || !el.pinned || !el.mid) continue
      layout[el.mid] = [r1(el.x), r1(el.y), r1(el.w), r1(el.h)]
    }
    const body = s.doc.code
      .replace(new RegExp('^' + LAYOUT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'gm'), '')
      .trimEnd()
    const code = Object.keys(layout).length
      ? `${body}\n\n${LAYOUT_PREFIX} ${JSON.stringify(layout)}\n`
      : body + '\n'
    set({
      doc: { ...s.doc, code, modified: Date.now() },
      codeText: code,
      codePending: false,
      dirty: true,
    })
  },

  relayout: async () => {
    const s = get()
    if (!s.doc.editable) return
    s.commit()
    const unpinned = unpinAll(s.doc.elements)
    const { code, midOf } = sceneToMermaid({ ...s.doc, elements: unpinned }, { includeLayout: false })
    // 이번에 배정된 mid 를 prev 에 찍어 두지 않으면, 아직 mid 가 없는 요소가
    // 재파싱에서 짝을 잃고 그대로 복제된다(그룹 유령의 또 다른 경로).
    const stamped = stampMids(unpinned, midOf)
    set({ importing: true })
    const res = await importMermaid(code, {
      themeId: s.doc.themeId,
      prev: { ...s.doc, elements: stamped },
      title: s.doc.title,
      preservePositions: false,
    })
    set({ importing: false })
    if (res.ok) {
      set({ doc: { ...res.doc, id: s.doc.id, savedTo: s.doc.savedTo }, codeText: res.doc.code, dirty: true })
      get().toast('success', '자동 정렬했습니다.')
    } else {
      get().toast('error', '정렬 실패: ' + res.issue.message)
    }
  },

  // ── 뷰포트 ──────────────────────────────────────────────────────
  setViewport: v => set(s => ({ viewport: { ...s.viewport, ...v } })),

  zoomAt: (factor, screenPoint, rect) => {
    const { viewport } = get()
    const zoom = clampZoom(viewport.zoom * factor)
    if (zoom === viewport.zoom) return
    // 커서 아래의 월드 좌표가 제자리에 남도록 원점을 보정한다
    const px = screenPoint.x - rect.left
    const py = screenPoint.y - rect.top
    const wx = (px - viewport.x) / viewport.zoom
    const wy = (py - viewport.y) / viewport.zoom
    set({ viewport: { zoom, x: px - wx * zoom, y: py - wy * zoom } })
  },

  setZoom: (zoom, rect) => {
    const v = get().viewport
    const z = clampZoom(zoom)
    if (!rect) {
      set({ viewport: { ...v, zoom: z } })
      return
    }
    const cx = rect.width / 2
    const cy = rect.height / 2
    const wx = (cx - v.x) / v.zoom
    const wy = (cy - v.y) / v.zoom
    set({ viewport: { zoom: z, x: cx - wx * z, y: cy - wy * z } })
  },

  fitToScreen: (rect, ids) => {
    // 화면 영역이 아직 잡히지 않았으면(패널 전환 중, 첫 레이아웃 전) 손대지 않는다.
    // 0 을 그대로 쓰면 (0 - 여백)/폭 이 음수가 되고, 클램프가 이를 최소 배율로 만들어
    // 사용자는 "다이어그램이 사라졌다"를 보게 된다.
    if (!(rect.width > 80 && rect.height > 80)) return

    const s = get()
    const b = sceneBounds(s.doc, ids)
    if (!b || !(b.w > 0) || !(b.h > 0)) {
      set({ viewport: { x: rect.width / 2, y: rect.height / 2, zoom: 1 } })
      return
    }
    const pad = 64
    const raw = Math.min((rect.width - pad * 2) / b.w, (rect.height - pad * 2) / b.h, 2)
    if (!Number.isFinite(raw) || raw <= 0) return
    const zoom = clampZoom(raw)
    set({
      viewport: {
        zoom,
        x: rect.width / 2 - (b.x + b.w / 2) * zoom,
        y: rect.height / 2 - (b.y + b.h / 2) * zoom,
      },
    })
  },

  resetView: rect => {
    if (!(rect.width > 0 && rect.height > 0)) return
    set({ viewport: { x: rect.width / 2, y: rect.height / 2, zoom: 1 } })
  },

  // ── 선택 ────────────────────────────────────────────────────────
  select: (ids, mode = 'replace') => {
    const cur = get().selection
    let next: ID[]
    if (mode === 'add') next = Array.from(new Set([...cur, ...ids]))
    else if (mode === 'toggle') {
      const set0 = new Set(cur)
      for (const id of ids) (set0.has(id) ? set0.delete(id) : set0.add(id))
      next = Array.from(set0)
    } else next = [...ids]
    set({ selection: next })
  },

  selectAll: () => set(s => ({ selection: s.doc.order.filter(id => !s.doc.elements[id]?.locked) })),
  clearSelection: () => set({ selection: [], editing: null }),
  setHover: id => set({ hoverId: id }),
  // 도구를 '바꿀' 때만 글자 편집을 끝낸다. 같은 도구로 되돌리는 호출(연결선 → 선택)이
  // 방금 연 인라인 편집기를 닫아버리면 새 노드에 글자를 못 넣는다.
  setTool: tool => set(s => (s.tool === tool ? { tool } : { tool, editing: null })),
  setEditing: e => set({ editing: e }),

  // ── 편집 ────────────────────────────────────────────────────────
  addNode: (at, partial) => {
    const s = get()
    s.commit()
    const theme = getTheme(s.doc.themeId)
    const id = nanoid(10)
    const node: NodeElement = {
      id,
      kind: 'node',
      shape: partial?.shape ?? 'rect',
      x: at.x,
      y: at.y,
      w: partial?.w ?? DEFAULT_NODE_SIZE.w,
      h: partial?.h ?? DEFAULT_NODE_SIZE.h,
      text: partial?.text ?? '',
      style: { ...theme.node, ...(partial?.style ?? {}) },
      over: partial?.over,
      pinned: true,
      ...partial,
    }
    set({
      doc: { ...s.doc, elements: { ...s.doc.elements, [id]: node }, order: [...s.doc.order, id], modified: Date.now() },
      selection: [id],
      dirty: true,
    })
    get().syncCodeFromScene()
    return id
  },

  addText: (at, text) => {
    const s = get()
    s.commit()
    const theme = getTheme(s.doc.themeId)
    const id = nanoid(10)
    const el: TextElement = {
      id,
      kind: 'text',
      x: at.x,
      y: at.y,
      w: 160,
      h: 32,
      text: text ?? '',
      style: { ...theme.node, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, align: 'left' },
    }
    set({
      doc: {
        ...s.doc,
        elements: { ...s.doc.elements, [id]: el },
        order: [...s.doc.order, id],
        freeEdits: true,
        modified: Date.now(),
      },
      selection: [id],
      dirty: true,
    })
    return id
  },

  addEdge: (source, target, partial) => {
    const s = get()
    if (source === target) return null
    if (!isBox(s.doc.elements[source]) || !isBox(s.doc.elements[target])) return null
    const dup = Object.values(s.doc.elements).find(
      e => e.kind === 'edge' && e.source === source && e.target === target,
    )
    if (dup) return dup.id
    s.commit()
    const theme = getTheme(s.doc.themeId)
    const id = nanoid(10)
    const edge: EdgeElement = {
      id,
      kind: 'edge',
      source,
      target,
      sourceAnchor: 'auto',
      targetAnchor: 'auto',
      label: '',
      routing: 'straight',
      style: { ...theme.edge },
      startMarker: 'none',
      endMarker: 'arrow',
      ...partial,
    }
    set({
      doc: { ...s.doc, elements: { ...s.doc.elements, [id]: edge }, order: [...s.doc.order, id], modified: Date.now() },
      selection: [id],
      dirty: true,
    })
    get().syncCodeFromScene()
    return id
  },

  updateElement: (id, patch) => {
    set(s => {
      const el = s.doc.elements[id]
      if (!el) return s
      return {
        doc: {
          ...s.doc,
          elements: { ...s.doc.elements, [id]: { ...el, ...patch } as SceneElement },
          modified: Date.now(),
        },
        dirty: true,
      }
    })
  },

  updateElements: (ids, fn) => {
    set(s => {
      const elements = { ...s.doc.elements }
      let changed = false
      for (const id of ids) {
        const el = elements[id]
        if (!el) continue
        const patch = fn(el)
        if (!patch) continue
        elements[id] = { ...el, ...patch } as SceneElement
        changed = true
      }
      if (!changed) return s
      return { doc: { ...s.doc, elements, modified: Date.now() }, dirty: true }
    })
  },

  moveBy: (ids, dx, dy) => {
    if (!dx && !dy) return
    set(s => {
      const elements = { ...s.doc.elements }
      const targets = new Set(ids)
      /**
       * 그룹을 옮기면 자식도 함께 간다. 중첩 그룹이 있으므로 **끝까지** 내려가야 한다.
       * 한 단계만 훑으면 그룹 안의 그룹에 든 노드가 제자리에 남는다.
       */
      for (let changed = true; changed;) {
        changed = false
        for (const el of Object.values(elements)) {
          if (el.parent && targets.has(el.parent) && !targets.has(el.id)) {
            targets.add(el.id)
            changed = true
          }
        }
      }
      for (const id of targets) {
        const el = elements[id]
        if (!el || el.locked) continue
        if (isBox(el)) {
          elements[id] = { ...el, x: el.x + dx, y: el.y + dy, ...(el.kind === 'node' ? { pinned: true } : {}) } as SceneElement
        } else if (el.kind === 'freedraw') {
          elements[id] = { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        }
      }
      /**
       * 양 끝이 모두 함께 움직인 연결선의 사용자 경유점도 같이 옮긴다.
       * 위 루프는 targets(= 박스들)만 돌기 때문에, 엣지는 여기서 따로 봐야 한다.
       * (그룹을 끌었을 때 그룹 안 연결선이 비틀리는 원인이었다)
       */
      for (const el of Object.values(elements)) {
        if (el.kind !== 'edge' || !el.waypoints?.length) continue
        if (!targets.has(el.source) || !targets.has(el.target)) continue
        elements[el.id] = { ...el, waypoints: el.waypoints.map(p => ({ x: p.x + dx, y: p.y + dy })) }
      }
      // 노드가 움직였으면 mermaid 배치에서 온 경유점은 버린다 (연결선이 노드를 따라가야 한다)
      for (const el of Object.values(elements)) {
        if (el.kind === 'edge' && el.autoWaypoints && (targets.has(el.source) || targets.has(el.target))) {
          elements[el.id] = { ...el, waypoints: undefined, autoWaypoints: false, routing: 'orthogonal' }
        }
      }
      return { doc: { ...s.doc, elements, modified: Date.now() }, dirty: true }
    })
  },

  deleteElements: ids => {
    const s = get()
    if (!ids.length) return
    s.commit()
    const kill = new Set(ids)
    // 그룹 삭제 시 자식은 살리되 소속만 푼다
    for (const id of ids) {
      if (s.doc.elements[id]?.kind === 'group') {
        for (const el of Object.values(s.doc.elements)) {
          if (el.parent === id) kill.add('__unparent__' + el.id)
        }
      }
    }
    const elements: Record<ID, SceneElement> = {}
    for (const [id, el] of Object.entries(s.doc.elements)) {
      if (kill.has(id)) continue
      // 끊어진 엣지도 제거
      if (el.kind === 'edge' && (kill.has(el.source) || kill.has(el.target))) continue
      elements[id] = kill.has('__unparent__' + id) ? { ...el, parent: undefined } : el
    }
    set({
      doc: { ...s.doc, elements, order: s.doc.order.filter(id => elements[id]), modified: Date.now() },
      selection: [],
      editing: null,
      dirty: true,
    })
    get().syncCodeFromScene()
  },

  duplicate: ids => {
    const s = get()
    if (!ids.length) return []
    s.commit()
    const OFFSET = 24
    const map = new Map<ID, ID>()
    const elements = { ...s.doc.elements }
    const order = [...s.doc.order]
    const created: ID[] = []

    for (const id of ids) {
      const el = s.doc.elements[id]
      if (!el || el.kind === 'edge') continue
      const nid = nanoid(10)
      map.set(id, nid)
      const copy = structuredClone(el) as SceneElement
      copy.id = nid
      copy.mid = undefined
      if (isBox(copy)) {
        copy.x += OFFSET
        copy.y += OFFSET
        if (copy.kind === 'node') copy.pinned = true
      } else if (copy.kind === 'freedraw') {
        copy.points = copy.points.map(p => ({ x: p.x + OFFSET, y: p.y + OFFSET }))
      }
      elements[nid] = copy
      order.push(nid)
      created.push(nid)
    }
    // 양 끝이 모두 복제된 엣지만 함께 복제한다
    for (const id of ids) {
      const el = s.doc.elements[id]
      if (!el || el.kind !== 'edge') continue
      const ns = map.get(el.source)
      const nt = map.get(el.target)
      if (!ns || !nt) continue
      const nid = nanoid(10)
      const copy = structuredClone(el)
      copy.id = nid
      copy.mid = undefined
      copy.source = ns
      copy.target = nt
      if (copy.waypoints) copy.waypoints = copy.waypoints.map(p => ({ x: p.x + OFFSET, y: p.y + OFFSET }))
      elements[nid] = copy
      order.push(nid)
      created.push(nid)
    }
    // 부모 관계도 복제본끼리 잇는다
    for (const nid of created) {
      const el = elements[nid]
      if (el.parent && map.has(el.parent)) elements[nid] = { ...el, parent: map.get(el.parent) }
    }

    set({ doc: { ...s.doc, elements, order, modified: Date.now() }, selection: created, dirty: true })
    get().syncCodeFromScene()
    return created
  },

  setNodeStyle: (ids, patch) => {
    const s = get()
    s.commit()
    s.updateElements(ids, el => {
      if (el.kind === 'edge' || el.kind === 'freedraw' || el.kind === 'image') return null
      return { style: { ...el.style, ...patch }, over: { ...(el.over ?? {}), ...patch } }
    })
    get().syncCodeFromScene()
  },

  setEdgeStyle: (ids, patch) => {
    const s = get()
    s.commit()
    s.updateElements(ids, el => {
      if (el.kind !== 'edge' && el.kind !== 'freedraw') return null
      return { style: { ...el.style, ...patch }, ...(el.kind === 'edge' ? { over: { ...(el.over ?? {}), ...patch } } : {}) }
    })
    get().syncCodeFromScene()
  },

  setShape: (ids, shape) => {
    const s = get()
    s.commit()
    s.updateElements(ids, el => (el.kind === 'node' ? { shape } : null))
    get().syncCodeFromScene()
  },

  setText: (id, text) => {
    const s = get()
    const el = s.doc.elements[id]
    if (!el) return
    if (el.kind === 'group') s.updateElement(id, { title: text } as Partial<SceneElement>)
    else if (el.kind === 'edge') s.updateElement(id, { label: text } as Partial<SceneElement>)
    else s.updateElement(id, { text } as Partial<SceneElement>)
  },

  autoSizeNode: id => {
    const s = get()
    const el = s.doc.elements[id]
    if (!el || (el.kind !== 'node' && el.kind !== 'text')) return
    const m = measureText(el.text || ' ', el.style.fontSize, el.style.fontWeight)
    const shape = el.kind === 'node' ? el.shape : 'rect'
    const wide = shape === 'diamond' || shape === 'circle' || shape === 'doublecircle' || shape === 'star'
    const padX = wide ? 56 : 32
    const padY = wide ? 40 : 22
    const w = Math.max(60, Math.ceil(m.w + padX))
    const h = Math.max(36, Math.ceil(m.h + padY))
    s.updateElement(id, { w: Math.max(el.w, w), h: Math.max(el.h, h) } as Partial<SceneElement>)
  },

  align: (ids, how) => {
    const s = get()
    const boxes = ids.map(id => s.doc.elements[id]).filter(isBox)
    if (boxes.length < 2) return
    s.commit()
    const rects = boxes.map(boxRect)
    const u = unionRects(rects)!
    s.updateElements(boxes.map(b => b.id), el => {
      if (!isBox(el)) return null
      switch (how) {
        case 'left': return { x: u.x + el.w / 2, pinned: true }
        case 'right': return { x: u.x + u.w - el.w / 2, pinned: true }
        case 'hcenter': return { x: u.x + u.w / 2, pinned: true }
        case 'top': return { y: u.y + el.h / 2, pinned: true }
        case 'bottom': return { y: u.y + u.h - el.h / 2, pinned: true }
        case 'vcenter': return { y: u.y + u.h / 2, pinned: true }
        default: return null
      }
    })
    get().syncCodeFromScene()
  },

  distribute: (ids, axis) => {
    const s = get()
    const boxes = ids.map(id => s.doc.elements[id]).filter(isBox)
    if (boxes.length < 3) return
    s.commit()
    const sorted = [...boxes].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const span = axis === 'h' ? last.x - first.x : last.y - first.y
    const step = span / (sorted.length - 1)
    sorted.forEach((el, i) => {
      if (i === 0 || i === sorted.length - 1) return
      const v = (axis === 'h' ? first.x : first.y) + step * i
      s.updateElement(el.id, (axis === 'h' ? { x: v, pinned: true } : { y: v, pinned: true }) as Partial<SceneElement>)
    })
    get().syncCodeFromScene()
  },

  matchSize: (ids, how) => {
    const s = get()
    const boxes = ids.map(id => s.doc.elements[id]).filter(isBox)
    if (boxes.length < 2) return
    s.commit()
    const w = Math.max(...boxes.map(b => b.w))
    const h = Math.max(...boxes.map(b => b.h))
    s.updateElements(boxes.map(b => b.id), el => {
      if (!isBox(el)) return null
      return {
        ...(how === 'w' || how === 'both' ? { w } : {}),
        ...(how === 'h' || how === 'both' ? { h } : {}),
        pinned: true,
      }
    })
    // 크기는 배치 주석에 실린다. 여기서 반영하지 않으면 다음 코드 적용에 원복된다.
    get().syncLayoutComment()
  },

  reorder: (ids, how) => {
    const s = get()
    if (!ids.length) return
    s.commit()
    const sel = new Set(ids)
    const rest = s.doc.order.filter(id => !sel.has(id))
    const picked = s.doc.order.filter(id => sel.has(id))
    let order: ID[]
    if (how === 'front') order = [...rest, ...picked]
    else if (how === 'back') order = [...picked, ...rest]
    else {
      order = [...s.doc.order]
      const idxs = picked.map(id => order.indexOf(id))
      if (how === 'forward') {
        for (let i = idxs.length - 1; i >= 0; i--) {
          const at = order.indexOf(picked[i])
          if (at < order.length - 1) {
            ;[order[at], order[at + 1]] = [order[at + 1], order[at]]
          }
        }
      } else {
        for (let i = 0; i < idxs.length; i++) {
          const at = order.indexOf(picked[i])
          if (at > 0) {
            ;[order[at], order[at - 1]] = [order[at - 1], order[at]]
          }
        }
      }
    }
    set({ doc: { ...s.doc, order, modified: Date.now() }, dirty: true })
  },

  groupSelection: ids => {
    const s = get()
    const boxes = ids.map(id => s.doc.elements[id]).filter(isBox)
    if (!boxes.length) return null
    s.commit()
    const u = unionRects(boxes.map(boxRect))!
    const pad = 28
    const id = nanoid(10)
    const theme = getTheme(s.doc.themeId)
    const group: GroupElement = {
      id,
      kind: 'group',
      x: u.x + u.w / 2,
      y: u.y + u.h / 2 + 8,
      w: u.w + pad * 2,
      h: u.h + pad * 2 + 16,
      title: '그룹',
      style: { ...theme.group },
      pinned: true,
    }
    const elements = { ...s.doc.elements, [id]: group }
    for (const b of boxes) elements[b.id] = { ...elements[b.id], parent: id } as SceneElement
    set({
      doc: { ...s.doc, elements, order: [id, ...s.doc.order], modified: Date.now() },
      selection: [id],
      dirty: true,
    })
    get().syncCodeFromScene()
    return id
  },

  ungroup: ids => {
    const s = get()
    const groups = ids.filter(id => s.doc.elements[id]?.kind === 'group')
    if (!groups.length) return
    s.commit()
    const gset = new Set(groups)
    const elements: Record<ID, SceneElement> = {}
    for (const [id, el] of Object.entries(s.doc.elements)) {
      if (gset.has(id)) continue
      elements[id] = el.parent && gset.has(el.parent) ? { ...el, parent: undefined } : el
    }
    set({
      doc: { ...s.doc, elements, order: s.doc.order.filter(id => elements[id]), modified: Date.now() },
      selection: [],
      dirty: true,
    })
    get().syncCodeFromScene()
  },

  copyStyle: id => {
    const el = get().doc.elements[id]
    if (!el || el.kind === 'edge' || el.kind === 'freedraw' || el.kind === 'image') return
    set({ styleClipboard: { ...el.style } })
    get().toast('success', '서식을 복사했습니다.')
  },

  pasteStyle: ids => {
    const clip = get().styleClipboard
    if (!clip) return
    get().setNodeStyle(ids, clip)
  },

  setEdgeRouting: (ids, routing) => {
    const s = get()
    s.commit()
    s.updateElements(ids, el =>
      el.kind === 'edge'
        ? { routing, ...(routing !== 'custom' ? { waypoints: undefined, autoWaypoints: false } : {}) }
        : null,
    )
    // 라우팅은 mermaid 코드로 표현되지 않는다. 문서에만 남지만, 저장 대상이므로 dirty 는 켜 둔다.
    set({ dirty: true })
  },

  setEdgeMarker: (ids, which, marker) => {
    const s = get()
    s.commit()
    s.updateElements(ids, el =>
      el.kind === 'edge' ? (which === 'start' ? { startMarker: marker } : { endMarker: marker }) : null,
    )
    get().syncCodeFromScene()
  },

  setAnchor: (id, which, anchor) => {
    const s = get()
    s.commit()
    s.updateElement(id, (which === 'source' ? { sourceAnchor: anchor } : { targetAnchor: anchor }) as Partial<SceneElement>)
    set({ dirty: true })
  },

  // ── UI ──────────────────────────────────────────────────────────
  setUI: patch => set(s => ({ ui: { ...s.ui, ...patch } })),

  toast: (kind, text, action) => {
    const id = nanoid(6)
    set(s => ({ toasts: [...s.toasts, { id, kind, text, action }] }))
    if (kind !== 'error') {
      setTimeout(() => get().dismissToast(id), 3600)
    }
  },

  dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  setWarnings: w => set({ warnings: w }),
}))

/** sceneToMermaid 가 배정한 mermaid id 를 요소에 새긴다 (그룹은 'sg:' 접두사 규약) */
function stampMids(elements: Record<ID, SceneElement>, midOf: Map<string, string>): Record<ID, SceneElement> {
  const out = { ...elements }
  for (const [elId, mid] of midOf) {
    const el = out[elId]
    if (!el || (el.kind !== 'node' && el.kind !== 'group')) continue
    const next = el.kind === 'group' ? 'sg:' + mid : mid
    if (el.mid !== next) out[elId] = { ...el, mid: next }
  }
  return out
}

function unpinAll(elements: Record<ID, SceneElement>): Record<ID, SceneElement> {
  const out: Record<ID, SceneElement> = {}
  for (const [id, el] of Object.entries(elements)) {
    out[id] = el.kind === 'node' || el.kind === 'group' ? { ...el, pinned: false } : el
  }
  return out
}

export function clampZoom(z: number): number {
  return Math.min(8, Math.max(0.05, z))
}

export function screenToWorld(p: Vec, v: Viewport, rect: DOMRect): Vec {
  return { x: (p.x - rect.left - v.x) / v.zoom, y: (p.y - rect.top - v.y) / v.zoom }
}

export function worldToScreen(p: Vec, v: Viewport): Vec {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y }
}

export function maybeSnap(v: number, enabled: boolean): number {
  return enabled ? snapToGrid(v, GRID_SIZE) : v
}

export const DEFAULT_TEMPLATE = `flowchart TD
    A[아이디어] --> B{검토}
    B -->|채택| C[설계]
    B -->|보류| D[(백로그)]
    C --> E[구현]
    E --> F((완료))
`
