/**
 * 라이브러리 — 앱 자체 저장소(서버 data/library/*.json)에 저장한 다이어그램 목록.
 *
 * 저장 기능(saveToLibrary)도 이 파일에 둔다. App 은 ⌘S 에서 window 이벤트만 쏘고,
 * 실제 저장은 여기서 받는다. 패널이 열려 있지 않아도 저장이 되어야 하므로
 * 이벤트 등록은 컴포넌트가 아니라 모듈 로드 시점에 1회 한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes, CalendarRange, ChartPie, Database, FileText, GitBranch, MessageSquare,
  Network, Plus, RefreshCw, Search, ServerOff, Trash, Workflow, X,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { api, ApiError, type LibraryItem } from '../../core/api'
import { blobToBase64, buildPngBlob } from '../../core/export/exporter'
import { serializableDoc } from '../../core/obsidian'
import type { SceneDoc } from '../../core/types'
import { useStore } from '../../store/useStore'

const SAVE_EVENT = 'dgm:save-library'
const CHANGED_EVENT = 'dgm:library-changed'

/** 저장 문서에는 목록용 썸네일이 얹혀 있다(서버가 그대로 되돌려준다). */
type LibraryDoc = SceneDoc & { thumbnail?: string | null }

interface LibraryWindow extends Window {
  __dgmSaveLibraryHandler?: EventListener
}

// ── ⌘S 연결 (모듈 로드 시 1회, 재등록 시 이전 것을 먼저 떼어낸다) ──
if (typeof window !== 'undefined') {
  const w = window as LibraryWindow
  if (w.__dgmSaveLibraryHandler) window.removeEventListener(SAVE_EVENT, w.__dgmSaveLibraryHandler)
  const handler: EventListener = () => { void saveToLibrary() }
  w.__dgmSaveLibraryHandler = handler
  window.addEventListener(SAVE_EVENT, handler)
}

// ── 저장 ────────────────────────────────────────────────────────────
let saving = false

/**
 * 현재 문서를 라이브러리에 저장한다.
 * 썸네일은 부가 정보다. 만들지 못해도 저장 자체는 진행한다.
 */
export async function saveToLibrary(): Promise<void> {
  if (saving) return
  saving = true
  try {
    const st = useStore.getState()
    let doc = st.doc
    // emptyDoc 의 기본 id('doc')를 그대로 쓰면 모든 새 문서가 한 파일을 덮어쓴다
    if (!doc.id || doc.id === 'doc') {
      doc = { ...doc, id: nanoid(10) }
      st.setDoc(doc)
    }

    const payload: LibraryDoc = { ...serializableDoc(doc) }
    try {
      const blob = await buildPngBlob(doc, { scale: 0.5, padding: 12 })
      const b64 = await blobToBase64(blob)
      // 목록 JSON 이 비대해지지 않도록 과하게 큰 썸네일은 버린다
      if (b64.length <= 900_000) payload.thumbnail = 'data:image/png;base64,' + b64
    } catch {
      /* 썸네일 없이 저장 */
    }

    await api.librarySave(doc.id, payload)
    useStore.getState().markSaved({ library: doc.id })
    useStore.getState().toast('success', `'${doc.title || '무제 다이어그램'}' 을(를) 라이브러리에 저장했습니다.`)
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
  } catch (err) {
    useStore.getState().toast('error', '저장하지 못했습니다. ' + messageOf(err))
  } finally {
    saving = false
  }
}

// ── 패널 ────────────────────────────────────────────────────────────
type Status = 'loading' | 'ready' | 'offline' | 'error'

