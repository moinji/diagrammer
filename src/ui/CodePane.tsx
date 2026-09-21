/**
 * 코드 패널.
 *
 * 코드와 캔버스는 양방향이지만, 한 번에 한 방향만 흐른다.
 *  - 사용자가 타이핑 → codePending=true → 디바운스 후 import → 캔버스 갱신
 *  - 캔버스 편집     → emitter 로 코드 재생성 → codeText 갱신 (codePending 은 false 이므로 import 안 함)
 * 이 규칙이 깨지면 무한 루프가 된다.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { mermaid as mermaidLang } from 'codemirror-lang-mermaid'
import { AlertCircle, Check, Play, TriangleAlert, WrapText } from 'lucide-react'
import { useStore } from '../store/useStore'
import { typeLabel } from '../core/mermaid/engine'

const DEBOUNCE = 420

const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#dfe4ee' },
    '.cm-content': { caretColor: '#4d9fff' },
    '.cm-cursor': { borderLeftColor: '#4d9fff' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(77,159,255,.22) !important' },
    '.cm-line': { padding: '0 10px' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  },
  { dark: true },
)

export function CodePane() {
  const codeText = useStore(s => s.codeText)
  const codeIssue = useStore(s => s.codeIssue)
  const codePending = useStore(s => s.codePending)
  const importing = useStore(s => s.importing)
  const warnings = useStore(s => s.warnings)
  const diagramType = useStore(s => s.doc.diagramType)
  const editable = useStore(s => s.doc.editable)
  const width = useStore(s => s.ui.codeWidth)
  const setUI = useStore(s => s.setUI)
  const timerRef = useRef<number | null>(null)

  const onChange = useCallback((value: string) => {
    useStore.getState().setCodeText(value)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      // 그 사이에 캔버스 편집이 코드를 다시 만들었으면 import 하지 않는다
      if (useStore.getState().codePending) void useStore.getState().applyCode()
    }, DEBOUNCE)
  }, [])

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  // 패널 너비 조절
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: PointerEvent) => {
      setUI({ codeWidth: Math.max(260, Math.min(760, startW + ev.clientX - startX)) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const extensions = useMemo(() => [mermaidLang(), darkTheme, EditorView.lineWrapping], [])

  return (
    <aside className="code-pane" style={{ width }}>
      <div className="pane-head">
        <span className="pane-title">mermaid 코드</span>
        <span className="badge">{typeLabel(diagramType)}</span>
        {!editable && <span className="badge warn" title="이 종류는 캔버스에서 직접 편집할 수 없습니다">보기 전용</span>}
        <div className="spacer" style={{ flex: 1 }} />
        {importing ? (
          <span className="muted" style={{ fontSize: 11 }}>그리는 중…</span>
        ) : codePending ? (
          <button
            className="btn sm primary"
            onClick={() => void useStore.getState().applyCode()}
            title="코드를 캔버스에 반영 (⌘Enter)"
          >
            <Play size={12} /> 반영
          </button>
        ) : codeIssue ? (
          <span style={{ fontSize: 11, color: 'var(--danger)' }}>오류</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} /> 반영됨
          </span>
        )}
      </div>

      <div className="cm-wrap">
        <CodeMirror
          value={codeText}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            autocompletion: false,
            bracketMatching: true,
            closeBrackets: true,
            highlightActiveLineGutter: true,
          }}
        />
      </div>

      {codeIssue && (
        <div className="code-error">
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <strong>
                {codeIssue.line ? `${codeIssue.line}번째 줄 문법 오류` : '문법 오류'}
              </strong>
              {codeIssue.hint && <span className="hint">💡 {codeIssue.hint}</span>}
              <pre>{codeIssue.message}</pre>
              <div className="hint">캔버스에는 마지막으로 성공한 그림이 그대로 남아 있습니다.</div>
            </div>
          </div>
        </div>
      )}

      {!codeIssue && warnings.length > 0 && (
        <div className="code-warnings">
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="pane-resizer" onPointerDown={onResizeStart} title="너비 조절" />
    </aside>
  )
}
