/**
 * Obsidian 노트 만들기.
 *
 * 목표는 두 가지고, 둘 다 포기하지 않는다.
 *  1) Obsidian 에서 보기 좋을 것 — mermaid 코드블록은 Obsidian 이 직접 렌더링한다.
 *  2) 다시 열어 편집할 수 있을 것 — 좌표·색 같은 편집 상태를 잃지 않아야 한다.
 *
 * 2번을 위해 편집 상태를 %% ... %% 주석 안에 숨긴다. Obsidian 은 이 구간을
 * 읽기 모드에서 렌더링하지 않으므로 노트는 깨끗하게 보이고, 데이터는 파일에 남는다.
 * (Excalidraw 플러그인이 쓰는 것과 같은 방식이다.)
 */
import type { SceneDoc } from './types'
import { stripLayoutComment } from './mermaid/emitter'

export const DATA_MARK_START = '%%다이아그래머-데이터'
export const DATA_MARK_END = '%%'
/** 압축 페이로드임을 알리는 접두사. 이게 없으면 평문 JSON 으로 읽는다. */
const GZIP_PREFIX = 'dgz1:'

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 편집 상태를 노트에 넣을 문자열로 만든다.
 *
 * gzip + base64 를 쓰는 이유는 크기보다 **안전** 쪽이 크다.
 *  - 평문 JSON 을 넣으면 Obsidian 전역 검색이 이 덩어리에 계속 걸린다.
 *  - 사용자가 라벨에 '100%%' 같은 글자를 쓰면 %% 주석이 그 자리에서 끝나버려
 *    데이터가 노트 본문에 그대로 노출된다. base64 문자집합에는 % 가 없어 이 문제가 사라진다.
 * CompressionStream 이 없는 환경에서는 평문으로 되돌아간다(읽기는 양쪽 다 지원).
 */
export async function encodeDocPayload(doc: SceneDoc): Promise<string> {
  const json = JSON.stringify(serializableDoc(doc))
  try {
    const CS = (globalThis as any).CompressionStream
    if (!CS) return json
    const stream = new Blob([json]).stream().pipeThrough(new CS('gzip'))
    const buf = new Uint8Array(await new Response(stream).arrayBuffer())
    return GZIP_PREFIX + bytesToBase64(buf)
  } catch {
    return json
  }
}

/** 해제 후 허용할 최대 크기. 압축폭탄으로 탭을 멈추게 하지 않기 위한 상한. */
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024
const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024

export async function decodeDocPayload(payload: string): Promise<SceneDoc | null> {
  const text = payload.trim()
  try {
    if (text.startsWith(GZIP_PREFIX)) {
      const DS = (globalThis as any).DecompressionStream
      if (!DS) return null
      const bytes = base64ToBytes(text.slice(GZIP_PREFIX.length))
      if (bytes.length > MAX_COMPRESSED_BYTES) return null
      const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DS('gzip'))
      // 스트림을 조금씩 읽으며 상한을 넘으면 즉시 중단한다 (전부 받고 나서 재는 것은 늦다)
      const reader = (stream as ReadableStream<Uint8Array>).getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done || !value) break
        total += value.byteLength
        if (total > MAX_PAYLOAD_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
      const merged = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { merged.set(c, off); off += c.byteLength }
      return sanitizeLoadedDoc(JSON.parse(new TextDecoder().decode(merged)))
    }
    if (text.length > MAX_PAYLOAD_BYTES) return null
    return sanitizeLoadedDoc(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * 파일에서 읽은 문서를 그대로 믿으면 안 된다.
 *
 * 1) nativeSvg 는 dangerouslySetInnerHTML 로 화면에 꽂히므로, 노트에 심어진 SVG 가
 *    앱 오리진에서 스크립트를 실행할 수 있다(= 로컬 파일 API 전권). 저장할 때도 빼는 필드이니
 *    읽을 때는 무조건 버린다.
 * 2) order·elements 같은 필수 구조가 빠지면 렌더러가 던지고 화면이 통째로 하얘진다.
 *    여기서 형태를 맞춰 두면 손상된 노트도 '열리긴' 한다.
 */
