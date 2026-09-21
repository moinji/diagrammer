/**
 * 도움말 — 단축키 / 빠른 시작 / mermaid 문법.
 *
 * 단축키 표는 App.tsx(useKeyboardShortcuts)와 Canvas.tsx 에 실제로 구현된 것만 옮겨 적는다.
 * 구현에 없는 키를 적으면 도움말이 곧바로 거짓말이 된다.
 */
import { useEffect, useState } from 'react'
import { BookOpen, Keyboard, Plus, Rocket, X } from 'lucide-react'
import { useStore } from '../../store/useStore'

type TabId = 'keys' | 'start' | 'syntax'

const TABS: { id: TabId; label: string }[] = [
  { id: 'keys', label: '단축키' },
  { id: 'start', label: '빠른 시작' },
  { id: 'syntax', label: 'mermaid 문법' },
]

function closeHelp() {
  useStore.getState().setUI({ helpOpen: false })
}

// ── 단축키 표 ───────────────────────────────────────────────────────
interface KeyRow {
  desc: string
  keys: string[]
}

const SHORTCUTS: { title: string; rows: KeyRow[] }[] = [
  {
    title: '파일',
    rows: [
      { desc: '라이브러리에 저장', keys: ['⌘S'] },
      { desc: 'Obsidian 에 저장', keys: ['⇧⌘S'] },
      { desc: '내보내기 열기', keys: ['⌘E'] },
      { desc: '라이브러리 열기', keys: ['⌘O'] },
      { desc: '설정 열기', keys: ['⌘,'] },
      { desc: '명령 팔레트 열기', keys: ['⌘K'] },
      { desc: '도움말 열기', keys: ['?'] },
    ],
  },
  {
    title: '보기',
    rows: [
      { desc: '코드창 접기·펼치기', keys: ['⌘B'] },
      { desc: '배율 100%', keys: ['⌘0'] },
      { desc: '전체를 화면에 맞추기', keys: ['⌘1', 'F'] },
      { desc: '선택 영역에 맞추기', keys: ['⌘2'] },
      { desc: '확대', keys: ['⌘='] },
      { desc: '축소', keys: ['⌘-'] },
      { desc: '자동 정렬', keys: ['L'] },
    ],
  },
  {
    title: '선택',
    rows: [
      { desc: '전체 선택', keys: ['⌘A'] },
      { desc: '선택 해제·선택 도구로', keys: ['Esc'] },
      { desc: '선택에 더하기·빼기', keys: ['⇧클릭', '⌘클릭'] },
      { desc: '사각 선택(걸치면 선택)', keys: ['빈 곳 드래그'] },
    ],
  },
  {
    title: '편집',
    rows: [
      { desc: '되돌리기', keys: ['⌘Z'] },
      { desc: '다시 실행', keys: ['⇧⌘Z', '⌘Y'] },
      { desc: '복사', keys: ['⌘C'] },
      { desc: '잘라내기', keys: ['⌘X'] },
      { desc: '붙여넣기', keys: ['⌘V'] },
      { desc: '복제', keys: ['⌘D'] },
      { desc: '그룹 묶기', keys: ['⌘G'] },
      { desc: '그룹 풀기', keys: ['⇧⌘G'] },
      { desc: '삭제', keys: ['⌫', 'Delete'] },
      { desc: '글자 편집 시작', keys: ['Enter', 'F2'] },
      { desc: '오른쪽에 노드 만들어 잇기', keys: ['Tab'] },
      { desc: '1px 이동', keys: ['←', '↑', '→', '↓'] },
      { desc: '10px 이동', keys: ['⇧ + 방향키'] },
      { desc: '한 칸 앞으로 / 맨 앞으로', keys: ['⌘]', '⇧⌘]'] },
      { desc: '한 칸 뒤로 / 맨 뒤로', keys: ['⌘[', '⇧⌘['] },
      { desc: '코드 적용(코드창 안에서)', keys: ['⌘Enter'] },
    ],
  },
  {
    title: '도구',
    rows: [
      { desc: '선택 도구', keys: ['V'] },
      { desc: '손 도구(화면 이동)', keys: ['H'] },
      { desc: '노드 도구', keys: ['N', 'R'] },
      { desc: '연결선 도구', keys: ['E'] },
      { desc: '텍스트 도구', keys: ['T'] },
      { desc: '자유 그리기 도구', keys: ['P'] },
    ],
  },
  {
    title: '캔버스 조작',
    rows: [
      { desc: '화면 이동', keys: ['두 손가락 스크롤'] },
      { desc: '화면 이동(마우스)', keys: ['Space 드래그', '가운데 버튼 드래그'] },
      { desc: '화면 이동(빈 곳)', keys: ['우클릭 드래그'] },
      { desc: '커서 기준 확대·축소', keys: ['핀치', '⌘휠'] },
      { desc: '새 노드 만들기', keys: ['빈 곳 더블클릭'] },
      { desc: '글자 고치기', keys: ['노드 더블클릭'] },
      { desc: '연결선에 경유점 추가', keys: ['연결선 더블클릭'] },
      { desc: '연결선 만들기', keys: ['연결점에서 드래그'] },
      { desc: '비율 유지하며 크기 조절', keys: ['⇧ + 모서리 드래그'] },
    ],
  },
]

