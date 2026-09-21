/**
 * 앱 셸 — 레이아웃, 단축키, 자동 저장.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from './ui/Canvas'
import { TopBar } from './ui/TopBar'
import { Toolbar } from './ui/Toolbar'
import { CodePane } from './ui/CodePane'
import { Inspector } from './ui/Inspector'
import { Minimap } from './ui/Minimap'
import { Toasts } from './ui/Toasts'
import { ExportDialog } from './ui/panels/ExportDialog'
import { LibraryPanel } from './ui/panels/LibraryPanel'
import { VaultPanel } from './ui/panels/VaultPanel'
import { TemplatePanel } from './ui/panels/TemplatePanel'
import { SettingsPanel } from './ui/panels/SettingsPanel'
import { HelpPanel } from './ui/panels/HelpPanel'
import { CommandPalette } from './ui/panels/CommandPalette'
import { useStore } from './store/useStore'
import { DEFAULT_TEMPLATE } from './store/useStore'
import { isBox } from './core/types'
import type { SceneElement } from './core/types'
import { api, ping } from './core/api'
import { sanitizeLoadedDoc } from './core/obsidian'
import { nanoid } from 'nanoid'

const AUTOSAVE_KEY = 'diagrammer:autosave'
const AUTOSAVE_DELAY = 1200

export default function App() {
  const ui = useStore(s => s.ui)
  const doc = useStore(s => s.doc)
  const dirty = useStore(s => s.dirty)
  const [booted, setBooted] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  // ── 부팅: 자동 저장본 복구 또는 기본 템플릿 ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ping()
      const st = useStore.getState()
      const saved = localStorage.getItem(AUTOSAVE_KEY)
      if (saved) {
        try {
          const doc = sanitizeLoadedDoc(JSON.parse(saved)?.doc)
          const hasElements = doc ? Object.keys(doc.elements).length > 0 : false
          const hasCode = !!doc?.code?.trim()
          /**
           * 복구 조건을 '요소 개수' 로만 두면 안 된다.
           * 시퀀스·간트 같은 뷰어 전용 문서는 elements 가 비어 있고 그림이 nativeSvg 에만 있는데,
           * nativeSvg 는 저장하지 않는다. 그래서 코드만 남은 저장본을 버리면
           * 새로고침 한 번에 작업이 사라지고, 1.2초 뒤 자동저장이 기본 템플릿으로 덮어써 복구 불가가 된다.
           */
          if (doc && (hasElements || hasCode)) {
            if (cancelled) return
            st.setDoc(doc, { resetHistory: true })
            useStore.setState({ codeText: doc.code ?? '', codePending: false, codeIssue: null })

            let ok = true
            if (!doc.editable || !hasElements) {
              // 그림을 코드로 다시 그린다 (nativeSvg 는 저장되지 않으므로)
              await st.applyCode()
              const after = useStore.getState()
              ok = !after.codeIssue && (!!after.doc.nativeSvg || Object.keys(after.doc.elements).length > 0)
              // 복구는 '편집' 이 아니다. applyCode 가 켠 dirty 를 되돌린다.
              useStore.setState({ dirty: false, savedAt: null, past: [], future: [] })
            }
            if (cancelled) return

            if (ok) {
              st.toast('info', '이전 작업을 복구했습니다.', {
                label: '새로 시작',
                run: () => {
                  localStorage.removeItem(AUTOSAVE_KEY)
                  void st.newDoc(DEFAULT_TEMPLATE)
                },
              })
            } else {
              st.toast('warn', '이전 작업을 다시 그리지 못했습니다. 코드는 그대로 두었으니 확인해 주세요.')
            }
            setBooted(true)
            return // 성공이든 실패든 저장본을 기본 템플릿으로 덮지 않는다
          }
        } catch { /* 손상된 자동저장만 아래로 */ }
      }
      if (cancelled) return
      await st.newDoc(DEFAULT_TEMPLATE)
      setBooted(true)
    })()
    return () => { cancelled = true }
  }, [])

  // ── 자동 저장 (브라우저 로컬) ──
  useEffect(() => {
    if (!booted) return
    const t = setTimeout(() => {
      try {
        const cur = useStore.getState().doc
        // 손도 대지 않은 기본 템플릿으로 기존 저장본을 덮지 않는다(2차 방어).
        const untouchedDefault =
          !useStore.getState().dirty && cur.code.trim() === DEFAULT_TEMPLATE.trim()
        if (untouchedDefault && localStorage.getItem(AUTOSAVE_KEY)) return
        const { nativeSvg, ...rest } = cur
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ doc: rest, at: Date.now() }))
      } catch { /* 용량 초과 시 조용히 포기 */ }
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(t)
  }, [doc, booted])

  // ── 탭 닫기 경고 ──
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!useStore.getState().dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useKeyboardShortcuts(stageRef)
  useClipboard()

  return (
    <div className="app" data-theme={ui.showCode ? 'code' : 'plain'}>
      <TopBar />
      <div className="app-body">
        {ui.showCode && <CodePane />}
        <div className="stage" ref={stageRef}>
          <Canvas />
          <Toolbar />
          {ui.showMinimap && <Minimap />}
        </div>
        {ui.inspectorOpen && <Inspector />}
      </div>
      <Toasts />
      {ui.exportOpen && <ExportDialog />}
      {ui.libraryOpen && <LibraryPanel />}
      {ui.vaultOpen && <VaultPanel />}
      {ui.templatesOpen && <TemplatePanel />}
      {ui.settingsOpen && <SettingsPanel />}
      {ui.helpOpen && <HelpPanel />}
      {ui.paletteOpen && <CommandPalette />}
      {!booted && <div className="boot-veil">다이아그래머 준비 중…</div>}
    </div>
  )
}