export function sanitizeLoadedDoc(raw: unknown): SceneDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, any>
  if (d.version !== 2) return null

  const elements: Record<string, any> = {}
  if (d.elements && typeof d.elements === 'object' && !Array.isArray(d.elements)) {
    for (const [id, el] of Object.entries(d.elements)) {
      if (!el || typeof el !== 'object') continue
      const e = el as Record<string, any>
      if (typeof e.kind !== 'string') continue
      const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
      const fixed: Record<string, any> = { ...e, id }
      if (e.kind === 'node' || e.kind === 'group' || e.kind === 'text' || e.kind === 'image') {
        fixed.x = num(e.x, 0); fixed.y = num(e.y, 0)
        fixed.w = Math.max(1, num(e.w, 100)); fixed.h = Math.max(1, num(e.h, 40))
        if (!e.style || typeof e.style !== 'object') fixed.style = undefined
      }
      if (e.kind === 'edge' && (typeof e.source !== 'string' || typeof e.target !== 'string')) continue
      if (e.kind === 'freedraw' && !Array.isArray(e.points)) continue
      elements[id] = fixed
    }
  }
  // 연결이 끊긴 엣지는 버린다
  for (const [id, el] of Object.entries(elements)) {
    if (el.kind === 'edge' && (!elements[el.source] || !elements[el.target])) delete elements[id]
  }

  const order: string[] = Array.isArray(d.order) ? d.order.filter((id: unknown) => typeof id === 'string' && elements[id as string]) : []
  for (const id of Object.keys(elements)) if (!order.includes(id)) order.push(id)

  const now = Date.now()
  return {
    ...d,
    version: 2,
    id: typeof d.id === 'string' ? d.id : 'doc',
    title: typeof d.title === 'string' ? d.title : '무제 다이어그램',
    code: typeof d.code === 'string' ? d.code : '',
    diagramType: typeof d.diagramType === 'string' ? d.diagramType : 'flowchart-v2',
    direction: ['TB', 'BT', 'LR', 'RL'].includes(d.direction) ? d.direction : 'TB',
    sourceOfTruth: d.sourceOfTruth === 'canvas' ? 'canvas' : 'code',
    freeEdits: !!d.freeEdits,
    elements,
    order,
    themeId: typeof d.themeId === 'string' ? d.themeId : 'midnight',
    editable: d.editable !== false,
    // 파일에서 읽은 SVG 는 절대 화면에 꽂지 않는다. 필요하면 code 로 다시 그린다.
    nativeSvg: undefined,
    nativeSize: d.nativeSize && typeof d.nativeSize.w === 'number' ? d.nativeSize : undefined,
    created: typeof d.created === 'number' ? d.created : now,
    modified: typeof d.modified === 'number' ? d.modified : now,
    tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === 'string') : [],
  } as SceneDoc
}

export interface NoteOptions {
  /** svg/png 첨부를 임베드할지. 'auto' 면 자유 편집이 있을 때만 이미지로 */
  embed: 'svg' | 'png' | 'none' | 'auto'
  attachmentName?: string
  /** 편집 상태를 노트에 숨겨 저장 */
  includeData: boolean
  /** encodeDocPayload() 로 미리 만든 페이로드. 없으면 평문 JSON 으로 넣는다. */
  encodedData?: string
  tags?: string[]
  /** 첨부가 노트와 다른 폴더에 있을 때의 상대 경로 접두사 */
  attachmentFolder?: string
}

function yamlEscape(v: string): string {
  if (/^[\w가-힣][\w가-힣 .\-()]*$/.test(v)) return v
  return `"${v.replace(/"/g, '\\"')}"`
}

function isoDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 저장용 문서 — 브라우저 전용 필드(nativeSvg)는 뺀다 */
export function serializableDoc(doc: SceneDoc): SceneDoc {
  const { nativeSvg, ...rest } = doc
  return rest as SceneDoc
}

