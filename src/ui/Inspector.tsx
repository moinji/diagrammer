/**
 * 속성 패널.
 *
 * 선택한 것에 따라 내용이 바뀐다. 아무것도 선택하지 않았을 때 빈 패널을 보여주지 않는 것이 중요하다 —
 * 그 자리에 문서 전체 설정(테마·방향·배경)을 놓아 항상 할 일이 있게 한다.
 */
import React, { useMemo } from 'react'
import {
  AlignCenter, AlignEndHorizontal, AlignHorizontalJustifyCenter, AlignLeft,
  AlignRight, AlignStartHorizontal, AlignVerticalJustifyCenter, ArrowDownUp,
  ArrowLeftRight, Bold, Brush, ChevronsLeftRight, Copy, Italic, Link2, Lock,
  MoveDown, MoveUp, Paintbrush, Trash2, Unlock,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type {
  EdgeElement, GroupElement, MarkerKind, NodeElement, NodeStyle, SceneElement, ShapeKind, TextElement,
} from '../core/types'
import { SHAPE_LABELS, isBox } from '../core/types'
import { SHAPES, SHAPE_GROUPS } from '../core/shapes'
import { NODE_PRESETS, SWATCHES, THEMES, getTheme } from '../core/theme'

export function Inspector() {
  const selection = useStore(s => s.selection)
  const elements = useStore(s => s.doc.elements)

  const selected = useMemo(
    () => selection.map(id => elements[id]).filter(Boolean) as SceneElement[],
    [selection, elements],
  )

  const nodes = selected.filter(e => e.kind === 'node') as NodeElement[]
  const edges = selected.filter(e => e.kind === 'edge') as EdgeElement[]
  const groups = selected.filter(e => e.kind === 'group') as GroupElement[]
  const texts = selected.filter(e => e.kind === 'text') as TextElement[]
  const boxes = selected.filter(isBox)

  return (
    <aside className="inspector">
      <div className="insp-scroll">
        {selected.length === 0 && <DocumentSection />}

        {selected.length > 1 && <ArrangeSection ids={selection} />}

        {(nodes.length > 0 || texts.length > 0) && (
          <>
            {selected.length === 1 && <TextSection el={(nodes[0] ?? texts[0])!} />}
            {nodes.length > 0 && <ShapeSection nodes={nodes} />}
            <StyleSection ids={[...nodes, ...texts].map(n => n.id)} sample={(nodes[0] ?? texts[0])!.style} />
            <TypographySection ids={[...nodes, ...texts].map(n => n.id)} sample={(nodes[0] ?? texts[0])!.style} />
          </>
        )}

        {groups.length > 0 && (
          <>
            {selected.length === 1 && <TextSection el={groups[0]} />}
            <StyleSection ids={groups.map(g => g.id)} sample={groups[0].style} />
          </>
        )}

        {edges.length > 0 && <EdgeSection edges={edges} />}

        {boxes.length === 1 && <GeometrySection el={boxes[0]} />}

        {selected.length > 0 && <ActionsSection ids={selection} />}
      </div>
    </aside>
  )
}

// ── 문서 ────────────────────────────────────────────────────────────
function DocumentSection() {
  const doc = useStore(s => s.doc)
  const setTheme = useStore(s => s.setTheme)
  const setDirection = useStore(s => s.setDirection)
  const count = Object.values(doc.elements).filter(e => e.kind === 'node').length
  const edgeCount = Object.values(doc.elements).filter(e => e.kind === 'edge').length

  return (
    <>
      <div className="insp-section">
        <h4>문서</h4>
        <div className="insp-row">
          <span className="insp-label">테마</span>
          <select className="field" value={doc.themeId} onChange={e => setTheme(e.target.value)}>
            {THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="insp-row">
          <span className="insp-label">방향</span>
          <div className="seg">
            {([['TB', '↓'], ['LR', '→'], ['BT', '↑'], ['RL', '←']] as const).map(([d, label]) => (
              <button
                key={d}
                className={doc.direction === d ? 'active' : ''}
                onClick={() => setDirection(d)}
                title={{ TB: '위 → 아래', LR: '왼쪽 → 오른쪽', BT: '아래 → 위', RL: '오른쪽 → 왼쪽' }[d]}
                disabled={!doc.editable}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="insp-row">
          <span className="insp-label">배경</span>
          <input
            className="field"
            type="color"
            value={toHex(doc.background ?? getTheme(doc.themeId).background)}
            onChange={e => useStore.setState({ doc: { ...doc, background: e.target.value }, dirty: true })}
            style={{ padding: 2, height: 28 }}
          />
          <button
            className="btn sm ghost"
            onClick={() => useStore.setState({ doc: { ...doc, background: undefined }, dirty: true })}
            title="테마 기본 배경으로"
          >
            초기화
          </button>
        </div>
      </div>

      {!doc.editable && (
        <div className="insp-section">
          <h4>이 종류는 코드로 편집합니다</h4>
          <p className="muted" style={{ lineHeight: 1.7, margin: 0 }}>
            시퀀스·간트·마인드맵 같은 종류는 캔버스에서 직접 옮길 수 없습니다.<br />
            왼쪽 코드창을 고치면 그림이 바뀝니다. 확대·축소와 내보내기는 똑같이 됩니다.<br /><br />
            도형을 마우스로 옮기고 싶다면 <b>flowchart</b> 로 만드세요.
          </p>
        </div>
      )}

      {doc.editable && (
      <div className="insp-section">
        <h4>도형 추가</h4>
        <div className="shape-grid">
          {(['rect', 'round', 'stadium', 'circle', 'diamond', 'hexagon', 'cylinder', 'parallelogram', 'document', 'note', 'person', 'cloud'] as ShapeKind[]).map(s => (
            <button
              key={s}
              className="shape-btn"
              title={SHAPE_LABELS[s] + ' 추가'}
              onClick={() => {
                const st = useStore.getState()
                const stage = document.querySelector('.stage')?.getBoundingClientRect()
                const v = st.viewport
                const center = stage
                  ? { x: (stage.width / 2 - v.x) / v.zoom, y: (stage.height / 2 - v.y) / v.zoom }
                  : { x: 0, y: 0 }
                const id = st.addNode(center, { shape: s })
                st.setEditing({ id })
              }}
            >
              <ShapeIcon shape={s} />
            </button>
          ))}
        </div>
      </div>
      )}

      {doc.editable && (
      <div className="insp-section">
        <h4>내용</h4>
        <div className="insp-row">
          <span className="muted">도형 {count}개 · 연결선 {edgeCount}개</span>
        </div>
        <div className="insp-row">
          <span className="muted" style={{ lineHeight: 1.6 }}>
            캔버스를 더블클릭하면 도형이 생깁니다. 도형에 마우스를 올린 뒤 파란 점을 끌면 연결선이 만들어집니다.
          </span>
        </div>
      </div>
      )}
    </>
  )
}

// ── 텍스트 ──────────────────────────────────────────────────────────
function TextSection({ el }: { el: SceneElement }) {
  const setText = useStore(s => s.setText)
  const commit = useStore(s => s.commit)
  const sync = useStore(s => s.syncCodeFromScene)
  const value = el.kind === 'group' ? el.title : el.kind === 'edge' ? el.label : 'text' in el ? el.text : ''

  return (
    <div className="insp-section">
      <h4>{el.kind === 'group' ? '그룹 이름' : el.kind === 'edge' ? '연결선 라벨' : '텍스트'}</h4>
      <textarea
        className="field"
        rows={2}
        value={value}
        onFocus={() => commit()}
        onChange={e => setText(el.id, e.target.value)}
        onBlur={() => {
          if (el.kind === 'node' || el.kind === 'text') useStore.getState().autoSizeNode(el.id)
          sync()
        }}
        placeholder="내용을 입력하세요"
      />
      {el.kind === 'node' && (
        <div className="insp-row" style={{ marginTop: 7 }}>
          <span className="insp-label"><Link2 size={12} /></span>
          <input
            className="field"
            placeholder="링크 (선택)"
            value={el.link ?? ''}
            onChange={e => useStore.getState().updateElement(el.id, { link: e.target.value || undefined } as Partial<SceneElement>)}
          />
        </div>
      )}
    </div>
  )
}

// ── 도형 ────────────────────────────────────────────────────────────
function ShapeSection({ nodes }: { nodes: NodeElement[] }) {
  const setShape = useStore(s => s.setShape)
  const current = nodes[0].shape
  const ids = nodes.map(n => n.id)
  return (
    <div className="insp-section">
      <h4>도형</h4>
      {SHAPE_GROUPS.map(g => (
        <div key={g.title} style={{ marginBottom: 8 }}>
          <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>{g.title}</div>
          <div className="shape-grid">
            {g.shapes.map(s => (
              <button
                key={s}
                className={'shape-btn' + (current === s ? ' active' : '')}
                title={SHAPE_LABELS[s]}
                onClick={() => setShape(ids, s)}
              >
                <ShapeIcon shape={s} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function ShapeIcon({ shape, size = 18 }: { shape: ShapeKind; size?: number }) {
  const def = SHAPES[shape] ?? SHAPES.rect
  const w = size
  const h = size * 0.72
  const d = shape === 'text' ? '' : def.path(w, h, 3)
  const decor = def.decor?.(w, h) ?? []
  return (
    <svg width={size + 4} height={size} viewBox={`${-(size + 4) / 2} ${-size / 2} ${size + 4} ${size}`}>
      {shape === 'text' ? (
        <text x={0} y={3} textAnchor="middle" fontSize={11} fill="currentColor" fontWeight={700}>T</text>
      ) : (
        <>
          <path d={d} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
          {decor.map((dd, i) => <path key={i} d={dd} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.75} />)}
        </>
      )}
    </svg>
  )
}

// ── 스타일 ──────────────────────────────────────────────────────────
function StyleSection({ ids, sample }: { ids: string[]; sample: NodeStyle }) {
  const setNodeStyle = useStore(s => s.setNodeStyle)
  return (
    <div className="insp-section">
      <h4>색과 선</h4>

      <div className="insp-row">
        <span className="insp-label">프리셋</span>
      </div>
      <div className="preset-grid" style={{ marginBottom: 10 }}>
        {NODE_PRESETS.map(p => (
          <button
            key={p.name}
            className="preset-btn"
            style={{
              background: p.style.fill ?? 'var(--panel-2)',
              color: p.style.color ?? 'var(--text-dim)',
              borderColor: p.style.stroke ?? 'var(--line)',
            }}
            onClick={() => setNodeStyle(ids, Object.keys(p.style).length ? p.style : resetStyle())}
            title={p.name}
          >
            {p.name}
          </button>
        ))}
      </div>

      <ColorRow label="채우기" value={sample.fill} swatches={SWATCHES.fill} onPick={v => setNodeStyle(ids, { fill: v })} />
      <ColorRow label="테두리" value={sample.stroke} swatches={SWATCHES.stroke} onPick={v => setNodeStyle(ids, { stroke: v })} />
      <ColorRow label="글자" value={sample.color} swatches={SWATCHES.text} onPick={v => setNodeStyle(ids, { color: v })} />

      <div className="insp-row" style={{ marginTop: 9 }}>
        <span className="insp-label">선 굵기</span>
        <input
          className="field"
          type="range"
          min={0}
          max={8}
          step={0.5}
          value={sample.strokeWidth}
          onChange={e => setNodeStyle(ids, { strokeWidth: Number(e.target.value) })}
          style={{ padding: 0 }}
        />
        <span className="mono" style={{ width: 26, textAlign: 'right' }}>{sample.strokeWidth}</span>
      </div>

      <div className="insp-row">
        <span className="insp-label">선 종류</span>
        <div className="seg">
          {(['solid', 'dashed', 'dotted'] as const).map(s => (
            <button key={s} className={sample.strokeStyle === s ? 'active' : ''} onClick={() => setNodeStyle(ids, { strokeStyle: s })}>
              {{ solid: '실선', dashed: '파선', dotted: '점선' }[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="insp-row">
        <span className="insp-label">모서리</span>
        <input
          className="field"
          type="range"
          min={0}
          max={40}
          value={sample.radius}
          onChange={e => setNodeStyle(ids, { radius: Number(e.target.value) })}
          style={{ padding: 0 }}
        />
        <span className="mono" style={{ width: 26, textAlign: 'right' }}>{sample.radius}</span>
      </div>

      <div className="insp-row">
        <span className="insp-label">투명도</span>
        <input
          className="field"
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={sample.opacity}
          onChange={e => setNodeStyle(ids, { opacity: Number(e.target.value) })}
          style={{ padding: 0 }}
        />
        <span className="mono" style={{ width: 26, textAlign: 'right' }}>{Math.round(sample.opacity * 100)}</span>
      </div>

      <div className="insp-row">
        <label className="check">
          <input type="checkbox" checked={!!sample.shadow} onChange={e => setNodeStyle(ids, { shadow: e.target.checked })} />
          그림자
        </label>
      </div>
    </div>
  )
}

function resetStyle(): Partial<NodeStyle> {
  const theme = getTheme(useStore.getState().doc.themeId)
  return { ...theme.node }
}

function ColorRow({
  label, value, swatches, onPick,
}: { label: string; value: string; swatches: string[]; onPick: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div className="insp-row">
        <span className="insp-label">{label}</span>
        <input
          className="field"
          type="color"
          value={toHex(value)}
          onChange={e => onPick(e.target.value)}
          style={{ padding: 2, height: 26, width: 44, flex: '0 0 44px' }}
          title="직접 고르기"
        />
        <input
          className="field mono"
          value={value}
          onChange={e => onPick(e.target.value)}
          spellCheck={false}
          style={{ height: 26 }}
        />
      </div>
      <div className="swatches">
        {swatches.map(c => (
          <button
            key={c}
            className={'swatch' + (c === 'transparent' ? ' none' : '') + (c === value ? ' active' : '')}
            style={c === 'transparent' ? undefined : { background: c }}
            onClick={() => onPick(c)}
            title={c === 'transparent' ? '없음' : c}
          />
        ))}
      </div>
    </div>
  )
}

// ── 글꼴 ────────────────────────────────────────────────────────────
function TypographySection({ ids, sample }: { ids: string[]; sample: NodeStyle }) {
  const setNodeStyle = useStore(s => s.setNodeStyle)
  return (
    <div className="insp-section">
      <h4>글꼴</h4>
      <div className="insp-row">
        <span className="insp-label">크기</span>
        <input
          className="field"
          type="number"
          min={7}
          max={96}
          value={sample.fontSize}
          onChange={e => setNodeStyle(ids, { fontSize: Number(e.target.value) || 14 })}
        />
        <button
          className={'btn icon sm' + (sample.fontWeight >= 700 ? ' primary' : '')}
          onClick={() => setNodeStyle(ids, { fontWeight: sample.fontWeight >= 700 ? 500 : 700 })}
          title="굵게"
        >
          <Bold size={13} />
        </button>
        <button
          className={'btn icon sm' + (sample.italic ? ' primary' : '')}
          onClick={() => setNodeStyle(ids, { italic: !sample.italic })}
          title="기울임"
        >
          <Italic size={13} />
        </button>
      </div>
      <div className="insp-row">
        <span className="insp-label">가로</span>
        <div className="seg">
          {(['left', 'center', 'right'] as const).map(a => (
            <button key={a} className={sample.align === a ? 'active' : ''} onClick={() => setNodeStyle(ids, { align: a })} title={a}>
              {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
            </button>
          ))}
        </div>
      </div>
      <div className="insp-row">
        <span className="insp-label">세로</span>
        <div className="seg">
          {(['top', 'middle', 'bottom'] as const).map(a => (
            <button key={a} className={sample.valign === a ? 'active' : ''} onClick={() => setNodeStyle(ids, { valign: a })}>
              {{ top: '위', middle: '가운데', bottom: '아래' }[a]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 연결선 ──────────────────────────────────────────────────────────
const MARKERS: { id: MarkerKind; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'arrow', label: '화살표' },
  { id: 'arrowOpen', label: '열린 화살표' },
  { id: 'circle', label: '원' },
  { id: 'cross', label: '×' },
  { id: 'diamond', label: '다이아' },
  { id: 'diamondFilled', label: '다이아(채움)' },
]

function EdgeSection({ edges }: { edges: EdgeElement[] }) {
  const ids = edges.map(e => e.id)
  const e0 = edges[0]
  const setEdgeStyle = useStore(s => s.setEdgeStyle)
  const setRouting = useStore(s => s.setEdgeRouting)
  const setMarker = useStore(s => s.setEdgeMarker)

  return (
    <div className="insp-section">
      <h4>연결선</h4>

      {edges.length === 1 && (
        <div className="insp-row">
          <span className="insp-label">라벨</span>
          <input
            className="field"
            value={e0.label}
            onFocus={() => useStore.getState().commit()}
            onChange={ev => useStore.getState().setText(e0.id, ev.target.value)}
            onBlur={() => useStore.getState().syncCodeFromScene()}
            placeholder="선 위에 표시할 글자"
          />
        </div>
      )}

      <div className="insp-row">
        <span className="insp-label">모양</span>
        <div className="seg">
          {(['straight', 'orthogonal', 'curved'] as const).map(r => (
            <button key={r} className={e0.routing === r ? 'active' : ''} onClick={() => setRouting(ids, r)}>
              {{ straight: '직선', orthogonal: '직각', curved: '곡선' }[r]}
            </button>
          ))}
        </div>
      </div>
      {e0.routing === 'custom' && (
        <div className="insp-row">
          <span className="muted" style={{ fontSize: 11 }}>
            경유점이 있는 선입니다. 선을 더블클릭하면 점이 추가됩니다.
          </span>
        </div>
      )}

      <div className="insp-row">
        <span className="insp-label">시작</span>
        <select className="field" value={e0.startMarker} onChange={ev => setMarker(ids, 'start', ev.target.value as MarkerKind)}>
          {MARKERS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <div className="insp-row">
        <span className="insp-label">끝</span>
        <select className="field" value={e0.endMarker} onChange={ev => setMarker(ids, 'end', ev.target.value as MarkerKind)}>
          {MARKERS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <ColorRow label="선 색" value={e0.style.stroke} swatches={SWATCHES.stroke} onPick={v => setEdgeStyle(ids, { stroke: v })} />

      <div className="insp-row">
        <span className="insp-label">굵기</span>
        <input
          className="field"
          type="range"
          min={0.5}
          max={8}
          step={0.5}
          value={e0.style.strokeWidth}
          onChange={ev => setEdgeStyle(ids, { strokeWidth: Number(ev.target.value) })}
          style={{ padding: 0 }}
        />
        <span className="mono" style={{ width: 26, textAlign: 'right' }}>{e0.style.strokeWidth}</span>
      </div>

      <div className="insp-row">
        <span className="insp-label">선 종류</span>
        <div className="seg">
          {(['solid', 'dashed', 'dotted'] as const).map(s => (
            <button key={s} className={e0.style.strokeStyle === s ? 'active' : ''} onClick={() => setEdgeStyle(ids, { strokeStyle: s })}>
              {{ solid: '실선', dashed: '파선', dotted: '점선' }[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="insp-row">
        <span className="insp-label">글자</span>
        <input
          className="field"
          type="number"
          min={7}
          max={40}
          value={e0.style.fontSize}
          onChange={ev => setEdgeStyle(ids, { fontSize: Number(ev.target.value) || 12 })}
        />
        <input
          className="field"
          type="color"
          value={toHex(e0.style.color)}
          onChange={ev => setEdgeStyle(ids, { color: ev.target.value })}
          style={{ padding: 2, height: 28, width: 44, flex: '0 0 44px' }}
        />
      </div>
    </div>
  )
}

// ── 위치·크기 ───────────────────────────────────────────────────────
function GeometrySection({ el }: { el: NodeElement | GroupElement | TextElement | SceneElement }) {
  if (!isBox(el)) return null
  const update = useStore.getState().updateElement
  const num = (v: string) => Math.round(Number(v) || 0)
  return (
    <div className="insp-section">
      <h4>위치와 크기</h4>
      <div className="insp-row">
        <span className="insp-label">X</span>
        <input className="field" type="number" value={Math.round(el.x)} onChange={e => update(el.id, { x: num(e.target.value), pinned: true } as Partial<SceneElement>)} />
        <span className="insp-label" style={{ width: 14, textAlign: 'center' }}>Y</span>
        <input className="field" type="number" value={Math.round(el.y)} onChange={e => update(el.id, { y: num(e.target.value), pinned: true } as Partial<SceneElement>)} />
      </div>
      <div className="insp-row">
        <span className="insp-label">너비</span>
        <input className="field" type="number" min={16} value={Math.round(el.w)} onChange={e => update(el.id, { w: Math.max(16, num(e.target.value)), pinned: true } as Partial<SceneElement>)} />
        <span className="insp-label" style={{ width: 14, textAlign: 'center' }}>높이</span>
        <input className="field" type="number" min={12} value={Math.round(el.h)} onChange={e => update(el.id, { h: Math.max(12, num(e.target.value)), pinned: true } as Partial<SceneElement>)} />
      </div>
      {(el.kind === 'node' || el.kind === 'text') && (
        <div className="insp-row">
          <button className="btn sm" onClick={() => useStore.getState().autoSizeNode(el.id)} title="글자에 맞게 크기 조절">
            <ChevronsLeftRight size={12} /> 내용에 맞춤
          </button>
        </div>
      )}
    </div>
  )
}

// ── 정렬 ────────────────────────────────────────────────────────────
function ArrangeSection({ ids }: { ids: string[] }) {
  const align = useStore(s => s.align)
  const distribute = useStore(s => s.distribute)
  const matchSize = useStore(s => s.matchSize)
  return (
    <div className="insp-section">
      <h4>정렬 · 배치 ({ids.length}개 선택)</h4>
      <div className="insp-row">
        <div className="seg">
          <button onClick={() => align(ids, 'left')} title="왼쪽 맞춤"><AlignLeft size={13} /></button>
          <button onClick={() => align(ids, 'hcenter')} title="가로 가운데"><AlignHorizontalJustifyCenter size={13} /></button>
          <button onClick={() => align(ids, 'right')} title="오른쪽 맞춤"><AlignRight size={13} /></button>
        </div>
        <div className="seg">
          <button onClick={() => align(ids, 'top')} title="위 맞춤"><AlignStartHorizontal size={13} /></button>
          <button onClick={() => align(ids, 'vcenter')} title="세로 가운데"><AlignVerticalJustifyCenter size={13} /></button>
          <button onClick={() => align(ids, 'bottom')} title="아래 맞춤"><AlignEndHorizontal size={13} /></button>
        </div>
      </div>
      <div className="insp-row">
        <button className="btn sm" onClick={() => distribute(ids, 'h')} title="가로 간격 균등"><ArrowLeftRight size={12} /> 가로 균등</button>
        <button className="btn sm" onClick={() => distribute(ids, 'v')} title="세로 간격 균등"><ArrowDownUp size={12} /> 세로 균등</button>
      </div>
      <div className="insp-row">
        <button className="btn sm" onClick={() => matchSize(ids, 'w')}>너비 맞춤</button>
        <button className="btn sm" onClick={() => matchSize(ids, 'h')}>높이 맞춤</button>
        <button className="btn sm" onClick={() => matchSize(ids, 'both')}>둘 다</button>
      </div>
    </div>
  )
}

// ── 동작 ────────────────────────────────────────────────────────────
function ActionsSection({ ids }: { ids: string[] }) {
  const st = useStore.getState()
  const locked = useStore(s => ids.every(id => s.doc.elements[id]?.locked))
  return (
    <div className="insp-section">
      <h4>동작</h4>
      <div className="insp-row">
        <button className="btn sm" onClick={() => st.reorder(ids, 'front')} title="맨 앞으로 (⇧⌘])"><MoveUp size={12} /> 맨 앞</button>
        <button className="btn sm" onClick={() => st.reorder(ids, 'back')} title="맨 뒤로 (⇧⌘[)"><MoveDown size={12} /> 맨 뒤</button>
      </div>
      <div className="insp-row">
        <button className="btn sm" onClick={() => st.groupSelection(ids)} title="그룹 만들기 (⌘G)">그룹 만들기</button>
        <button className="btn sm" onClick={() => st.ungroup(ids)} title="그룹 해제 (⇧⌘G)">해제</button>
      </div>
      <div className="insp-row">
        <button className="btn sm" onClick={() => ids[0] && st.copyStyle(ids[0])} title="서식 복사"><Paintbrush size={12} /> 서식 복사</button>
        <button className="btn sm" onClick={() => st.pasteStyle(ids)} title="서식 붙여넣기"><Brush size={12} /> 붙여넣기</button>
      </div>
      <div className="insp-row">
        <button
          className="btn sm"
          onClick={() => st.updateElements(ids, () => ({ locked: !locked }))}
          title={locked ? '잠금 해제' : '잠그기'}
        >
          {locked ? <Unlock size={12} /> : <Lock size={12} />} {locked ? '잠금 해제' : '잠그기'}
        </button>
        <button className="btn sm" onClick={() => st.duplicate(ids)} title="복제 (⌘D)"><Copy size={12} /> 복제</button>
      </div>
      <div className="insp-row">
        <button className="btn sm danger" onClick={() => st.deleteElements(ids)} title="삭제 (⌫)" style={{ flex: 1 }}>
          <Trash2 size={12} /> 삭제
        </button>
      </div>
    </div>
  )
}

// ── 유틸 ────────────────────────────────────────────────────────────
function toHex(color: string): string {
  if (!color || color === 'transparent' || color === 'none') return '#000000'
  if (color.startsWith('#')) {
    if (color.length === 4) return '#' + color.slice(1).split('').map(c => c + c).join('')
    return color.slice(0, 7)
  }
  // rgb(a) 표기를 hex 로
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b] = m[1].split(',').map(v => Math.round(parseFloat(v)))
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v || 0)).toString(16).padStart(2, '0')).join('')
  }
  return '#000000'
}