// ── 빠른 시작 ───────────────────────────────────────────────────────
interface Step {
  title: string
  body: string
  keys?: string[]
}

const STEPS: Step[] = [
  {
    title: '왼쪽 코드창에 mermaid 코드를 씁니다',
    body: '코드를 쓰면 오른쪽 캔버스에 그대로 그려집니다. 코드창이 거슬리면 접어두고 캔버스만 쓸 수도 있습니다.',
    keys: ['⌘Enter', '⌘B'],
  },
  {
    title: '노드를 끌어서 잇습니다',
    body: '노드에 마우스를 올리면 파란 점(연결점)이 뜹니다. 거기서 끌면 연결선이 생기고, 빈 곳에 놓으면 새 노드가 만들어지면서 바로 이어집니다.',
    keys: ['연결점에서 드래그'],
  },
  {
    title: '더블클릭으로 글자를 고칩니다',
    body: '노드를 더블클릭하면 그 자리에서 글자를 고칩니다. Enter 로 확정하고, 줄을 바꾸려면 ⇧Enter 를 씁니다.',
    keys: ['더블클릭', 'Enter'],
  },
  {
    title: '오른쪽 인스펙터에서 색과 도형을 바꿉니다',
    body: '노드를 고르면 인스펙터가 열립니다. 채움색·선색·도형·글꼴을 바꾸면 mermaid 코드에도 함께 반영됩니다.',
  },
  {
    title: '흐트러지면 자동 정렬로 되돌립니다',
    body: 'L 을 누르면 코드 기준으로 다시 배치하고, F 를 누르면 전체를 화면에 맞춥니다.',
    keys: ['L', 'F'],
  },
  {
    title: '파일로 내보냅니다',
    body: 'PNG·SVG·HTML 로 저장하거나 클립보드로 복사합니다.',
    keys: ['⌘E'],
  },
  {
    title: 'Obsidian 볼트에 저장합니다',
    body: '노트 하나에 그림과 mermaid 코드가 함께 들어가므로, 나중에 다시 열어 편집할 수 있습니다.',
    keys: ['⇧⌘S'],
  },
]

// ── mermaid 치트시트 ────────────────────────────────────────────────
interface Snip {
  desc: string
  /** 화면에 보이는 예제 */
  code: string
  /** 실제로 넣을 코드. {a} {b} {c} 는 새 이름으로 바뀐다 */
  tpl: string
  /** 첫 줄(flowchart 선언)을 바꾸는 항목 */
  header?: boolean
}

