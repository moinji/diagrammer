/**
 * 명령 팔레트 — ⌘K / Ctrl+K.
 *
 * 설계 메모
 * 1) 명령은 모두 store 의 실제 액션이나 window 이벤트로만 연결한다. 팔레트가 독자 상태를 갖지 않는다.
 * 2) 선택이 없어서 지금 못 쓰는 명령도 목록에서 지우지 않는다. 지우면 "이 기능이 없나?" 로 읽힌다.
 *    대신 흐리게 두고, 실행하면 무엇이 필요한지 토스트로 알린다.
 * 3) 한글 IME 조합 중 Enter 는 글자 확정이다. 이때 명령을 실행하면 "자"를 치다가 삭제가 실행된다.
 *    isComposing 을 반드시 먼저 본다.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignVerticalDistributeCenter,
  AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  Circle, ClipboardPaste, Code, CodeXml, Copy, Crosshair, Cylinder, Diamond, Download, FileDown,
  FilePlus, Focus, FolderOpen, Frame, Grid2x2, Group, Hexagon, Image as ImageIcon, Keyboard,
  Layers, Lightbulb, Magnet, Map as MapIcon, Maximize2, Paintbrush, Palette, PanelRight, Percent,
  Pill, Redo2, Save, Scaling, Search, Settings, Sparkles, Square, SquareRoundCorner, Trash, Undo2,
  Ungroup, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useStore, DEFAULT_TEMPLATE } from '../../store/useStore'
import { TEMPLATES } from '../../core/templates'
import type { Store } from '../../store/useStore'
import { isBox } from '../../core/types'
import { THEMES } from '../../core/theme'
import { copyPngToClipboard, copyTextToClipboard } from '../../core/export/exporter'

// ── 단축키 표기 ─────────────────────────────────────────────────────
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

function sc(base: string, opts?: { shift?: boolean }): string {
  if (IS_MAC) return `${opts?.shift ? '⇧' : ''}⌘${base}`
  return `Ctrl+${opts?.shift ? 'Shift+' : ''}${base}`
}

/** 캔버스 영역. 줌·화면맞춤 계산에 필요하다. 아직 그려지기 전이면 창 크기로 대신한다. */
function stageRect(): DOMRect {
  const el = document.querySelector('.stage')
  if (el) return el.getBoundingClientRect()
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

function fire(event: string) {
  window.dispatchEvent(new CustomEvent(event))
}

// ── 실행 가능 조건 ──────────────────────────────────────────────────
type Need = 'undo' | 'redo' | 'sel' | 'box' | 'sel2' | 'sel3' | 'node' | 'group' | 'style' | 'editable'

interface Ctx {
  sel: number
  boxes: number
  nodes: number
  groups: number
  canUndo: boolean
  canRedo: boolean
  hasStyle: boolean
  editable: boolean
}

function computeCtx(s: Store): Ctx {
  let boxes = 0
  let nodes = 0
  let groups = 0
  for (const id of s.selection) {
    const el = s.doc.elements[id]
    if (!el) continue
    if (isBox(el)) boxes++
    if (el.kind === 'node') nodes++
    if (el.kind === 'group') groups++
  }
  return {
    sel: s.selection.length,
    boxes,
    nodes,
    groups,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    hasStyle: !!s.styleClipboard,
    editable: s.doc.editable,
  }
}

/** 지금 실행할 수 없으면 그 이유를, 실행할 수 있으면 null 을 준다. */
function reasonFor(need: Need | undefined, c: Ctx): string | null {
  switch (need) {
    case 'undo': return c.canUndo ? null : '되돌릴 작업이 없습니다.'
    case 'redo': return c.canRedo ? null : '다시 실행할 작업이 없습니다.'
    case 'sel': return c.sel > 0 ? null : '먼저 캔버스에서 요소를 선택하세요.'
    case 'box': return c.boxes > 0 ? null : '먼저 도형을 선택하세요.'
    case 'sel2': return c.boxes >= 2 ? null : '도형을 2개 이상 선택하세요.'
    case 'sel3': return c.boxes >= 3 ? null : '도형을 3개 이상 선택하세요.'
    case 'node': return c.nodes > 0 ? null : '노드를 선택하세요.'
    case 'group': return c.groups > 0 ? null : '그룹을 선택하세요.'
    case 'style':
      if (!c.hasStyle) return '복사해 둔 서식이 없습니다.'
      return c.boxes > 0 ? null : '서식을 붙여넣을 도형을 선택하세요.'
    case 'editable': return c.editable ? null : '이 다이어그램은 자유 편집을 지원하지 않습니다.'
    default: return null
  }
}

// ── 명령 정의 ───────────────────────────────────────────────────────
const GROUPS = ['파일', '편집', '정렬', '보기', '도형', '테마', '방향', '도움말'] as const
type GroupName = (typeof GROUPS)[number]

interface Command {
  id: string
  group: GroupName
  title: string
  /** 영타·약어로도 찾히게 하는 별칭 */
  keywords: string[]
  hint?: string
  icon: LucideIcon
  need?: Need
  run: () => void
}

/** 저장하지 않은 작업이 있으면 한 번 물어본다. */
function startNew(code?: string, title?: string) {
  const st = useStore.getState()
  const go = () => { void useStore.getState().newDoc(code, title) }
  if (st.dirty) {
    st.toast('warn', '저장하지 않은 변경이 있습니다.', { label: '새로 시작', run: go })
    return
  }
  go()
}

function buildCommands(ui: Store['ui'], themeId: string, direction: string): Command[] {
  const toggleHint = (on: boolean, key?: string) => `${key ? key + ' · ' : ''}${on ? '켜짐' : '꺼짐'}`
  const list: Command[] = [
    // ── 파일 ──
    {
      id: 'file.new', group: '파일', title: '새 다이어그램 만들기', icon: FilePlus, hint: sc('N'),
      keywords: ['new', 'file', 'create', 'template', '새로', '생성', '초기화', '템플릿'],
      run: () => useStore.getState().setUI({ templatesOpen: true }),
    },
    {
      id: 'file.vault', group: '파일', title: 'Obsidian 노트 열기', icon: FolderOpen,
      keywords: ['obsidian', 'vault', 'note', 'open', '노트', '보관함', '열기'],
      run: () => useStore.getState().setUI({ vaultOpen: true }),
    },
    ...TEMPLATES.filter(t => t.id !== 'blank').map(t => ({
      id: 'tpl.' + t.id,
      group: '파일' as GroupName,
      title: `템플릿: ${t.name}`,
      hint: t.desc,
      icon: FilePlus,
      keywords: ['template', 'new', '템플릿', '예제', t.name],
      run: () => startNew(t.code, t.name),
    })),
    {
      id: 'file.library', group: '파일', title: '라이브러리 열기', icon: FolderOpen, hint: sc('O'),
      keywords: ['open', 'library', 'browse', '열기', '목록', '보관함'],
      run: () => useStore.getState().setUI({ libraryOpen: true }),
    },
    {
      id: 'file.save', group: '파일', title: '라이브러리에 저장', icon: Save, hint: sc('S'),
      keywords: ['save', 'store', '저장', '보관'],
      run: () => fire('dgm:save-library'),
    },
    {
      id: 'file.obsidian', group: '파일', title: 'Obsidian 에 저장', icon: FileDown, hint: sc('S', { shift: true }),
      keywords: ['obsidian', 'vault', 'note', 'markdown', '옵시디언', '노트', '볼트'],
      run: () => fire('dgm:save-obsidian'),
    },
    {
      id: 'file.export', group: '파일', title: '파일로 내보내기', icon: Download, hint: sc('E'),
      keywords: ['export', 'png', 'svg', 'html', 'download', '내보내기', '저장', '이미지'],
      run: () => useStore.getState().setUI({ exportOpen: true }),
    },
    {
      id: 'file.copyCode', group: '파일', title: '머메이드 코드 복사', icon: Code,
      keywords: ['copy', 'mermaid', 'code', 'clipboard', '복사', '코드', '머메이드'],
      run: () => {
        const st = useStore.getState()
        copyTextToClipboard(st.doc.code)
          .then(() => st.toast('success', '머메이드 코드를 복사했습니다.'))
          .catch(() => st.toast('error', '클립보드에 복사하지 못했습니다.'))
      },
    },
    {
      id: 'file.copyPng', group: '파일', title: 'PNG 를 클립보드로 복사', icon: ImageIcon,
      keywords: ['copy', 'png', 'image', 'clipboard', '복사', '이미지', '그림'],
      run: () => {
        const st = useStore.getState()
        copyPngToClipboard(st.doc)
          .then(() => st.toast('success', 'PNG 를 복사했습니다.'))
          .catch(() => st.toast('error', '클립보드에 복사하지 못했습니다.'))
      },
    },
    {
      id: 'file.settings', group: '파일', title: '설정 열기', icon: Settings, hint: sc(','),
      keywords: ['settings', 'config', 'preferences', 'vault', '설정', '환경', '경로'],
      run: () => useStore.getState().setUI({ settingsOpen: true }),
    },

    // ── 편집 ──
    {
      id: 'edit.undo', group: '편집', title: '되돌리기', icon: Undo2, hint: sc('Z'), need: 'undo',
      keywords: ['undo', 'back', '되돌리기', '취소'],
      run: () => useStore.getState().undo(),
    },
    {
      id: 'edit.redo', group: '편집', title: '다시 실행', icon: Redo2, hint: sc('Z', { shift: true }), need: 'redo',
      keywords: ['redo', 'forward', '다시', '재실행'],
      run: () => useStore.getState().redo(),
    },
    {
      id: 'edit.duplicate', group: '편집', title: '선택 항목 복제', icon: Copy, hint: sc('D'), need: 'sel',
      keywords: ['duplicate', 'copy', 'clone', '복제', '복사'],
      run: () => { const st = useStore.getState(); st.duplicate(st.selection) },
    },
    {
      id: 'edit.delete', group: '편집', title: '선택 항목 삭제', icon: Trash, hint: 'Delete', need: 'sel',
      keywords: ['delete', 'remove', 'erase', '삭제', '지우기', '제거'],
      run: () => { const st = useStore.getState(); st.deleteElements(st.selection) },
    },
    {
      id: 'edit.selectAll', group: '편집', title: '전체 선택', icon: Frame, hint: sc('A'),
      keywords: ['select all', 'all', '전체', '모두', '선택'],
      run: () => useStore.getState().selectAll(),
    },
    {
      id: 'edit.clearSel', group: '편집', title: '선택 해제', icon: Crosshair, hint: 'Esc', need: 'sel',
      keywords: ['deselect', 'clear', 'none', '해제', '선택'],
      run: () => useStore.getState().clearSelection(),
    },
    {
      id: 'edit.group', group: '편집', title: '그룹 만들기', icon: Group, hint: sc('G'), need: 'box',
      keywords: ['group', 'subgraph', '그룹', '묶기', '서브그래프'],
      run: () => { const st = useStore.getState(); st.groupSelection(st.selection) },
    },
    {
      id: 'edit.ungroup', group: '편집', title: '그룹 해제', icon: Ungroup, hint: sc('G', { shift: true }), need: 'group',
      keywords: ['ungroup', 'split', '해제', '풀기', '그룹'],
      run: () => { const st = useStore.getState(); st.ungroup(st.selection) },
    },
    {
      id: 'edit.copyStyle', group: '편집', title: '서식 복사', icon: Paintbrush, need: 'box',
      keywords: ['copy style', 'format', 'painter', '서식', '스타일', '복사'],
      run: () => {
        const st = useStore.getState()
        const id = st.selection.find(i => {
          const el = st.doc.elements[i]
          return !!el && (el.kind === 'node' || el.kind === 'text' || el.kind === 'group')
        })
        if (!id) { st.toast('info', '서식을 복사할 도형을 선택하세요.'); return }
        st.copyStyle(id)
      },
    },
    {
      id: 'edit.pasteStyle', group: '편집', title: '서식 붙여넣기', icon: ClipboardPaste, need: 'style',
      keywords: ['paste style', 'format', '서식', '스타일', '붙여넣기'],
      run: () => { const st = useStore.getState(); st.pasteStyle(st.selection) },
    },
    {
      id: 'edit.front', group: '편집', title: '맨 앞으로 가져오기', icon: Layers, hint: sc(']', { shift: true }), need: 'sel',
      keywords: ['front', 'top', 'order', 'z', '앞으로', '순서'],
      run: () => { const st = useStore.getState(); st.reorder(st.selection, 'front') },
    },
    {
      id: 'edit.back', group: '편집', title: '맨 뒤로 보내기', icon: Layers, hint: sc('[', { shift: true }), need: 'sel',
      keywords: ['back', 'bottom', 'order', 'z', '뒤로', '순서'],
      run: () => { const st = useStore.getState(); st.reorder(st.selection, 'back') },
    },
    {
      id: 'edit.applyCode', group: '편집', title: '코드를 캔버스에 적용', icon: Code, hint: sc('Enter'), need: 'editable',
      keywords: ['apply', 'parse', 'mermaid', 'render', '적용', '코드', '반영'],
      run: () => { void useStore.getState().applyCode() },
    },

    // ── 정렬 ──
    {
      id: 'align.left', group: '정렬', title: '왼쪽 정렬', icon: AlignHorizontalJustifyStart, need: 'sel2',
      keywords: ['align left', 'left', '왼쪽', '정렬', '좌측'],
      run: () => { const st = useStore.getState(); st.align(st.selection, 'left') },
    },
    {
      id: 'align.hcenter', group: '정렬', title: '가로 가운데 정렬', icon: AlignCenterVertical, need: 'sel2',
      keywords: ['align center', 'horizontal', '가운데', '중앙', '가로', '정렬'],
      run: () => { const st = useStore.getState(); st.align(st.selection, 'hcenter') },
    },
    {
      id: 'align.right', group: '정렬', title: '오른쪽 정렬', icon: AlignHorizontalJustifyEnd, need: 'sel2',
      keywords: ['align right', 'right', '오른쪽', '정렬', '우측'],
      run: () => { const st = useStore.getState(); st.align(st.selection, 'right') },
    },
    {
      id: 'align.top', group: '정렬', title: '위쪽 정렬', icon: AlignVerticalJustifyStart, need: 'sel2',
      keywords: ['align top', 'top', '위', '위쪽', '정렬', '상단'],
      run: () => { const st = useStore.getState(); st.align(st.selection, 'top') },
    },
    {
      id: 'align.vcenter', group: '정렬', title: '세로 가운데 정렬', icon: AlignCenterHorizontal, need: 'sel2',
      keywords: ['align middle', 'vertical', '가운데', '중앙', '세로', '정렬'],
      run: () => { const st = useStore.getState(); st.align(st.selection, 'vcenter') },
    },
    {
      id: 'align.bottom', group: '정렬', title: '아래쪽 정렬', icon: AlignVerticalJustifyEnd, need: 'sel2',
      keywords: ['align bottom', 'bottom', '아래', '아래쪽', '정렬', '하단'],
      run: () => { const st = useStore.getState(); st.align(st.selection, 'bottom') },
    },
    {
      id: 'align.distH', group: '정렬', title: '가로 균등 배치', icon: AlignHorizontalDistributeCenter, need: 'sel3',
      keywords: ['distribute horizontal', 'spread', '균등', '가로', '배치', '간격'],
      run: () => { const st = useStore.getState(); st.distribute(st.selection, 'h') },
    },
    {
      id: 'align.distV', group: '정렬', title: '세로 균등 배치', icon: AlignVerticalDistributeCenter, need: 'sel3',
      keywords: ['distribute vertical', 'spread', '균등', '세로', '배치', '간격'],
      run: () => { const st = useStore.getState(); st.distribute(st.selection, 'v') },
    },
    {
      id: 'align.matchSize', group: '정렬', title: '크기 맞추기', icon: Scaling, need: 'sel2',
      keywords: ['match size', 'same', 'resize', '크기', '맞춤', '동일'],
      run: () => { const st = useStore.getState(); st.matchSize(st.selection, 'both') },
    },
    {
      id: 'align.matchWidth', group: '정렬', title: '너비 맞추기', icon: Scaling, need: 'sel2',
      keywords: ['match width', 'width', '너비', '가로', '맞춤'],
      run: () => { const st = useStore.getState(); st.matchSize(st.selection, 'w') },
    },
    {
      id: 'align.matchHeight', group: '정렬', title: '높이 맞추기', icon: Scaling, need: 'sel2',
      keywords: ['match height', 'height', '높이', '세로', '맞춤'],
      run: () => { const st = useStore.getState(); st.matchSize(st.selection, 'h') },
    },
    {
      id: 'align.relayout', group: '정렬', title: '전체 자동 정렬', icon: Sparkles, hint: 'L', need: 'editable',
      keywords: ['relayout', 'auto layout', 'tidy', 'arrange', '자동', '정렬', '배치'],
      run: () => { void useStore.getState().relayout() },
    },

    // ── 보기 ──
    {
      id: 'view.fit', group: '보기', title: '화면에 맞추기', icon: Maximize2, hint: 'F',
      keywords: ['fit', 'zoom fit', 'all', '맞춤', '전체', '화면'],
      run: () => useStore.getState().fitToScreen(stageRect()),
    },
    {
      id: 'view.fitSel', group: '보기', title: '선택 항목에 맞추기', icon: Focus, hint: sc('2'), need: 'sel',
      keywords: ['fit selection', 'zoom to', '선택', '맞춤', '확대'],
      run: () => { const st = useStore.getState(); st.fitToScreen(stageRect(), st.selection) },
    },
    {
      id: 'view.zoom100', group: '보기', title: '실제 크기(100%)', icon: Percent, hint: sc('0'),
      keywords: ['zoom 100', 'reset zoom', 'actual', '실제', '원본', '배율'],
      run: () => useStore.getState().setZoom(1, stageRect()),
    },
    {
      id: 'view.zoomIn', group: '보기', title: '확대', icon: ZoomIn, hint: sc('+'),
      keywords: ['zoom in', 'bigger', '확대', '크게'],
      run: () => { const st = useStore.getState(); st.setZoom(st.viewport.zoom * 1.2, stageRect()) },
    },
    {
      id: 'view.zoomOut', group: '보기', title: '축소', icon: ZoomOut, hint: sc('-'),
      keywords: ['zoom out', 'smaller', '축소', '작게'],
      run: () => { const st = useStore.getState(); st.setZoom(st.viewport.zoom / 1.2, stageRect()) },
    },
    {
      id: 'view.code', group: '보기', title: '코드 패널 켜고 끄기', icon: CodeXml, hint: toggleHint(ui.showCode, sc('B')),
      keywords: ['code panel', 'editor', 'mermaid', '코드', '패널', '편집기'],
      run: () => { const st = useStore.getState(); st.setUI({ showCode: !st.ui.showCode }) },
    },
    {
      id: 'view.grid', group: '보기', title: '격자 켜고 끄기', icon: Grid2x2, hint: toggleHint(ui.showGrid),
      keywords: ['grid', 'guide', '격자', '모눈', '눈금'],
      run: () => { const st = useStore.getState(); st.setUI({ showGrid: !st.ui.showGrid }) },
    },
    {
      id: 'view.snap', group: '보기', title: '격자 스냅 켜고 끄기', icon: Magnet, hint: toggleHint(ui.snapEnabled),
      keywords: ['snap', 'magnet', '스냅', '자석', '붙임'],
      run: () => { const st = useStore.getState(); st.setUI({ snapEnabled: !st.ui.snapEnabled }) },
    },
    {
      id: 'view.minimap', group: '보기', title: '미니맵 켜고 끄기', icon: MapIcon, hint: toggleHint(ui.showMinimap),
      keywords: ['minimap', 'overview', '미니맵', '축소판'],
      run: () => { const st = useStore.getState(); st.setUI({ showMinimap: !st.ui.showMinimap }) },
    },
    {
      id: 'view.inspector', group: '보기', title: '인스펙터 켜고 끄기', icon: PanelRight, hint: toggleHint(ui.inspectorOpen),
      keywords: ['inspector', 'properties', 'sidebar', '인스펙터', '속성', '패널'],
      run: () => { const st = useStore.getState(); st.setUI({ inspectorOpen: !st.ui.inspectorOpen }) },
    },

    // ── 도형 ──
    ...([
      ['rect', '사각형', Square, ['rect', 'box', 'square', '사각형', '네모']],
      ['round', '둥근 사각형', SquareRoundCorner, ['round', 'rounded', '둥근', '라운드']],
      ['stadium', '알약', Pill, ['stadium', 'pill', '알약', '캡슐']],
      ['circle', '원', Circle, ['circle', 'round', '원', '동그라미']],
      ['diamond', '마름모(조건)', Diamond, ['diamond', 'decision', 'condition', '마름모', '조건', '분기']],
      ['hexagon', '육각형', Hexagon, ['hexagon', 'hex', '육각형']],
      ['cylinder', '원통(DB)', Cylinder, ['cylinder', 'database', 'db', 'store', '원통', '데이터베이스', '저장소']],
    ] as const).map(([shape, label, icon, keywords]) => ({
      id: `shape.${shape}`,
      group: '도형' as GroupName,
      title: `도형: ${label}`,
      icon,
      keywords: ['shape', ...keywords],
      need: 'node' as Need,
      run: () => { const st = useStore.getState(); st.setShape(st.selection, shape) },
    })),

    // ── 테마 ──
    ...THEMES.map(t => ({
      id: `theme.${t.id}`,
      group: '테마' as GroupName,
      title: `테마: ${t.name}`,
      icon: Palette,
      keywords: ['theme', 'color', 'style', t.id, '테마', '색', '배색'],
      hint: themeId === t.id ? '현재' : undefined,
      run: () => useStore.getState().setTheme(t.id),
    })),

    // ── 방향 ──
    ...([
      ['TB', '위 → 아래', ArrowDown, ['tb', 'td', 'top bottom', 'vertical', '세로', '아래']],
      ['BT', '아래 → 위', ArrowUp, ['bt', 'bottom top', '위로', '역방향']],
      ['LR', '왼쪽 → 오른쪽', ArrowRight, ['lr', 'left right', 'horizontal', '가로', '오른쪽']],
      ['RL', '오른쪽 → 왼쪽', ArrowLeft, ['rl', 'right left', '왼쪽', '역방향']],
    ] as const).map(([dir, label, icon, keywords]) => ({
      id: `dir.${dir}`,
      group: '방향' as GroupName,
      title: `방향: ${label}`,
      icon,
      keywords: ['direction', 'flow', 'layout', ...keywords],
      hint: direction === dir ? '현재' : undefined,
      need: 'editable' as Need,
      run: () => useStore.getState().setDirection(dir),
    })),

    // ── 도움말 ──
    {
      id: 'help.shortcuts', group: '도움말', title: '단축키 도움말 열기', icon: Keyboard, hint: '?',
      keywords: ['help', 'shortcut', 'keyboard', 'manual', '도움말', '단축키', '사용법'],
      run: () => useStore.getState().setUI({ helpOpen: true }),
    },
    {
      id: 'help.sample', group: '도움말', title: '예제 다이어그램 불러오기', icon: Lightbulb,
      keywords: ['sample', 'example', 'template', 'demo', '예제', '샘플', '견본'],
      run: () => startNew(DEFAULT_TEMPLATE, '예제 다이어그램'),
    },
  ]

  return list
}

// ── 검색 ────────────────────────────────────────────────────────────
const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

/** '새 다이어그램' → 'ㅅ ㄷㅇㅇㄱㄹ' — 초성만 쳐도 찾히게 한다. */
function chosungOf(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)]
    else out += ch
  }
  return out
}

