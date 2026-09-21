/**
 * 설정 + Obsidian 저장.
 *
 * 저장 로직을 설정 화면과 같은 파일에 둔 이유: 노트의 모양(임베드 형식, 편집 상태 포함 여부,
 * 폴더)이 전부 이 화면의 값으로 결정된다. 둘이 떨어져 있으면 "설정은 바꿨는데 저장 결과가
 * 그대로"인 어긋남이 반드시 생긴다.
 *
 * 저장 규칙
 *  - 첨부(svg/png)를 먼저 만들고, 만들지 못하면 mermaid 코드블록으로 내려앉는다.
 *    없는 첨부를 가리키는 `![[...]]` 를 노트에 남기지 않기 위해서다.
 *  - 서버가 꺼져 있으면 그 사실을 문구로 말한다. 조용히 실패하지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check, Code, ExternalLink, FolderOpen, Grid3x3, HardDrive, Info,
  Magnet, Map, Palette, RefreshCw, Server, Settings, X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, ApiError } from '../../core/api'
import type { AppConfig, VaultInfo } from '../../core/api'
import { buildNote, encodeDocPayload, noteFileName } from '../../core/obsidian'
import type { NoteOptions } from '../../core/obsidian'
import { blobToBase64, buildPngBlob, buildSvgString } from '../../core/export/exporter'
import { THEMES } from '../../core/theme'

type EmbedFormat = AppConfig['obsidian']['embedFormat']
type ObsidianConfig = AppConfig['obsidian']
type DirEntry = { name: string; rel: string }

const MANUAL = '__manual__'
const AUTO_VAULT = ''

/** 글자 사이에 끼는 작은 아이콘의 세로 정렬 */
const ICON_INLINE = { verticalAlign: '-2px' } as const

const EMBED_OPTIONS: { value: EmbedFormat; label: string; title: string }[] = [
  { value: 'auto', label: '자동', title: '자유 편집이 있으면 이미지로, 아니면 mermaid 코드블록으로 저장합니다.' },
  { value: 'svg', label: 'SVG', title: '항상 SVG 첨부를 만들어 노트에 끼워 넣습니다. 글자가 선명합니다.' },
  { value: 'png', label: 'PNG', title: '항상 PNG 첨부를 만들어 노트에 끼워 넣습니다. 호환성이 넓습니다.' },
  { value: 'none', label: '없음', title: '첨부 없이 mermaid 코드블록만 저장합니다. Obsidian 이 직접 그립니다.' },
]

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return '파일 서버에 연결하지 못했습니다. 터미널에서 npm run dev 가 켜져 있는지 확인하세요.'
    return e.message || fallback
  }
  if (e instanceof Error && e.message) return e.message
  return fallback
}

// ── Obsidian 저장 ───────────────────────────────────────────────────

function openInObsidian(uri: string) {
  const win = window.open(uri, '_blank')
  if (!win) window.location.href = uri
}

/** 임베드 판단은 buildNote 안의 규칙과 반드시 같아야 한다. 어긋나면 깨진 링크가 남는다. */
function wantsImage(embed: EmbedFormat, freeEdits: boolean, editable: boolean): boolean {
  if (embed === 'svg' || embed === 'png') return true
  if (embed === 'auto') return freeEdits || !editable
  return false
}

let saving = false

