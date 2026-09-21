/**
 * 템플릿 고르기.
 *
 * 빈 화면에서 "flowchart TD" 를 처음부터 쳐야 하는 앱은 처음 쓰는 사람을 돌려보낸다.
 * 고를 것을 먼저 보여주고, 미리보기로 무엇이 나올지 알려준다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutTemplate, X } from 'lucide-react'
import { TEMPLATES, templatesByCategory, type Template } from '../../core/templates'
import { renderMermaid } from '../../core/mermaid/engine'
import { useStore } from '../../store/useStore'

export function TemplatePanel() {
  const [selected, setSelected] = useState<Template>(TEMPLATES[1])
  const [preview, setPreview] = useState<string>('')
  const [failed, setFailed] = useState(false)
  const groups = useMemo(() => templatesByCategory(), [])
  const seq = useRef(0)

  const close = () => useStore.getState().setUI({ templatesOpen: false })

  useEffect(() => {
    const my = ++seq.current
    setFailed(false)
    setPreview('')
    renderMermaid(selected.code)
      .then(r => {
        if (seq.current !== my) return
        // 미리보기는 컨테이너에 맞춰 늘린다
        setPreview(r.svg.replace(/<svg /, '<svg style="max-width:100%;max-height:100%;height:auto" '))
      })
      .catch(() => seq.current === my && setFailed(true))
  }, [selected])

  const start = (t: Template) => {
    const st = useStore.getState()
    const go = () => {
      void st.newDoc(t.code, t.id === 'blank' ? '무제 다이어그램' : t.name)
      close()
    }
    if (st.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 새로 시작할까요?')) return
    go()
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === 'Escape' && close()}>
        <div className="modal-head">
          <LayoutTemplate size={16} />
          <h3>무엇을 그릴까요?</h3>
          <div className="spacer" />
          <button className="btn icon ghost" onClick={close} title="닫기 (Esc)"><X size={15} /></button>
        </div>

        <div className="modal-body tpl-body">
          <div className="tpl-list">
            {groups.map(g => (
              <div key={g.category} className="tpl-group">
                <div className="tpl-group-title">{g.category}</div>
                {g.items.map(t => (
                  <button
                    key={t.id}
                    className={'tpl-item' + (selected.id === t.id ? ' active' : '')}
                    onMouseEnter={() => setSelected(t)}
                    onFocus={() => setSelected(t)}
                    onClick={() => start(t)}
                    title={t.desc}
                  >
                    <strong>{t.name}</strong>
                    <span>{t.desc}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="tpl-preview">
            <div className="tpl-canvas">
              {failed ? (
                <span className="muted">미리보기를 만들지 못했습니다.</span>
              ) : preview ? (
                <div dangerouslySetInnerHTML={{ __html: preview }} />
              ) : (
                <span className="muted">그리는 중…</span>
              )}
            </div>
            <pre className="tpl-code">{selected.code.trim()}</pre>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted">항목을 클릭하면 바로 시작합니다.</span>
          <div className="spacer" />
          <button className="btn" onClick={close}>취소</button>
          <button className="btn primary" onClick={() => start(selected)}>
            {selected.name} 으로 시작
          </button>
        </div>
      </div>
    </div>
  )
}