function isChosungQuery(q: string): boolean {
  return /^[ㄱ-ㅎ]+$/.test(q)
}

/** 띄엄띄엄 쳐도(부분 수열) 걸리게 — 가장 낮은 점수 */
function subsequence(text: string, q: string): boolean {
  let i = 0
  for (const ch of text) {
    if (ch === q[i]) i++
    if (i === q.length) return true
  }
  return q.length === 0
}

interface Prepared {
  cmd: Command
  title: string
  words: string[]
  chosung: string
  keywords: string[]
  group: string
}

function prepare(cmd: Command): Prepared {
  const title = cmd.title.toLowerCase()
  return {
    cmd,
    title,
    words: title.split(/[\s:·()/→]+/).filter(Boolean),
    chosung: chosungOf(title),
    keywords: cmd.keywords.map(k => k.toLowerCase()),
    group: cmd.group.toLowerCase(),
  }
}

/** 한 토큰의 점수. 0 이면 불일치. */
function tokenScore(p: Prepared, q: string): number {
  if (p.title.startsWith(q)) return 100
  if (p.words.some(w => w.startsWith(q))) return 80
  if (p.title.includes(q)) return 60
  if (p.keywords.some(k => k.startsWith(q))) return 45
  if (p.keywords.some(k => k.includes(q))) return 35
  if (p.group.includes(q)) return 28
  if (isChosungQuery(q) && p.chosung.includes(q)) return 24
  if (subsequence(p.title, q)) return 12
  return 0
}