async function runObsidianSave(auto: boolean): Promise<void> {
  if (saving) return
  saving = true
  try {
    let cfg: AppConfig
    try {
      cfg = (await api.getConfig()).config
    } catch (e) {
      if (auto) return
      useStore.getState().toast('error', errorText(e, 'Obsidian 설정을 읽지 못했습니다.'))
      return
    }

    const o = cfg.obsidian
    if (auto && (!o.autoSave || o.enabled === false)) return

    const doc = useStore.getState().doc
    if (!doc.order.length && !doc.code.trim() && !doc.nativeSvg) {
      if (!auto) useStore.getState().toast('warn', '저장할 내용이 없습니다.')
      return
    }

    const format: 'svg' | 'png' = o.embedFormat === 'png' ? 'png' : 'svg'
    const attachments: { name: string; text?: string; base64?: string }[] = []
    let embed: NoteOptions['embed'] = o.embedFormat
    let attachmentName: string | undefined
    let degraded = false

    if (wantsImage(o.embedFormat, doc.freeEdits, doc.editable)) {
      const name = noteFileName(doc.title) + '.' + format
      try {
        if (format === 'svg') {
          attachments.push({ name, text: buildSvgString(doc, { background: 'theme' }) })
        } else {
          attachments.push({ name, base64: await blobToBase64(await buildPngBlob(doc, { background: 'theme' })) })
        }
        attachmentName = name
      } catch {
        // 이미지를 못 만들면 노트만이라도 남긴다. 깨진 임베드보다 낫다.
        degraded = true
        embed = 'none'
      }
    }

    const encodedData = o.includeLayout ? await encodeDocPayload(doc) : undefined
    const markdown = buildNote(doc, {
      encodedData,
      embed,
      attachmentName,
      includeData: o.includeLayout,
      attachmentFolder: o.attachmentFolder || undefined,
    })

    try {
      const res = await api.obsidianSave({
        vaultPath: o.vaultPath || undefined,
        folder: o.folder,
        attachmentFolder: o.attachmentFolder,
        title: doc.title || '다이어그램',
        markdown,
        attachments,
        overwrite: true,
      })
      const st = useStore.getState()
      st.markSaved({ vault: res.vaultPath, note: res.notePath })
      st.toast('success', `Obsidian 에 저장했습니다 — ${res.relative}`, {
        label: 'Obsidian 에서 열기',
        run: () => openInObsidian(res.obsidianUri),
      })
      if (degraded) st.toast('warn', '이미지를 만들지 못해 mermaid 코드로 저장했습니다.')
    } catch (e) {
      useStore.getState().toast('error', 'Obsidian 저장 실패 — ' + errorText(e, '알 수 없는 오류'))
    }
  } finally {
    saving = false
  }
}

/** 단축키(Cmd+Shift+S)와 명령 팔레트가 부르는 진입점. */
export async function saveToObsidian(): Promise<void> {
  await runObsidianSave(false)
}

// 모듈은 한 번만 평가되지만, HMR 로 다시 평가되면 리스너가 겹친다. window 에 표시를 남긴다.
interface BoundWindow extends Window {
  __dgmObsidianBound?: boolean
}

if (typeof window !== 'undefined') {
  const w = window as BoundWindow
  if (!w.__dgmObsidianBound) {
    w.__dgmObsidianBound = true
    w.addEventListener('dgm:save-obsidian', () => { void runObsidianSave(false) })
    // "저장할 때마다 자동으로 vault 에도 기록" 설정이 켜져 있을 때만 동작한다
    w.addEventListener('dgm:save-library', () => { void runObsidianSave(true) })
  }
}

// ── 설정 화면 ───────────────────────────────────────────────────────

