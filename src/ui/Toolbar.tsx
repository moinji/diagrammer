/**
 * 왼쪽 도구 막대.
 * 도구는 6개로 끝낸다. 도구가 많아지면 사용자는 아무것도 고르지 못한다.
 */
import React from 'react'
import {
  ArrowRight, Grid3x3, Hand, Magnet, Maximize, MousePointer2,
  Pencil, Redo2, Square, Type, Undo2, Wand2, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Tool } from '../core/types'

const TOOLS: { id: Tool; icon: React.ReactNode; label: string; key: string }[] = [
  { id: 'select', icon: <MousePointer2 size={16} />, label: '선택', key: 'V' },
  { id: 'pan', icon: <Hand size={16} />, label: '화면 이동', key: 'H' },
  { id: 'node', icon: <Square size={16} />, label: '도형 추가', key: 'N' },
  { id: 'edge', icon: <ArrowRight size={16} />, label: '연결선', key: 'E' },
  { id: 'text', icon: <Type size={16} />, label: '텍스트', key: 'T' },
  { id: 'freedraw', icon: <Pencil size={16} />, label: '자유 그리기', key: 'P' },
]

export function Toolbar() {
  const tool = useStore(s => s.tool)
  const setTool = useStore(s => s.setTool)
  const ui = useStore(s => s.ui)
  const setUI = useStore(s => s.setUI)
  const canUndo = useStore(s => s.past.length > 0)
  const canRedo = useStore(s => s.future.length > 0)
  const editable = useStore(s => s.doc.editable)

  const stageRect = () => document.querySelector('.stage')?.getBoundingClientRect() ?? new DOMRect(0, 0, 900, 700)

  return (
    <div className="toolbar">
      {TOOLS.map(t => (
        <button
          key={t.id}
          className={'tool-btn' + (tool === t.id ? ' active' : '')}
          onClick={() => setTool(t.id)}
          title={`${t.label} (${t.key})`}
          disabled={!editable && t.id !== 'select' && t.id !== 'pan'}
        >
          {t.icon}
        </button>
      ))}

      <div className="sep" />

      <button className="tool-btn" onClick={() => useStore.getState().undo()} disabled={!canUndo} title="되돌리기 (⌘Z)">
        <Undo2 size={16} />
      </button>
      <button className="tool-btn" onClick={() => useStore.getState().redo()} disabled={!canRedo} title="다시 실행 (⇧⌘Z)">
        <Redo2 size={16} />
      </button>

      <div className="sep" />

      <button className="tool-btn" onClick={() => useStore.getState().fitToScreen(stageRect())} title="화면 맞춤 (F)">
        <Maximize size={16} />
      </button>
      <button
        className="tool-btn"
        onClick={() => useStore.getState().setZoom(useStore.getState().viewport.zoom * 1.25, stageRect())}
        title="확대 (⌘+)"
      >
        <ZoomIn size={16} />
      </button>
      <button
        className="tool-btn"
        onClick={() => useStore.getState().setZoom(useStore.getState().viewport.zoom / 1.25, stageRect())}
        title="축소 (⌘−)"
      >
        <ZoomOut size={16} />
      </button>

      <div className="sep" />

      <button
        className={'tool-btn' + (ui.showGrid ? ' active' : '')}
        onClick={() => setUI({ showGrid: !ui.showGrid })}
        title="격자 표시"
      >
        <Grid3x3 size={16} />
      </button>
      <button
        className={'tool-btn' + (ui.snapEnabled ? ' active' : '')}
        onClick={() => setUI({ snapEnabled: !ui.snapEnabled })}
        title="스냅 (정렬 안내선)"
      >
        <Magnet size={16} />
      </button>
      <button
        className="tool-btn"
        onClick={() => void useStore.getState().relayout()}
        title="자동 정렬 — mermaid 레이아웃으로 다시 배치 (L)"
        disabled={!editable}
      >
        <Wand2 size={16} />
      </button>
    </div>
  )
}