const CHEATS: { title: string; hint?: string; items: Snip[] }[] = [
  {
    title: '도형',
    hint: '대괄호·소괄호 모양이 곧 도형입니다.',
    items: [
      { desc: '사각형', code: 'A[사각형]', tpl: '{a}[사각형]' },
      { desc: '둥근 사각형', code: 'A(둥근)', tpl: '{a}(둥근)' },
      { desc: '알약', code: 'A([알약])', tpl: '{a}([알약])' },
      { desc: '서브루틴', code: 'A[[서브루틴]]', tpl: '{a}[[서브루틴]]' },
      { desc: '원통(DB)', code: 'A[(원통)]', tpl: '{a}[(원통)]' },
      { desc: '원', code: 'A((원))', tpl: '{a}((원))' },
      { desc: '마름모(분기)', code: 'A{마름모}', tpl: '{a}{마름모}' },
      { desc: '육각형', code: 'A{{육각형}}', tpl: '{a}{{육각형}}' },
      { desc: '평행사변형', code: 'A[/평행사변형/]', tpl: '{a}[/평행사변형/]' },
    ],
  },
  {
    title: '화살표',
    hint: '선 모양과 끝 모양을 함께 정합니다.',
    items: [
      { desc: '화살표', code: 'A --> B', tpl: '{a}[A] --> {b}[B]' },
      { desc: '선만', code: 'A --- B', tpl: '{a}[A] --- {b}[B]' },
      { desc: '점선 화살표', code: 'A -.-> B', tpl: '{a}[A] -.-> {b}[B]' },
      { desc: '굵은 화살표', code: 'A ==> B', tpl: '{a}[A] ==> {b}[B]' },
      { desc: '원형 끝', code: 'A --o B', tpl: '{a}[A] --o {b}[B]' },
      { desc: 'X 끝', code: 'A --x B', tpl: '{a}[A] --x {b}[B]' },
      { desc: '양방향', code: 'A <--> B', tpl: '{a}[A] <--> {b}[B]' },
      { desc: '라벨 붙이기', code: 'A -->|라벨| B', tpl: '{a}[A] -->|라벨| {b}[B]' },
    ],
  },
  {
    title: '방향',
    hint: '첫 줄의 flowchart 선언을 바꿉니다. 이 항목은 덧붙이지 않고 첫 줄을 고쳐 씁니다.',
    items: [
      { desc: '위 → 아래', code: 'flowchart TD', tpl: 'flowchart TD', header: true },
      { desc: '왼쪽 → 오른쪽', code: 'flowchart LR', tpl: 'flowchart LR', header: true },
      { desc: '오른쪽 → 왼쪽', code: 'flowchart RL', tpl: 'flowchart RL', header: true },
      { desc: '아래 → 위', code: 'flowchart BT', tpl: 'flowchart BT', header: true },
    ],
  },
  {
    title: '묶음',
    hint: 'subgraph 로 묶으면 캔버스에서 그룹이 됩니다.',
    items: [
      {
        desc: '그룹 만들기',
        code: 'subgraph 그룹\n  A --> B\nend',
        tpl: 'subgraph 그룹\n  {a}[A] --> {b}[B]\nend',
      },
    ],
  },
  {
    title: '색 지정',
    hint: 'style 은 한 노드에, classDef 는 여러 노드에 같은 색을 입힐 때 씁니다.',
    items: [
      {
        desc: '한 노드에 색',
        code: 'A[강조]\nstyle A fill:#f9f,stroke:#333',
        tpl: '{a}[강조]\nstyle {a} fill:#f9f,stroke:#333',
      },
      {
        desc: '색 묶음(classDef)',
        code: 'classDef hot fill:#fee,stroke:#f66\nA[중요]:::hot',
        tpl: 'classDef {c} fill:#fee,stroke:#f66\n{a}[중요]:::{c}',
      },
    ],
  },
]

// ── 코드 넣기 ───────────────────────────────────────────────────────
function uid(): string {
  return Math.random().toString(36).slice(2, 6)
}

/** 예제의 자리표시자를 기존 코드와 겹치지 않는 새 이름으로 바꾼다 */
function fill(tpl: string): string {
  return tpl
    .replaceAll('{a}', 'n' + uid())
    .replaceAll('{b}', 'n' + uid())
    .replaceAll('{c}', 'c' + uid())
}