function scoreOf(p: Prepared, tokens: string[]): number {
  let total = 0
  for (const t of tokens) {
    const s = tokenScore(p, t)
    if (s === 0) return 0
    total += s
  }
  return total / tokens.length
}

// ── 컴포넌트 ────────────────────────────────────────────────────────
export function CommandPalette() {
  const open = useStore(s => s.ui.paletteOpen)
  const ui = useStore(s => s.ui)
  const selection = useStore(s => s.selection)
  const elements = useStore(s => s.doc.elements)
  const pastLen = useStore(s => s.past.length)
  const futureLen = useStore(s => s.future.length)
  const styleClip = useStore(s => s.styleClipboard)
  const editable = useStore(s => s.doc.editable)
  const themeId = useStore(s => s.doc.themeId)
  const direction = useStore(s => s.doc.direction)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const ctx = useMemo(
    () => computeCtx(useStore.getState()),
    [selection, elements, pastLen, futureLen, styleClip, editable],
  )

  const prepared = useMemo(
    () => buildCommands(ui, themeId, direction).map(prepare),
    [ui, themeId, direction],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return prepared
    const tokens = q.split(/\s+/).filter(Boolean)
    return prepared
      .map((p, i) => ({ p, i, s: scoreOf(p, tokens) }))
      .filter(r => r.s > 0)
      .sort((a, b) => (b.s - a.s) || (a.i - b.i))
      .map(r => r.p)
  }, [prepared, query])

  // 열 때마다 검색어를 비우고 입력에 포커스를 준다
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => { setActive(0) }, [query])

  const activeIdx = results.length ? Math.min(active, results.length - 1) : 0

  useEffect(() => {
    itemRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, results.length])

  if (!open) return null

  const close = () => useStore.getState().setUI({ paletteOpen: false })

  const execute = (cmd: Command) => {
    const st = useStore.getState()
    const reason = reasonFor(cmd.need, computeCtx(st))
    if (reason) {
      // 팔레트는 열어 둔다. 토스트는 팔레트 위(z-index 300)에 뜬다.
      st.toast('info', reason)
      return
    }
    close()
    cmd.run()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    // 한글 조합 중 Enter 는 글자 확정이다. 방향키도 IME 후보 이동일 수 있다.
    const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
    if (composing) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length) setActive((activeIdx + 1) % results.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length) setActive((activeIdx - 1 + results.length) % results.length)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(0, results.length - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const picked = results[activeIdx]
      if (picked) execute(picked.cmd)
    }
  }

  itemRefs.current.length = results.length
  let lastGroup: string | null = null

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="명령 검색 — 내보내기, 정렬, export, png…"
            aria-label="명령 검색"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="palette-list" role="listbox" aria-label="명령 목록">
          {!results.length && (
            <div className="palette-empty muted">일치하는 명령이 없습니다.</div>
          )}
          {results.map((p, i) => {
            const cmd = p.cmd
            const reason = reasonFor(cmd.need, ctx)
            const Icon = cmd.icon
            const header = cmd.group !== lastGroup ? cmd.group : null
            lastGroup = cmd.group
            return (
              <Fragment key={cmd.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  ref={el => { itemRefs.current[i] = el }}
                  className={`palette-item${i === activeIdx ? ' active' : ''}${reason ? ' is-off' : ''}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  aria-disabled={!!reason}
                  title={reason ? `${cmd.title} — ${reason}` : cmd.title}
                  onMouseMove={() => setActive(i)}
                  onClick={() => execute(cmd)}
                >
                  <span className="pi-icon"><Icon size={15} aria-hidden="true" /></span>
                  <span className="pi-title">{cmd.title}</span>
                  {cmd.hint && <span className="pi-hint">{cmd.hint}</span>}
                </button>
              </Fragment>
            )
          })}
        </div>

        <div className="palette-foot">
          <span>↑↓ 이동</span>
          <span>Enter 실행</span>
          <span>Esc 닫기</span>
          <span className="spacer" />
          <span>{results.length}개</span>
        </div>
      </div>
    </div>
  )
}
