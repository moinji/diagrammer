/**
 * 내보내기 대화상자.
 *
 * 원칙: 미리보기와 결과물은 같은 코드에서 나온다.
 * 미리보기는 buildSvgString 이 만든 문자열을 그대로 화면에 붙인다. 따로 그리지 않으므로
 * "미리보기와 파일이 다르다"는 사고가 구조적으로 불가능하다.
 *
 * 저장 경로는 셋이다.
 *  1) 다운로드      — 브라우저만으로 된다. 파일 서버가 꺼져 있어도 항상 동작한다.
 *  2) 클립보드      — 바로 붙여넣기.
 *  3) 폴더에 저장   — 로컬 파일 서버(api.save)로 exports 루트에 쓴다. 서버가 필요하다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Code, Copy, Download, FileImage, FileText, FolderOpen, LoaderCircle, Shapes, TriangleAlert, X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { Toast } from '../../store/useStore'
import { ApiError, api } from '../../core/api'
import type { BackgroundMode } from '../../core/export/exporter'
import {
  blobToBase64, buildHtmlString, buildPngBlob, buildSvgString, contentBox,
  copyPngToClipboard, copyTextToClipboard, downloadBlob, downloadText, safeFileName,
} from '../../core/export/exporter'
import { buildNote } from '../../core/obsidian'

type Fmt = 'png' | 'svg' | 'html' | 'md'

interface FormatMeta {
  id: Fmt
  label: string
  hint: string
  ext: string
  mime: string
  Icon: LucideIcon
}

const FORMATS: FormatMeta[] = [
  { id: 'png', label: 'PNG', hint: '어디에나 붙여넣기', ext: '.png', mime: 'image/png', Icon: FileImage },
  { id: 'svg', label: 'SVG', hint: '무한 확대·편집 가능', ext: '.svg', mime: 'image/svg+xml;charset=utf-8', Icon: Shapes },
  { id: 'html', label: 'HTML', hint: '열면 바로 팬/줌', ext: '.html', mime: 'text/html;charset=utf-8', Icon: Code },
  { id: 'md', label: 'Markdown', hint: 'Obsidian·GitHub 용', ext: '.md', mime: 'text/markdown;charset=utf-8', Icon: FileText },
]

const BACKGROUNDS: { id: BackgroundMode; label: string }[] = [
  { id: 'theme', label: '테마색' },
  { id: 'transparent', label: '투명' },
  { id: 'white', label: '흰색' },
  { id: 'dark', label: '어두움' },
]

const SCALES = [1, 2, 3, 4]

/** 진행 중인 동작. 버튼 하나만 "만드는 중…" 으로 바뀌도록 구분해 둔다. */
type Busy = 'download' | 'copy' | 'save' | null