function indent(text: string): string {
  return text
    .split('\n')
    .map(line => (line ? '    ' + line : line))
    .join('\n')
}

function insertSnippet(snip: Snip) {
  const st = useStore.getState()
  const code = st.codeText
  const filled = fill(snip.tpl)

  if (snip.header) {
    const lines = code.split('\n')
    const at = lines.findIndex(line => /^\s*(flowchart|graph)\b/.test(line))
    if (at < 0) {
      st.toast('warn', 'flowchart 코드에서만 방향을 바꿀 수 있습니다.')
      return
    }
    lines[at] = filled
    useStore.setState({ codeText: lines.join('\n') })
  } else {
    const base = code.replace(/\s+$/, '')
    const head = base ? base : 'flowchart TD'
    useStore.setState({ codeText: head + '\n' + indent(filled) + '\n' })
  }

  void st.applyCode()
  st.toast('success', '예제를 코드에 넣었습니다.')
  st.setUI({ helpOpen: false })
}

// ── 화면 ────────────────────────────────────────────────────────────
export function HelpPanel() {
  const [tab, setTab] = useState<TabId>('keys')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHelp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const TabIcon = tab === 'keys' ? Keyboard : tab === 'start' ? Rocket : BookOpen

  return (
    <div className="modal-backdrop" onMouseDown={closeHelp}>
      <div className="modal wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="도움말">
        <div className="modal-head">
          <TabIcon size={16} />
          <h3>도움말</h3>
          <div className="seg help-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={t.id === tab ? 'active' : ''}
                title={t.label + ' 보기'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button className="btn icon ghost" title="닫기" onClick={closeHelp}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {tab === 'keys' && <KeysTab />}
          {tab === 'start' && <StartTab />}
          {tab === 'syntax' && <SyntaxTab />}
        </div>

        <div className="modal-foot">
          <span className="muted">
            이 도움말은 <kbd>?</kbd> 키로 언제든 열 수 있습니다.
          </span>
          <div className="spacer" />
          <button className="btn" title="도움말 닫기" onClick={closeHelp}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function KeysTab() {
  return (
    <div className="shortcut-cols">
      {SHORTCUTS.map(group => (
        <div className="shortcut-group" key={group.title}>
          <h5>{group.title}</h5>
          {group.rows.map(row => (
            <div className="shortcut-row" key={row.desc}>
              <span>{row.desc}</span>
              <div className="key-cell">
                {row.keys.map(k => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function StartTab() {
  return (
    <div>
      <p className="muted" style={{ margin: '0 0 12px', lineHeight: 1.7 }}>
        아래 순서대로 따라 하면 3분 안에 첫 다이어그램을 만들고 저장할 수 있습니다.
      </p>
      {STEPS.map((step, i) => (
        <div className="help-step" key={step.title}>
          <div className="num">{i + 1}</div>
          <div className="body">
            <b>{step.title}</b>
            {step.body}
            {step.keys && (
              <span className="key-cell">
                {step.keys.map(k => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function SyntaxTab() {
  return (
    <div>
      <p className="muted" style={{ margin: '0 0 12px', lineHeight: 1.7 }}>
        예제를 넣으면 현재 코드 뒤에 덧붙고 바로 그려집니다. 기존 노드와 겹치지 않도록 이름은 새로 붙습니다.
      </p>
      {CHEATS.map(group => (
        <div className="insp-section" key={group.title}>
          <h4>{group.title}</h4>
          {group.hint && (
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 11.5, lineHeight: 1.6 }}>
              {group.hint}
            </p>
          )}
          {group.items.map(item => (
            <div className="cheat-item" key={item.desc}>
              <span className="cheat-desc">{item.desc}</span>
              <pre>{item.code}</pre>
              <button
                className="btn sm"
                title={item.desc + ' 예제를 코드에 넣기'}
                onClick={() => insertSnippet(item)}
              >
                <Plus size={12} />
                이 예제 넣기
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