export function buildNote(doc: SceneDoc, opts: NoteOptions): string {
  const useImage =
    opts.embed === 'svg' || opts.embed === 'png'
      ? true
      : opts.embed === 'auto'
        ? doc.freeEdits || !doc.editable
        : false

  const lines: string[] = []

  // ── 프론트매터 ──
  lines.push('---')
  lines.push(`title: ${yamlEscape(doc.title || '다이어그램')}`)
  lines.push(`created: ${isoDate(doc.created)}`)
  lines.push(`modified: ${isoDate(doc.modified)}`)
  lines.push('type: diagram')
  lines.push(`diagram-type: ${doc.diagramType || 'flowchart'}`)
  lines.push(`app: 다이아그래머`)
  const tags = Array.from(new Set(['다이어그램', ...(doc.tags ?? []), ...(opts.tags ?? [])]))
  lines.push(`tags:`)
  for (const t of tags) lines.push(`  - ${yamlEscape(t)}`)
  lines.push('---')
  lines.push('')

  lines.push(`# ${doc.title || '다이어그램'}`)
  lines.push('')

  if (useImage && opts.attachmentName) {
    // 위키 임베드는 공백·한글 파일명에서도 안전하다 (Obsidian 이 이름으로 해석)
    lines.push(`![[${opts.attachmentName}]]`)
    lines.push('')
  }

  const code = stripLayoutComment(doc.code || '').trim()
  if (code) {
    if (useImage) {
      // 이미지를 이미 보여줬으므로 코드는 접어둔다
      lines.push('> [!note]- mermaid 원본')
      for (const l of ['```mermaid', ...code.split('\n'), '```']) lines.push('> ' + l)
      lines.push('')
    } else {
      lines.push('```mermaid')
      lines.push(code)
      lines.push('```')
      lines.push('')
    }
  }

  if (!doc.editable) {
    lines.push('> [!info] 이 다이어그램은 코드로만 편집할 수 있는 종류입니다.')
    lines.push('')
  }

  if (opts.includeData) {
    lines.push(DATA_MARK_START)
    lines.push(opts.encodedData ?? JSON.stringify(serializableDoc(doc)))
    lines.push(DATA_MARK_END)
    lines.push('')
  }

  return lines.join('\n')
}

function extractPayload(markdown: string): string | null {
  const start = markdown.indexOf(DATA_MARK_START)
  if (start < 0) return null
  const after = markdown.slice(start + DATA_MARK_START.length)
  const end = after.indexOf('\n%%')
  return (end >= 0 ? after.slice(0, end) : after).trim()
}

/** 노트에서 다이아그래머 편집 상태를 되읽는다 (평문 JSON 전용 — 압축본은 extractDocAsync) */
export function extractDoc(markdown: string): SceneDoc | null {
  const payload = extractPayload(markdown)
  if (!payload || payload.startsWith('dgz1:')) return null
  try {
    return sanitizeLoadedDoc(JSON.parse(payload))
  } catch {
    return null
  }
}

/** 평문·압축 양쪽을 모두 읽는다 */
export async function extractDocAsync(markdown: string): Promise<SceneDoc | null> {
  const payload = extractPayload(markdown)
  if (!payload) return null
  return decodeDocPayload(payload)
}

/** 노트에서 mermaid 코드블록만 뽑는다(다이아그래머 데이터가 없는 일반 노트용) */
export function extractMermaid(markdown: string): string | null {
  const m = markdown.match(/```mermaid\s*\n([\s\S]*?)```/)
  if (!m) return null
  return m[1]
    .split('\n')
    .map(l => l.replace(/^>\s?/, ''))
    .join('\n')
    .trim()
}

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]', 'g')

/**
 * 파일명 규칙은 서버(server/index.mjs 의 safeName)와 **정확히 같아야 한다.**
 * 다르면 노트 안의 ![[이름.svg]] 와 실제 저장된 파일명이 어긋나 임베드가 조용히 깨진다.
 * (예: 제목이 '.계획' 이면 서버는 선행 점을 지워 '계획.svg' 로 쓴다)
 */
export function noteFileName(title: string): string {
  const cleaned = String(title || '')
    .replace(CONTROL, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return cleaned || '다이어그램'
}