// ── 단축키 ──────────────────────────────────────────────────────────
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || !!el.closest?.('.cm-editor')
}

/**
 * 한글 조합 중에는 낱자 단축키를 먹지 않는다.
 * 조합 중 keydown 은 keyCode 229 / key 'Process' 로 들어오고, 이때 'ㄱ' 을 치면
 * 방어하지 않은 앱은 g 단축키를 실행해버린다.
 *
 * 다만 ⌘/Ctrl 이 눌린 조합은 예외다. IME 입력에는 수식키가 쓰이지 않으므로,
 * 여기까지 막으면 한글을 입력하는 동안 ⌘S·⌘E 같은 기본 동작이 전부 죽는다.
 */
function shouldIgnoreKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey) return false
  if (e.key === 'Escape') return false
  return e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Unidentified'
}

function useKeyboardShortcuts(stageRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e)) return
      const st = useStore.getState()
      const typing = isTypingTarget(e.target)
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      const lower = key.length === 1 ? key.toLowerCase() : key
      const rect = () => stageRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 900, 700)

      // 어디서든 동작하는 것
      if (mod && lower === 'k') {
        e.preventDefault()
        st.setUI({ paletteOpen: !st.ui.paletteOpen })
        return
      }
      if (key === 'Escape') {
        if (st.ui.paletteOpen || st.ui.exportOpen || st.ui.libraryOpen || st.ui.vaultOpen ||
            st.ui.templatesOpen || st.ui.settingsOpen || st.ui.helpOpen) {
          st.setUI({
            paletteOpen: false, exportOpen: false, libraryOpen: false, vaultOpen: false,
            templatesOpen: false, settingsOpen: false, helpOpen: false,
          })
          return
        }
        if (!typing) {
          st.clearSelection()
          st.setTool('select')
        }
        return
      }
      if (mod && lower === 's') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent(e.shiftKey ? 'dgm:save-obsidian' : 'dgm:save-library'))
        return
      }
      if (mod && lower === 'e') {
        e.preventDefault()
        st.setUI({ exportOpen: true })
        return
      }
      if (mod && lower === 'o') {
        e.preventDefault()
        st.setUI({ libraryOpen: true })
        return
      }
      if (mod && lower === 'n') {
        e.preventDefault()
        st.setUI({ templatesOpen: true })
        return
      }
      if (mod && lower === ',') {
        e.preventDefault()
        st.setUI({ settingsOpen: true })
        return
      }
      if (key === '?' || (e.shiftKey && lower === '/')) {
        if (!typing) {
          e.preventDefault()
          st.setUI({ helpOpen: true })
        }
        return
      }
      if (mod && lower === 'b') {
        e.preventDefault()
        st.setUI({ showCode: !st.ui.showCode })
        return
      }

      // 코드 편집 중에는 캔버스 단축키를 막는다
      if (typing) {
        if (mod && key === 'Enter') {
          e.preventDefault()
          void st.applyCode()
        }
        return
      }

      // 되돌리기
      if (mod && lower === 'z') {
        e.preventDefault()
        e.shiftKey ? st.redo() : st.undo()
        return
      }
      if (mod && lower === 'y') {
        e.preventDefault()
        st.redo()
        return
      }

      // 선택
      if (mod && lower === 'a') {
        e.preventDefault()
        st.selectAll()
        return
      }
      if (mod && lower === 'd') {
        e.preventDefault()
        st.duplicate(st.selection)
        return
      }
      if (mod && lower === 'g') {
        e.preventDefault()
        e.shiftKey ? st.ungroup(st.selection) : st.groupSelection(st.selection)
        return
      }

      // 정렬/순서
      if (mod && key === ']') {
        e.preventDefault()
        st.reorder(st.selection, e.shiftKey ? 'front' : 'forward')
        return
      }
      if (mod && key === '[') {
        e.preventDefault()
        st.reorder(st.selection, e.shiftKey ? 'back' : 'backward')
        return
      }

      // 줌
      if (mod && (key === '0')) {
        e.preventDefault()
        st.setZoom(1, rect())
        return
      }
      if (mod && (key === '1')) {
        e.preventDefault()
        st.fitToScreen(rect())
        return
      }
      if (mod && (key === '2')) {
        e.preventDefault()
        st.fitToScreen(rect(), st.selection.length ? st.selection : undefined)
        return
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault()
        st.setZoom(st.viewport.zoom * 1.2, rect())
        return
      }
      if (mod && key === '-') {
        e.preventDefault()
        st.setZoom(st.viewport.zoom / 1.2, rect())
        return
      }

      // 삭제
      if (key === 'Delete' || key === 'Backspace') {
        if (st.selection.length) {
          e.preventDefault()
          st.deleteElements(st.selection)
        }
        return
      }

      // 편집 진입
      if (key === 'Enter' || key === 'F2') {
        if (st.selection.length === 1) {
          e.preventDefault()
          st.setEditing({ id: st.selection[0] })
        }
        return
      }
      // Tab — 선택한 노드에서 오른쪽으로 새 노드를 만들어 잇는다
      if (key === 'Tab' && st.selection.length === 1) {
        const el = st.doc.elements[st.selection[0]]
        if (isBox(el)) {
          e.preventDefault()
          // 노드 생성과 연결선 생성이 각각 커밋을 쌓으면 ⌘Z 를 세 번 눌러야 원상복구된다.
          st.beginInteraction()
          const nid = st.addNode({ x: el.x + el.w + 90, y: el.y }, { shape: el.kind === 'node' ? el.shape : 'rect' })
          st.addEdge(el.id, nid)
          st.endInteraction()
          st.select([nid])
          st.setEditing({ id: nid })
        }
        return
      }

      // 화살표 이동
      if (key.startsWith('Arrow') && st.selection.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
        st.beginInteraction()
        st.moveBy(st.selection, dx, dy)
        st.endInteraction('geometry')
        return
      }

      // 도구
      if (!mod) {
        const tools: Record<string, string> = { v: 'select', h: 'pan', n: 'node', r: 'node', e: 'edge', t: 'text', p: 'freedraw' }
        if (tools[lower]) {
          e.preventDefault()
          st.setTool(tools[lower] as never)
          return
        }
        if (lower === 'f') {
          e.preventDefault()
          st.fitToScreen(rect())
          return
        }
        if (lower === 'l') {
          e.preventDefault()
          void st.relayout()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stageRef])
}