export function SettingsPanel() {
  const ui = useStore(s => s.ui)
  const themeId = useStore(s => s.doc.themeId)

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [vaults, setVaults] = useState<VaultInfo[]>([])
  const [dirs, setDirs] = useState<DirEntry[]>([])
  const [dataDir, setDataDir] = useState('')
  const [online, setOnline] = useState<boolean | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)

  const pending = useRef<Partial<AppConfig>>({})
  const saveTimer = useRef<number | undefined>(undefined)
  const flashTimer = useRef<number | undefined>(undefined)

  const close = useCallback(() => useStore.getState().setUI({ settingsOpen: false }), [])

  // ── 저장(디바운스 400ms) ──
  const flash = useCallback(() => {
    setSaved(true)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setSaved(false), 1600)
  }, [])

  const flush = useCallback(async () => {
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length) return
    try {
      await api.patchConfig(patch)
      setOnline(true)
      setProblem(null)
      flash()
    } catch (e) {
      setOnline(false)
      setProblem(errorText(e, '설정을 저장하지 못했습니다.'))
    }
  }, [flash])

  const schedule = useCallback((patch: Partial<AppConfig>) => {
    // obsidian 은 항상 통째로 넣는다. 부분 병합을 두 군데서 하면 값이 엇갈린다.
    pending.current = { ...pending.current, ...patch }
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void flush() }, 400)
  }, [flush])

  // ── vault 안의 1단계 폴더 목록 ──
  const refreshDirs = useCallback(async (cfg: AppConfig, list: VaultInfo[]) => {
    const target = cfg.obsidian.vaultPath
    const detected = target ? list.find(v => v.path === target) : list.find(v => v.exists)
    // 감지된 vault 는 id 로 바로 조회할 수 있다. 직접 입력한 경로는 설정에 저장된 뒤에야 열린다.
    const root = detected ? 'vault:' + detected.id : target ? 'vault' : ''
    if (!root) {
      setDirs([])
      return
    }
    try {
      const r = await api.dirs(root, '')
      setDirs(r.dirs)
    } catch {
      setDirs([])
    }
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await api.getConfig()
      setConfig(r.config)
      setVaults(r.vaults)
      setDataDir(r.dataDir)
      setOnline(true)
      setProblem(null)
      setManual(!!r.config.obsidian.vaultPath && !r.vaults.some(v => v.path === r.config.obsidian.vaultPath))
      await refreshDirs(r.config, r.vaults)
    } catch (e) {
      setOnline(false)
      setProblem(errorText(e, '설정을 읽지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }, [refreshDirs])

  useEffect(() => { void load() }, [load])

  // ── 닫힐 때 남은 변경을 흘려보낸다 ──
  useEffect(() => () => {
    window.clearTimeout(saveTimer.current)
    window.clearTimeout(flashTimer.current)
    void flush()
  }, [flush])

  // ── Escape 로 닫기 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const setObsidian = useCallback((patch: Partial<ObsidianConfig>) => {
    if (!config) return
    const next: AppConfig = { ...config, obsidian: { ...config.obsidian, ...patch } }
    setConfig(next)
    schedule({ obsidian: next.obsidian })
  }, [config, schedule])

  /** vault 는 즉시 저장한다. 서버가 그 경로를 알아야 폴더 목록을 열어준다. */
  const chooseVault = useCallback(async (vaultPath: string) => {
    if (!config) return
    const next: AppConfig = { ...config, obsidian: { ...config.obsidian, vaultPath } }
    setConfig(next)
    window.clearTimeout(saveTimer.current)
    pending.current = {}
    setBusy(true)
    try {
      await api.patchConfig({ obsidian: next.obsidian })
      setOnline(true)
      setProblem(null)
      flash()
      await refreshDirs(next, vaults)
    } catch (e) {
      setOnline(false)
      setProblem(errorText(e, '설정을 저장하지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }, [config, flash, refreshDirs, vaults])

  const revealExportDir = useCallback(async () => {
    if (!config?.exportDir) return
    try {
      await api.reveal(config.exportDir)
    } catch (e) {
      useStore.getState().toast('error', errorText(e, '폴더를 열지 못했습니다.'))
    }
  }, [config])

  const o = config?.obsidian
  const effectiveVault = o?.vaultPath || vaults.find(v => v.exists)?.path || ''
  const currentVault = vaults.find(v => v.path === effectiveVault)
  const selectValue = manual ? MANUAL : (o?.vaultPath ?? AUTO_VAULT)

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <Settings size={16} />
          <h3>설정</h3>
          <span className="spacer" />
          {saved && <span className="badge accent">저장됨</span>}
          <button className="btn icon ghost" title="설정 다시 읽기" onClick={() => { void load() }}>
            <RefreshCw size={15} />
          </button>
          <button className="btn icon ghost" title="닫기 (Esc)" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {problem && (
            <div className="insp-section">
              <span className="badge warn">문제</span>{' '}
              <span className="muted">{problem}</span>
            </div>
          )}

          {!config ? (
            <p className="muted">{busy ? '설정을 읽는 중입니다…' : '설정을 읽지 못했습니다. 파일 서버가 꺼져 있을 수 있습니다.'}</p>
          ) : (
            <>
              {/* ── Obsidian ── */}
              <section className="insp-section">
                <h4>Obsidian</h4>

                <div className="form-row">
                  <label htmlFor="dgm-vault">보관함(vault)</label>
                  <select
                    id="dgm-vault"
                    className="field"
                    value={selectValue}
                    title="노트를 저장할 Obsidian 보관함"
                    onChange={e => {
                      const v = e.target.value
                      if (v === MANUAL) {
                        setManual(true)
                        return
                      }
                      setManual(false)
                      void chooseVault(v)
                    }}
                  >
                    {vaults.length > 0 && <option value={AUTO_VAULT}>자동 — 감지된 첫 보관함</option>}
                    {vaults.map(v => (
                      <option key={v.id} value={v.path}>
                        {v.name} — {v.path}
                      </option>
                    ))}
                    <option value={MANUAL}>직접 입력…</option>
                  </select>
                  {currentVault?.open && <span className="badge accent">현재 열려 있음</span>}
                  {currentVault && !currentVault.exists && <span className="badge warn">경로 없음</span>}
                </div>

                {(manual || vaults.length === 0) && (
                  <>
                    <div className="form-row">
                      <label htmlFor="dgm-vault-path">보관함 경로</label>
                      <input
                        id="dgm-vault-path"
                        className="field mono"
                        value={o?.vaultPath ?? ''}
                        placeholder="/Users/이름/Documents/보관함"
                        title="Obsidian 보관함의 절대 경로"
                        onChange={e => setObsidian({ vaultPath: e.target.value })}
                        onBlur={e => { void chooseVault(e.target.value.trim()) }}
                      />
                    </div>
                    <p className="form-hint">
                      {vaults.length === 0
                        ? 'Obsidian 보관함을 자동으로 찾지 못했습니다. 경로를 직접 적어 주세요. '
                        : ''}
                      입력한 경로는 설정에 저장된 뒤부터 쓸 수 있습니다. 실제로 없는 폴더이거나 Obsidian 에
                      등록되지 않은 경로면 서버가 저장을 거부합니다.
                    </p>
                  </>
                )}

                <div className="form-row">
                  <label htmlFor="dgm-folder">저장 폴더</label>
                  <input
                    id="dgm-folder"
                    className="field"
                    list="dgm-vault-dirs"
                    value={o?.folder ?? ''}
                    placeholder="다이어그램"
                    title="보관함 안에서 노트를 넣을 폴더 (상대 경로)"
                    onChange={e => setObsidian({ folder: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="dgm-attach">첨부 폴더</label>
                  <input
                    id="dgm-attach"
                    className="field"
                    list="dgm-vault-dirs"
                    value={o?.attachmentFolder ?? ''}
                    placeholder="노트와 같은 폴더"
                    title="이미지 첨부를 넣을 폴더. 비우면 노트와 같은 폴더에 둡니다."
                    onChange={e => setObsidian({ attachmentFolder: e.target.value })}
                  />
                </div>
                <datalist id="dgm-vault-dirs">
                  {dirs.map(d => <option key={d.rel} value={d.rel} />)}
                </datalist>
                <p className="form-hint">
                  비우면 노트와 같은 폴더에 첨부를 저장합니다.
                  {dirs.length === 0 && ' 보관함을 고르면 그 안의 폴더를 추천합니다.'}
                </p>

                <div className="form-row">
                  <label>임베드 형식</label>
                  <div className="seg">
                    {EMBED_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={o?.embedFormat === opt.value ? 'active' : ''}
                        title={opt.title}
                        onClick={() => setObsidian({ embedFormat: opt.value })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="form-hint">
                  {EMBED_OPTIONS.find(e => e.value === o?.embedFormat)?.title}
                </p>

                <div className="form-row">
                  <label>저장 방식</label>
                  <label className="check" title="좌표·색을 노트 안 %% 주석에 숨겨 저장합니다.">
                    <input
                      type="checkbox"
                      checked={!!o?.includeLayout}
                      onChange={e => setObsidian({ includeLayout: e.target.checked })}
                    />
                    편집 상태 함께 저장
                  </label>
                </div>
                <p className="form-hint">
                  켜면 노트 안 %% 주석에 좌표와 색이 같이 저장되어, 나중에 그 노트를 열면 지금 모습 그대로
                  이어서 편집할 수 있습니다. 읽기 화면에는 보이지 않습니다.
                </p>

                <div className="form-row">
                  <label />
                  <label className="check" title="Cmd+S 로 저장할 때 보관함에도 함께 씁니다.">
                    <input
                      type="checkbox"
                      checked={!!o?.autoSave}
                      onChange={e => setObsidian({ autoSave: e.target.checked })}
                    />
                    저장할 때마다 자동으로 vault 에도 기록
                  </label>
                </div>
                <p className="form-hint">
                  끄면 Cmd+Shift+S 를 눌렀을 때만 보관함에 기록합니다.
                </p>

                <div className="form-row">
                  <label />
                  <button
                    className="btn"
                    title="지금 열려 있는 다이어그램을 Obsidian 에 저장합니다"
                    onClick={() => { void saveToObsidian() }}
                  >
                    <ExternalLink size={14} /> 지금 저장하기
                  </button>
                </div>
              </section>

              {/* ── 내보내기 ── */}
              <section className="insp-section">
                <h4>내보내기</h4>
                <div className="form-row">
                  <label htmlFor="dgm-exportdir">기본 폴더</label>
                  <input
                    id="dgm-exportdir"
                    className="field mono"
                    value={config.exportDir}
                    placeholder="~/Downloads"
                    title="파일로 내보낼 때 기본으로 쓰는 폴더의 절대 경로"
                    onChange={e => {
                      setConfig({ ...config, exportDir: e.target.value })
                      schedule({ exportDir: e.target.value })
                    }}
                  />
                  <button className="btn icon" title="폴더 열기" onClick={() => { void revealExportDir() }}>
                    <FolderOpen size={14} />
                  </button>
                </div>
                <p className="form-hint">
                  서버를 거쳐 저장할 때 쓰는 폴더입니다. 브라우저 내려받기는 늘 브라우저 설정을 따릅니다.
                </p>
              </section>

              {/* ── 편집 ── */}
              <section className="insp-section">
                <h4>편집</h4>
                <div className="form-row">
                  <label>화면</label>
                  <label className="check" title="캔버스에 격자를 표시합니다">
                    <input
                      type="checkbox"
                      checked={ui.showGrid}
                      onChange={e => useStore.getState().setUI({ showGrid: e.target.checked })}
                    />
                    <Grid3x3 size={13} style={ICON_INLINE} /> 격자 표시
                  </label>
                  <label className="check" title="옮길 때 격자에 맞춰 붙입니다">
                    <input
                      type="checkbox"
                      checked={ui.snapEnabled}
                      onChange={e => useStore.getState().setUI({ snapEnabled: e.target.checked })}
                    />
                    <Magnet size={13} style={ICON_INLINE} /> 스냅
                  </label>
                </div>
                <div className="form-row">
                  <label />
                  <label className="check" title="오른쪽 아래 축소 지도를 보여줍니다">
                    <input
                      type="checkbox"
                      checked={ui.showMinimap}
                      onChange={e => useStore.getState().setUI({ showMinimap: e.target.checked })}
                    />
                    <Map size={13} style={ICON_INLINE} /> 미니맵
                  </label>
                  <label className="check" title="왼쪽 mermaid 코드 패널을 보여줍니다">
                    <input
                      type="checkbox"
                      checked={ui.showCode}
                      onChange={e => useStore.getState().setUI({ showCode: e.target.checked })}
                    />
                    <Code size={13} style={ICON_INLINE} /> 코드 패널
                  </label>
                </div>

                <div className="form-row">
                  <label htmlFor="dgm-theme">테마</label>
                  <select
                    id="dgm-theme"
                    className="field"
                    value={themeId}
                    title="다이어그램의 기본 색"
                    onChange={e => useStore.getState().setTheme(e.target.value)}
                  >
                    {THEMES.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <Palette size={14} className="muted" />
                </div>
                <p className="form-hint">
                  테마를 바꾸면 직접 고친 색은 그대로 두고 나머지만 다시 칠합니다.
                </p>
              </section>

              {/* ── 정보 ── */}
              <section className="insp-section">
                <h4>정보</h4>
                <div className="form-row">
                  <label><HardDrive size={13} style={ICON_INLINE} /> 데이터 폴더</label>
                  <span className="path-chip">{dataDir || '알 수 없음'}</span>
                </div>
                <div className="form-row">
                  <label><Server size={13} style={ICON_INLINE} /> 파일 서버</label>
                  {online === null ? (
                    <span className="badge">확인 중</span>
                  ) : online ? (
                    <span className="badge accent"><Check size={11} style={ICON_INLINE} /> 연결됨</span>
                  ) : (
                    <span className="badge warn">끊김</span>
                  )}
                  {online === false && (
                    <span className="muted">터미널에서 npm run dev 를 켜 주세요.</span>
                  )}
                </div>
                <p className="form-hint">
                  <Info size={11} style={ICON_INLINE} /> 라이브러리와 설정 파일은 모두 이 폴더 안에 있습니다. 보관함에 저장할 때
                  기존 파일은 덮어쓰기 전에 백업합니다.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted">{busy ? '처리 중…' : '변경한 값은 곧바로 저장됩니다.'}</span>
          <span className="spacer" />
          <button className="btn primary" title="설정 닫기 (Esc)" onClick={close}>닫기</button>
        </div>
      </div>
    </div>
  )
}
