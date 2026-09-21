/**
 * 상단 바 — 문서 이름, 저장 상태, 주요 동작.
 * "저장했는지 모르겠다"는 불안을 없애는 것이 이 줄의 목적이다.
 */
import React, { useEffect, useState } from 'react'
import {
  BookOpen, Columns2, Download, FolderOpen, HelpCircle, PanelRight,
  Save, Settings, Share2, Workflow,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { ping } from '../core/api'

export function TopBar() {
  const title = useStore(s => s.doc.title)
  const dirty = useStore(s => s.dirty)
  const savedAt = useStore(s => s.savedAt)
  const ui = useStore(s => s.ui)
  const setUI = useStore(s => s.setUI)
  const setTitle = useStore(s => s.setTitle)
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  const [draft, setDraft] = useState(title)

  useEffect(() => setDraft(title), [title])

  useEffect(() => {
    let alive = true
    const check = () => { void ping().then(v => alive && setServerUp(v)) }
    check()
    const t = setInterval(check, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name))

  return (
    <header className="topbar">
      <div className="brand">
        <Workflow size={17} />
        다이아그래머
      </div>

      <input
        className="doc-title"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => draft !== title && setTitle(draft.trim() || '무제 다이어그램')}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setDraft(title); (e.target as HTMLInputElement).blur() }
        }}
        title="문서 이름"
        spellCheck={false}
      />

      <SaveStatus dirty={dirty} savedAt={savedAt} />

      <div className="spacer" />

      {serverUp === false && (
        <span className="status-chip" title="파일 서버가 꺼져 있어 저장·Obsidian 연동을 쓸 수 없습니다. 그리기와 다운로드는 그대로 됩니다.">
          <span className="dot" style={{ background: 'var(--danger)' }} />
          파일 서버 꺼짐
        </span>
      )}

      <button className="btn" onClick={() => setUI({ libraryOpen: true })} title="라이브러리 열기 (⌘O)">
        <FolderOpen size={14} /> 라이브러리
      </button>
      <button className="btn" onClick={() => fire('dgm:save-library')} title="라이브러리에 저장 (⌘S)">
        <Save size={14} /> 저장
      </button>
      <button className="btn" onClick={() => fire('dgm:save-obsidian')} title="Obsidian vault 에 저장 (⇧⌘S)">
        <BookOpen size={14} /> Obsidian
      </button>
      <button
        className="btn icon"
        onClick={() => setUI({ vaultOpen: true })}
        title="Obsidian 에 저장한 노트 열기"
      >
        <FolderOpen size={14} />
      </button>
      <button className="btn primary" onClick={() => setUI({ exportOpen: true })} title="내보내기 (⌘E)">
        <Download size={14} /> 내보내기
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 3px' }} />

      <button
        className={'btn icon ghost' + (ui.showCode ? ' active' : '')}
        onClick={() => setUI({ showCode: !ui.showCode })}
        title="코드 패널 (⌘B)"
        style={ui.showCode ? { color: 'var(--accent)' } : undefined}
      >
        <Columns2 size={15} />
      </button>
      <button
        className="btn icon ghost"
        onClick={() => setUI({ inspectorOpen: !ui.inspectorOpen })}
        title="속성 패널"
        style={ui.inspectorOpen ? { color: 'var(--accent)' } : undefined}
      >
        <PanelRight size={15} />
      </button>
      <button className="btn icon ghost" onClick={() => setUI({ settingsOpen: true })} title="설정 (⌘,)">
        <Settings size={15} />
      </button>
      <button className="btn icon ghost" onClick={() => setUI({ helpOpen: true })} title="도움말 (?)">
        <HelpCircle size={15} />
      </button>
    </header>
  )
}

function SaveStatus({ dirty, savedAt }: { dirty: boolean; savedAt: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 20000)
    return () => clearInterval(t)
  }, [])

  if (dirty) {
    return (
      <span className="status-chip dirty" title="아직 파일로 저장하지 않았습니다. 브라우저에는 자동 보관됩니다.">
        <span className="dot" /> 저장 안 됨
      </span>
    )
  }
  if (savedAt) {
    return (
      <span className="status-chip saved" title={new Date(savedAt).toLocaleString('ko-KR')}>
        <span className="dot" /> {relative(savedAt)} 저장됨
      </span>
    )
  }
  return null
}

function relative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return '방금'
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return new Date(ts).toLocaleDateString('ko-KR')
}