// ── 복사/붙여넣기 ───────────────────────────────────────────────────
const CLIP_MIME = 'application/x-diagrammer'

function useClipboard() {
  const cut = useCallback((remove: boolean) => {
    const st = useStore.getState()
    if (!st.selection.length) return null
    const picked: Record<string, SceneElement> = {}
    for (const id of st.selection) {
      const el = st.doc.elements[id]
      if (el) picked[id] = el
    }
    // 선택 안에 양 끝이 모두 있는 엣지도 함께
    for (const el of Object.values(st.doc.elements)) {
      if (el.kind === 'edge' && picked[el.source] && picked[el.target]) picked[el.id] = el
    }
    const payload = JSON.stringify({ [CLIP_MIME]: true, elements: picked, order: st.doc.order.filter(id => picked[id]) })
    if (remove) st.deleteElements(st.selection)
    return payload
  }, [])

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const payload = cut(false)
      if (!payload) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', payload)
    }
    const onCut = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const payload = cut(true)
      if (!payload) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', payload)
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      const st = useStore.getState()

      // 1) 다이아그래머 요소
      try {
        const parsed = JSON.parse(text)
        if (parsed?.[CLIP_MIME]) {
          e.preventDefault()
          st.commit()
          const map = new Map<string, string>()
          const elements = { ...st.doc.elements }
          const order = [...st.doc.order]
          const created: string[] = []
          const OFF = 28
          for (const [oldId, el] of Object.entries(parsed.elements as Record<string, SceneElement>)) {
            if (el.kind === 'edge') continue
            const nid = nanoid(10)
            map.set(oldId, nid)
            const copy = structuredClone(el)
            copy.id = nid
            copy.mid = undefined
            if (isBox(copy)) {
              copy.x += OFF
              copy.y += OFF
              if (copy.kind === 'node') copy.pinned = true
            } else if (copy.kind === 'freedraw') {
              copy.points = copy.points.map(p => ({ x: p.x + OFF, y: p.y + OFF }))
            }
            elements[nid] = copy
            order.push(nid)
            created.push(nid)
          }
          for (const el of Object.values(parsed.elements as Record<string, SceneElement>)) {
            if (el.kind !== 'edge') continue
            const s = map.get(el.source)
            const t = map.get(el.target)
            if (!s || !t) continue
            const nid = nanoid(10)
            const copy = structuredClone(el)
            copy.id = nid
            copy.mid = undefined
            copy.source = s
            copy.target = t
            // 경유점도 같이 옮겨야 복제본이 원본 쪽으로 끌려가지 않는다
            if (copy.waypoints) copy.waypoints = copy.waypoints.map(p => ({ x: p.x + OFF, y: p.y + OFF }))
            elements[nid] = copy
            order.push(nid)
            created.push(nid)
          }
          for (const nid of created) {
            const el = elements[nid]
            if (el.parent && map.has(el.parent)) elements[nid] = { ...el, parent: map.get(el.parent) }
          }
          st.setDoc({ ...st.doc, elements, order })
          st.select(created)
          st.syncCodeFromScene()
          return
        }
      } catch { /* JSON 아님 — 아래로 */ }

      // 2) mermaid 코드를 붙여넣으면 그대로 불러온다
      if (/^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|journey|gitGraph|timeline|quadrantChart|xychart|block|architecture|sankey|requirement)/m.test(text)) {
        e.preventDefault()
        useStore.setState({ codeText: text })
        void st.applyCode({ relayout: true })
        st.toast('success', 'mermaid 코드를 불러왔습니다.')
        return
      }

      // 3) 일반 텍스트 → 텍스트 요소
      if (text.trim()) {
        e.preventDefault()
        const v = st.viewport
        const el = document.querySelector('.stage')?.getBoundingClientRect()
        const center = el
          ? { x: (el.width / 2 - v.x) / v.zoom, y: (el.height / 2 - v.y) / v.zoom }
          : { x: 0, y: 0 }
        const id = st.addText(center, text.trim().slice(0, 500))
        st.select([id])
      }
    }

    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  }, [cut])
}
