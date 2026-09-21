/**
 * Obsidian 노트 열기.
 *
 * 저장만 되고 다시 못 여는 연동은 반쪽이다. vault 에 있는 노트를 목록으로 보여주고,
 *  - 다이아그래머가 만든 노트라면 숨겨 둔 편집 상태까지 그대로 복원하고
 *  - 남이 쓴 일반 mermaid 노트라면 코드만 읽어 새 문서로 연다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, FileCode2, FileText, RefreshCw, Search, X } from 'lucide-react'
import { ApiError, api, type VaultNote } from '../../core/api'
import { extractDocAsync, extractMermaid } from '../../core/obsidian'
import { useStore } from '../../store/useStore'
import { relativeTime } from './LibraryPanel'

type Status = 'loading' | 'ready' | 'empty' | 'offline' | 'error'

export function VaultPanel() {
  const [notes, setNotes] = useState<VaultNote[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [errorText, setErrorText] = useState('')
  const [query, setQuery] = useState('')
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const close = () => useStore.getState().setUI({ vaultOpen: false })

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await api.notes()
      setNotes(res.notes)
      setDir(res.dir)
      setStatus(res.notes.length ? 'ready' : 'empty')
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setStatus('offline')
      } else {
        setStatus('error')
        setErrorText(e instanceof Error ? e.message : String(e))
      }
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? notes.filter(n => n.name.toLowerCase().includes(q) || n.rel.toLowerCase().includes(q)) : notes
  }, [notes, query])

  const open = async (note: VaultNote) => {
    const st = useStore.getState()
    if (st.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 그래도 다른 문서를 열까요?')) return
    setBusy(note.rel)
    try {
      const { text } = await api.noteRead(note.rel)

      // 1) 다이아그래머가 숨겨 둔 편집 상태가 있으면 그대로 복원한다
      const doc = await extractDocAsync(text)
      if (doc) {
        st.setDoc({ ...doc, savedTo: { ...(doc.savedTo ?? {}), note: note.rel } }, { resetHistory: true })
        useStore.setState({ codeText: doc.code ?? '', codePending: false, codeIssue: null, warnings: [] })
        st.markSaved({ note: note.rel })
        st.toast('success', `${note.name} 을(를) 열었습니다.`)
        close()
        return
      }

      // 2) 일반 노트면 mermaid 코드블록만 읽어 새 문서로 연다
      const code = extractMermaid(text)
      if (!code) {
        st.toast('warn', '이 노트에서 mermaid 코드를 찾지 못했습니다.')
        return
      }
      await st.newDoc(code, note.name)
      st.toast('success', `${note.name} 의 mermaid 코드를 불러왔습니다.`)
      close()
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 0
        ? '파일 서버가 꺼져 있습니다.'
        : e instanceof Error ? e.message : String(e)
      useStore.getState().toast('error', '열지 못했습니다: ' + msg)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.key === 'Escape' && close()}>
        <div className="modal-head">
          <BookOpen size={16} />
          <h3>Obsidian 노트 열기</h3>
          {status === 'ready' && <span className="badge">{filtered.length}건</span>}
          <div className="spacer" />
          <button className="btn icon ghost" onClick={() => void load()} title="다시 불러오기">
            <RefreshCw size={14} />
          </button>
          <button className="btn icon ghost" onClick={close} title="닫기 (Esc)">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="lib-toolbar">
            <div className="lib-search">
              <Search size={13} />
              <input
                className="field"
                value={query}
                autoFocus
                placeholder="노트 이름으로 찾기"
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>

          {status === 'loading' && <p className="muted" style={{ padding: 20, textAlign: 'center' }}>불러오는 중…</p>}

          {status === 'offline' && (
            <p className="lib-empty">
              파일 서버가 꺼져 있어 vault 를 읽을 수 없습니다.<br />
              터미널에서 <span className="mono">npm run dev</span> 를 실행하세요.
            </p>
          )}

          {status === 'error' && <p className="lib-empty">불러오지 못했습니다.<br /><span className="muted">{errorText}</span></p>}

          {status === 'empty' && (
            <p className="lib-empty">
              이 폴더에 다이어그램 노트가 없습니다.<br />
              <span className="muted mono">{dir}</span><br />
              <span className="muted">⇧⌘S 로 저장하면 여기에 쌓입니다. 폴더는 설정에서 바꿀 수 있습니다.</span>
            </p>
          )}

          {status === 'ready' && (
            <div className="vault-list">
              {filtered.map(n => (
                <button
                  key={n.rel}
                  className="vault-row"
                  onClick={() => void open(n)}
                  disabled={busy === n.rel}
                  title={n.rel}
                >
                  <span className={'vault-kind ' + n.kind}>
                    {n.kind === 'diagrammer' ? <FileText size={14} /> : <FileCode2 size={14} />}
                  </span>
                  <span className="vault-name">{n.name}</span>
                  <span className="vault-path mono">{n.rel}</span>
                  <span className="vault-meta muted">
                    {n.kind === 'diagrammer' ? '편집 상태 포함' : 'mermaid 코드만'} · {relativeTime(n.modified)}
                  </span>
                </button>
              ))}
              {!filtered.length && <p className="lib-empty">검색 결과가 없습니다.</p>}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted mono" style={{ fontSize: 11 }}>{dir}</span>
          <div className="spacer" />
          <button className="btn" onClick={close}>닫기</button>
        </div>
      </div>
    </div>
  )
}