function errText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '알 수 없는 오류가 발생했습니다.'
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function ExportDialog() {
  const doc = useStore(s => s.doc)

  const [fmt, setFmt] = useState<Fmt>('png')
  const [scale, setScale] = useState(2)
  const [background, setBackground] = useState<BackgroundMode>('theme')
  const [padding, setPadding] = useState(24)
  const [name, setName] = useState(() => safeFileName(doc.title))
  const [includeData, setIncludeData] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [exportDir, setExportDir] = useState<string | null>(null)
  const [serverDown, setServerDown] = useState(false)

  const meta = FORMATS.find(f => f.id === fmt) ?? FORMATS[0]
  const base = safeFileName(name)
  const fileName = base + meta.ext

  const close = useCallback(() => {
    useStore.getState().setUI({ exportOpen: false })
  }, [])

  const notify = useCallback((kind: Toast['kind'], text: string, action?: Toast['action']) => {
    useStore.getState().toast(kind, text, action)
  }, [])

  // 저장 폴더를 미리 보여준다. "어디에 떨어지는지 모르겠다"는 불안을 없앤다.
  useEffect(() => {
    let alive = true
    api.getConfig()
      .then(r => {
        if (!alive) return
        setExportDir(r.config.exportDir || null)
        setServerDown(false)
      })
      .catch(err => {
        if (alive && err instanceof ApiError && err.status === 0) setServerDown(true)
      })
    return () => { alive = false }
  }, [])

  // ── 미리보기 ──────────────────────────────────────────────────
  /**
   * buildSvgString 은 캔버스의 실제 DOM 을 복제한다.
   * 렌더 단계(useMemo)에서 읽으면 doc 은 새 값인데 DOM 은 아직 이전 문서라
   * '한 박자 뒤처진 그림' 이 나온다. 커밋 이후(useEffect)에 읽어야 한다.
   */
  const [preview, setPreview] = useState<{ svg: string | null; error: string | null }>({ svg: null, error: null })
  useEffect(() => {
    let alive = true
    // 다음 프레임까지 미뤄 캔버스가 새 문서로 다시 그려진 뒤에 복제한다
    const id = requestAnimationFrame(() => {
      if (!alive) return
      try {
        const raw = buildSvgString(doc, { padding, background })
        // HTML 파서는 XML 선언을 주석으로 삼킨다. 미리보기에서는 떼고 넣는다.
        setPreview({ svg: raw.replace(/^<\?xml[^?]*\?>\s*/, ''), error: null })
      } catch (err) {
        setPreview({ svg: null, error: errText(err) })
      }
    })
    return () => { alive = false; cancelAnimationFrame(id) }
  }, [doc, padding, background])

  const box = useMemo(() => contentBox(doc, padding), [doc, padding])
  const pixelW = Math.max(1, Math.round(box.w * scale))
  const pixelH = Math.max(1, Math.round(box.h * scale))
  const codeLines = (doc.code || '').trim() ? (doc.code || '').trim().split('\n').length : 0

  const sizeHint =
    fmt === 'png'
      ? `결과 크기 ${pixelW.toLocaleString()} × ${pixelH.toLocaleString()} px (${scale}배)`
      : fmt === 'md'
        ? codeLines > 0
          ? `mermaid 코드 ${codeLines}줄을 코드블록으로 담습니다.`
          : 'mermaid 코드가 비어 있어 제목과 머리말만 저장됩니다.'
        : `문서 크기 ${Math.round(box.w).toLocaleString()} × ${Math.round(box.h).toLocaleString()} px (벡터)`

  // ── 결과물 만들기 ────────────────────────────────────────────
  const buildText = useCallback((): string => {
    if (fmt === 'svg') return buildSvgString(doc, { padding, background })
    if (fmt === 'html') return buildHtmlString(doc, { padding, background })
    return buildNote(doc, { embed: 'none', includeData })
  }, [doc, fmt, padding, background, includeData])

  const download = useCallback(async () => {
    if (busy) return
    setBusy('download')
    try {
      if (fmt === 'png') {
        const blob = await buildPngBlob(doc, { padding, background, scale })
        downloadBlob(fileName, blob)
      } else {
        downloadText(fileName, buildText(), meta.mime)
      }
      notify('success', `내려받았습니다: ${fileName}`)
    } catch (err) {
      notify('error', errText(err))
    } finally {
      setBusy(null)
    }
  }, [busy, doc, fmt, padding, background, scale, fileName, meta.mime, buildText, notify])

  // 토스트 안의 "다운로드" 버튼은 나중에 눌린다. 그때의 최신 옵션으로 내보내야 하므로 ref 로 붙잡는다.
  const downloadRef = useRef(download)
  useEffect(() => { downloadRef.current = download })

  const copy = useCallback(async () => {
    if (busy) return
    setBusy('copy')
    try {
      // PNG 는 사용자 제스처 안에서 ClipboardItem 을 만들어야 한다(exporter 가 처리).
      if (fmt === 'png') await copyPngToClipboard(doc, { padding, background, scale })
      else await copyTextToClipboard(buildText())
      notify('success', fmt === 'png' ? '이미지를 클립보드에 복사했습니다.' : '텍스트를 클립보드에 복사했습니다.')
    } catch (err) {
      notify('error', errText(err))
    } finally {
      setBusy(null)
    }
  }, [busy, doc, fmt, padding, background, scale, buildText, notify])

  const saveToFolder = useCallback(async () => {
    if (busy) return
    setBusy('save')
    try {
      let text: string | undefined
      let base64: string | undefined
      if (fmt === 'png') {
        base64 = await blobToBase64(await buildPngBlob(doc, { padding, background, scale }))
      } else {
        text = buildText()
      }
      const res = await api.save({ root: 'exports', name: base, ext: meta.ext, text, base64 })
      setServerDown(false)
      notify('success', `저장했습니다: ${res.path}`, {
        label: 'Finder 에서 보기',
        run: () => {
          void api.reveal(res.path).catch(err => notify('error', errText(err)))
        },
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setServerDown(true)
        notify('error', '파일 서버가 꺼져 있습니다. 브라우저 다운로드로 저장하세요.', {
          label: '다운로드',
          run: () => { void downloadRef.current() },
        })
      } else {
        notify('error', errText(err))
      }
    } finally {
      setBusy(null)
    }
  }, [busy, doc, fmt, padding, background, scale, base, meta.ext, buildText, notify])

  // ── 단축키 ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 한글 조합 중 keydown 은 확정 입력이 아니다. 여기서 막지 않으면 조합 중 Enter 가 내려받는다.
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const el = e.target as HTMLElement | null
        if (el && el.tagName === 'TEXTAREA') return
        e.preventDefault()
        e.stopPropagation()
        void download()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, download])

  const working = busy !== null

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="내보내기"
      >
        <div className="modal-head">
          <h3>내보내기</h3>
          <span className="badge" title="현재 문서">{doc.title || '무제 다이어그램'}</span>
          <div className="spacer" />
          <button className="btn icon ghost" onClick={close} title="닫기 (Esc)" aria-label="닫기">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="fmt-grid" role="group" aria-label="파일 형식">
            {FORMATS.map(f => (
              <button
                key={f.id}
                className={'fmt-btn' + (f.id === fmt ? ' active' : '')}
                onClick={() => setFmt(f.id)}
                title={`${f.label} 형식으로 내보내기 — ${f.hint}`}
                aria-pressed={f.id === fmt}
              >
                <f.Icon size={18} />
                {f.label}
                <small>{f.hint}</small>
              </button>
            ))}
          </div>

          <div className={'export-preview' + (background === 'transparent' ? ' checker' : '')}>
            {preview.error ? (
              <div className="export-error">
                <TriangleAlert size={16} />
                <span>{preview.error}</span>
              </div>
            ) : (
              <div
                className="export-frame"
                aria-label="내보내기 미리보기"
                dangerouslySetInnerHTML={{ __html: preview.svg ?? '' }}
              />
            )}
          </div>

          <div className="divider" />

          {fmt === 'png' && (
            <div className="form-row">
              <label>배율</label>
              <div className="seg" role="group" aria-label="배율">
                {SCALES.map(s => (
                  <button
                    key={s}
                    className={s === scale ? 'active' : ''}
                    onClick={() => setScale(s)}
                    title={`${s}배 해상도로 내보내기`}
                    aria-pressed={s === scale}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-row">
            <label>배경</label>
            <div className="seg" role="group" aria-label="배경">
              {BACKGROUNDS.map(b => (
                <button
                  key={b.id}
                  className={b.id === background ? 'active' : ''}
                  onClick={() => setBackground(b.id)}
                  title={`배경을 ${b.label}으로`}
                  aria-pressed={b.id === background}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="export-padding">여백 (px)</label>
            <input
              id="export-padding"
              className="field"
              type="number"
              min={0}
              max={200}
              step={2}
              value={padding}
              style={{ width: 92, flex: 'none' }}
              title="다이어그램 가장자리에 남길 빈 공간"
              onChange={e => {
                const v = Number(e.target.value)
                setPadding(Number.isFinite(v) ? clamp(Math.round(v), 0, 200) : 0)
              }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>{sizeHint}</span>
          </div>

          <div className="form-row">
            <label htmlFor="export-name">파일 이름</label>
            <input
              id="export-name"
              className="field"
              value={name}
              autoFocus
              title="저장할 파일 이름"
              onChange={e => setName(e.target.value)}
            />
            <span className="badge mono" title="확장자">{meta.ext}</span>
          </div>

          {fmt === 'md' && (
            <label className="check" title="노트에 편집 상태를 숨겨 넣습니다. 다이아그래머에서 다시 열면 그대로 편집됩니다.">
              <input
                type="checkbox"
                checked={includeData}
                onChange={e => setIncludeData(e.target.checked)}
              />
              편집 데이터 포함 — 나중에 다시 열어 편집
            </label>
          )}
        </div>

        <div className="modal-foot">
          {serverDown ? (
            <span className="badge warn" title="터미널에서 npm run dev 가 켜져 있는지 확인하세요.">파일 서버 꺼짐</span>
          ) : exportDir ? (
            <span
              className="path-chip"
              title={`폴더에 저장 위치: ${exportDir}`}
              style={{ maxWidth: 230, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {exportDir}
            </span>
          ) : null}

          <div className="spacer" />

          <button className="btn" onClick={() => void copy()} disabled={working} title="클립보드로 복사">
            {busy === 'copy' ? <LoaderCircle size={14} className="export-spin" /> : <Copy size={14} />}
            {busy === 'copy' ? '만드는 중…' : '클립보드로 복사'}
          </button>

          <button className="btn" onClick={() => void saveToFolder()} disabled={working} title={exportDir ? `${exportDir} 에 저장` : '내보내기 폴더에 저장'}>
            {busy === 'save' ? <LoaderCircle size={14} className="export-spin" /> : <FolderOpen size={14} />}
            {busy === 'save' ? '만드는 중…' : '폴더에 저장'}
          </button>

          <button className="btn primary" onClick={() => void download()} disabled={working} title="다운로드 (Enter)">
            {busy === 'download' ? <LoaderCircle size={14} className="export-spin" /> : <Download size={14} />}
            {busy === 'download' ? '만드는 중…' : '다운로드'}
          </button>
        </div>
      </div>
    </div>
  )
}