export function LibraryPanel() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [errorText, setErrorText] = useState('')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const alive = useRef(true)
  const searchRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => useStore.getState().setUI({ libraryOpen: false }), [])

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorText('')
    try {
      const res = await api.library()
      if (!alive.current) return
      setItems(res.items)
      setStatus('ready')
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiError && err.status === 0) {
        setStatus('offline')
      } else {
        setErrorText(messageOf(err))
        setStatus('error')
      }
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    const onChanged = () => { void load() }
    window.addEventListener(CHANGED_EVENT, onChanged)
    return () => {
      alive.current = false
      window.removeEventListener(CHANGED_EVENT, onChanged)
    }
  }, [load])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter(it => it.title.toLowerCase().includes(needle))
  }, [items, query])

  const confirmDiscard = (): boolean => {
    if (!useStore.getState().dirty) return true
    return window.confirm('저장하지 않은 변경이 있습니다. 계속할까요?')
  }

  const openItem = async (item: LibraryItem) => {
    if (busyId) return
    if (!confirmDiscard()) return
    setBusyId(item.id)
    try {
      const res = await api.libraryGet(item.id)
      const doc = toSceneDoc(res.doc)
      if (!doc) {
        useStore.getState().toast('error', '문서를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.')
        return
      }
      useStore.getState().setDoc(doc, { resetHistory: true })
      useStore.setState({ codeText: doc.code, codePending: false, codeIssue: null, warnings: [] })
      useStore.getState().toast('success', `'${doc.title || '무제 다이어그램'}' 을(를) 불러왔습니다.`)
      close()
    } catch (err) {
      useStore.getState().toast('error', '불러오지 못했습니다. ' + messageOf(err))
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  const removeItem = async (item: LibraryItem) => {
    if (busyId) return
    if (!window.confirm(`'${item.title}' 을(를) 라이브러리에서 삭제할까요?`)) return
    setBusyId(item.id)
    try {
      await api.libraryDelete(item.id)
      if (alive.current) setItems(prev => prev.filter(i => i.id !== item.id))
      useStore.getState().toast('success', `'${item.title}' 을(를) 삭제했습니다.`)
    } catch (err) {
      useStore.getState().toast('error', '삭제하지 못했습니다. ' + messageOf(err))
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  const createNew = () => {
    if (!confirmDiscard()) return
    useStore.getState().setUI({ libraryOpen: false, templatesOpen: true })
    close()
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal wide"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') close() }}
      >
        <div className="modal-head">
          <h3>라이브러리</h3>
          {status === 'ready' && items.length > 0 && <span className="badge">{items.length}개</span>}
          <div className="spacer" />
          <button className="btn sm" title="목록 다시 불러오기" onClick={() => void load()}>
            <RefreshCw size={13} />
            새로고침
          </button>
          <button className="btn sm primary" title="새 다이어그램 만들기" onClick={createNew}>
            <Plus size={13} />
            새 다이어그램
          </button>
          <button className="btn icon ghost" title="닫기 (Esc)" aria-label="닫기" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="lib-toolbar">
            <div className="lib-search">
              <Search size={13} />
              <input
                ref={searchRef}
                className="field"
                type="search"
                value={query}
                placeholder="제목으로 찾기"
                aria-label="제목으로 찾기"
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>

          {status === 'loading' && (
            <>
              <p className="muted">불러오는 중…</p>
              <div className="lib-grid">
                {[0, 1, 2, 3, 4, 5].map(i => <div className="lib-skel" key={i} />)}
              </div>
            </>
          )}

          {status === 'offline' && (
            <div className="lib-empty">
              <ServerOff size={26} />
              <div>파일 서버가 꺼져 있어 라이브러리를 쓸 수 없습니다.</div>
              <div className="muted">
                터미널에서 <span className="mono">npm run dev</span> 를 실행하세요.
              </div>
              <button className="btn sm" title="다시 시도" onClick={() => void load()}>다시 시도</button>
            </div>
          )}

          {status === 'error' && (
            <div className="lib-empty">
              <ServerOff size={26} />
              <div>목록을 불러오지 못했습니다.</div>
              <div className="muted">{errorText}</div>
              <button className="btn sm" title="다시 시도" onClick={() => void load()}>다시 시도</button>
            </div>
          )}

          {status === 'ready' && items.length === 0 && (
            <div className="lib-empty">
              <FileText size={26} />
              <div>아직 저장한 다이어그램이 없습니다.</div>
              <div className="muted"><span className="mono">⌘S</span> 로 저장해 보세요.</div>
            </div>
          )}

          {status === 'ready' && items.length > 0 && filtered.length === 0 && (
            <div className="lib-empty">
              <Search size={26} />
              <div>‘{query.trim()}’ 와(과) 일치하는 다이어그램이 없습니다.</div>
              <button className="btn sm" title="검색어 지우기" onClick={() => setQuery('')}>검색어 지우기</button>
            </div>
          )}

          {status === 'ready' && filtered.length > 0 && (
            <div className="lib-grid">
              {filtered.map(item => (
                <div className="lib-card" key={item.id}>
                  <button
                    className="lib-open"
                    title={`'${item.title}' 열기`}
                    disabled={busyId === item.id}
                    onClick={() => void openItem(item)}
                  >
                    <div className="thumb">
                      {item.thumbnail
                        ? <img src={item.thumbnail} alt="" />
                        : <span className="muted"><KindIcon type={item.diagramType} /></span>}
                    </div>
                    <div className="meta">
                      <strong>{item.title || '무제 다이어그램'}</strong>
                      <span>요소 {item.nodeCount}개 · {relativeTime(item.modified)}</span>
                    </div>
                  </button>
                  <button
                    className="btn icon sm danger lib-del"
                    title={`'${item.title}' 삭제`}
                    aria-label={`'${item.title}' 삭제`}
                    disabled={busyId === item.id}
                    onClick={() => void removeItem(item)}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted">
            카드를 누르면 불러옵니다. 저장은 <span className="mono">⌘S</span>.
          </span>
          <div className="spacer" />
          <button className="btn" title="닫기" onClick={close}>닫기</button>
        </div>
      </div>
    </div>
  )
}

// ── 보조 ────────────────────────────────────────────────────────────
function KindIcon({ type }: { type: string }) {
  const t = (type || '').toLowerCase()
  const size = 26
  const strokeWidth = 1.5
  if (t.includes('sequence')) return <MessageSquare size={size} strokeWidth={strokeWidth} />
  if (t.includes('class')) return <Boxes size={size} strokeWidth={strokeWidth} />
  if (t.includes('state')) return <Network size={size} strokeWidth={strokeWidth} />
  if (t.startsWith('er')) return <Database size={size} strokeWidth={strokeWidth} />
  if (t.includes('gantt') || t.includes('timeline')) return <CalendarRange size={size} strokeWidth={strokeWidth} />
  if (t.includes('pie')) return <ChartPie size={size} strokeWidth={strokeWidth} />
  if (t.includes('git')) return <GitBranch size={size} strokeWidth={strokeWidth} />
  if (t.includes('flow') || t.includes('graph')) return <Workflow size={size} strokeWidth={strokeWidth} />
  return <FileText size={size} strokeWidth={strokeWidth} />
}

/** 방금 / N분 전 / N시간 전 / N일 전 / 날짜 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '시간 정보 없음'
  const diff = now - ts
  if (diff < 60_000) return '방금'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}일 전`
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return sameYear
    ? `${d.getMonth() + 1}월 ${d.getDate()}일`
    : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

/** 서버에서 온 JSON 을 문서로 받아들인다. 형태가 아니면 null. */
function toSceneDoc(raw: unknown): SceneDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.id !== 'string' || !rec.id) return null
  if (!rec.elements || typeof rec.elements !== 'object') return null
  const { thumbnail: _thumbnail, ...rest } = rec
  const doc = rest as unknown as SceneDoc
  if (!Array.isArray(doc.order)) doc.order = Object.keys(doc.elements)
  if (typeof doc.code !== 'string') doc.code = ''
  if (typeof doc.title !== 'string') doc.title = '무제 다이어그램'
  return doc
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류입니다.'
}
