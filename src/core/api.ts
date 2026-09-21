/**
 * 로컬 파일 서버 클라이언트.
 *
 * 서버가 죽어 있어도 앱은 계속 동작해야 한다(그리기·내보내기는 브라우저만으로 된다).
 * 그래서 모든 호출은 실패를 값으로 돌려주고, available 플래그로 UI 가 상태를 표시한다.
 */
export interface VaultInfo {
  id: string
  path: string
  name: string
  open: boolean
  exists: boolean
  ts: number
}

export interface AppConfig {
  version: number
  obsidian: {
    enabled: boolean
    vaultPath: string
    folder: string
    attachmentFolder: string
    embedFormat: 'svg' | 'png' | 'none' | 'auto'
    autoSave: boolean
    includeLayout: boolean
  }
  exportDir: string
  ui: Record<string, unknown>
  recents: string[]
}

export interface VaultNote {
  name: string
  rel: string
  modified: number
  bytes: number
  kind: 'diagrammer' | 'mermaid' | 'plain'
}

export interface LibraryItem {
  id: string
  title: string
  diagramType: string
  nodeCount: number
  modified: number
  thumbnail: string | null
}

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // 서버가 이 헤더를 요구한다. 커스텀 헤더가 붙으면 브라우저가 프리플라이트를 강제하므로
        // 다른 사이트가 보내는 '단순 요청' CSRF 가 서버에 도달하지 못한다.
        'X-Diagrammer': '1',
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError('파일 서버에 연결하지 못했습니다. 터미널에서 npm run dev 가 켜져 있는지 확인하세요.', 0)
  }
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError('서버 응답을 해석하지 못했습니다.', res.status)
  }
  if (!res.ok || json?.ok === false) {
    throw new ApiError(json?.error || `요청 실패 (${res.status})`, res.status)
  }
  return json as T
}

let availability: boolean | null = null

export async function ping(): Promise<boolean> {
  try {
    await call<{ ok: true }>('/health')
    availability = true
  } catch {
    availability = false
  }
  return availability
}

export function isServerKnownDown(): boolean {
  return availability === false
}

export const api = {
  health: () => call<{ ok: true; dataDir: string; port: number }>('/health'),

  getConfig: () => call<{ ok: true; config: AppConfig; vaults: VaultInfo[]; dataDir: string; home: string }>('/config'),

  patchConfig: (patch: Partial<AppConfig>) =>
    call<{ ok: true; config: AppConfig }>('/config', { method: 'PATCH', body: JSON.stringify(patch) }),

  vaults: () => call<{ ok: true; vaults: VaultInfo[] }>('/vaults'),

  dirs: (root: string, rel = '') =>
    call<{ ok: true; dirs: { name: string; rel: string }[]; missing?: boolean }>(
      `/dirs?root=${encodeURIComponent(root)}&rel=${encodeURIComponent(rel)}`,
    ),

  save: (body: {
    root: string
    dir?: string
    name: string
    ext: string
    text?: string
    base64?: string
    overwrite?: boolean
  }) => call<{ ok: true; path: string; name: string; bytes: number; backedUp: string | null }>('/save', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  read: (root: string, rel: string) =>
    call<{ ok: true; path: string; text: string; bytes: number; mtime: number }>(
      `/read?root=${encodeURIComponent(root)}&rel=${encodeURIComponent(rel)}`,
    ),

  notes: (rel?: string) =>
    call<{ ok: true; notes: VaultNote[]; vaultPath?: string; dir: string; missing?: boolean }>(
      '/notes' + (rel ? `?rel=${encodeURIComponent(rel)}` : ''),
    ),

  noteRead: (rel: string) =>
    call<{ ok: true; path: string; rel: string; text: string }>(`/notes/read?rel=${encodeURIComponent(rel)}`),

  library: () => call<{ ok: true; items: LibraryItem[] }>('/library'),

  libraryGet: (id: string) => call<{ ok: true; doc: any }>(`/library/${encodeURIComponent(id)}`),

  librarySave: (id: string, doc: unknown) =>
    call<{ ok: true; id: string; path: string }>(`/library/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ doc }),
    }),

  libraryDelete: (id: string) =>
    call<{ ok: true }>(`/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  obsidianSave: (body: {
    vaultPath?: string
    folder?: string
    attachmentFolder?: string
    title: string
    markdown: string
    attachments?: { name: string; text?: string; base64?: string }[]
    overwrite?: boolean
  }) => call<{
    ok: true
    vaultPath: string
    notePath: string
    relative: string
    written: { kind: string; path: string; name: string }[]
    backedUp: string | null
    /** 같은 이름의 '남의 노트' 가 있어 다른 파일명으로 저장했는가 */
    renamedBecauseForeign?: boolean
    obsidianUri: string
  }>('/obsidian/save', { method: 'POST', body: JSON.stringify(body) }),

  reveal: (path: string) => call<{ ok: true; path: string }>('/reveal', { method: 'POST', body: JSON.stringify({ path }) }),
}
