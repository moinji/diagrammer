#!/usr/bin/env node
/**
 * 다이아그래머 로컬 파일 서버
 *
 * 프론트엔드(브라우저)는 파일시스템에 직접 접근할 수 없다. 이 서버가 유일한 통로다.
 * 따라서 이 파일의 최우선 관심사는 "브라우저가 요청한 경로가 허용된 루트 안인가"이다.
 */
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.DIAGRAMMER_PORT || 5274)
const SERVE_DIST = process.argv.includes('--serve-dist')
const OPEN_BROWSER = process.argv.includes('--open')

// ── 앱 데이터 디렉토리 ───────────────────────────────────────────────
const HOME = os.homedir()
const DATA_DIR = path.join(HOME, '.diagrammer')
const LIBRARY_DIR = path.join(DATA_DIR, 'library')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
for (const d of [DATA_DIR, LIBRARY_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true })

const DEFAULT_CONFIG = {
  version: 1,
  obsidian: {
    enabled: true,
    vaultPath: '',           // 비어 있으면 자동 감지한 첫 vault
    folder: '다이어그램',      // vault 내부 상대 경로
    attachmentFolder: '',    // 비우면 folder 와 동일
    embedFormat: 'svg',      // svg | png | none
    // 저장(⌘S)할 때마다 vault 에도 함께 기록한다. 설정에서 끌 수 있다.
    autoSave: true,
    includeLayout: true,     // 편집 상태(좌표/색)를 노트에 숨겨 저장
  },
  exportDir: path.join(HOME, 'Downloads'),
  ui: { theme: 'dark', codePaneWidth: 420, showGrid: true, snap: true },
  recents: [],
}

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return deepMerge(structuredClone(DEFAULT_CONFIG), raw)
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
  return cfg
}
function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v
  }
  return out
}

// ── Obsidian vault 자동 감지 ────────────────────────────────────────
function detectVaults() {
  const candidates = [
    path.join(HOME, 'Library/Application Support/obsidian/obsidian.json'),
    path.join(HOME, '.config/obsidian/obsidian.json'),
    path.join(HOME, 'AppData/Roaming/obsidian/obsidian.json'),
  ]
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      return Object.entries(j.vaults || {}).map(([id, v]) => ({
        id,
        path: v.path,
        name: path.basename(v.path),
        open: !!v.open,
        exists: fs.existsSync(v.path),
        ts: v.ts || 0,
      })).sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || b.ts - a.ts)
    } catch { /* 다음 후보 */ }
  }
  return []
}

// ── 경로 안전장치 ───────────────────────────────────────────────────
// 허용 루트: 라이브러리, 백업, 설정된 내보내기 폴더, 설정/감지된 vault 전부.
function allowedRoots() {
  const cfg = readConfig()
  const roots = new Map()
  roots.set('library', LIBRARY_DIR)
  roots.set('backups', BACKUP_DIR)
  roots.set('exports', path.resolve(cfg.exportDir || path.join(HOME, 'Downloads')))
  if (cfg.obsidian?.vaultPath) roots.set('vault', path.resolve(cfg.obsidian.vaultPath))
  for (const v of detectVaults()) roots.set('vault:' + v.id, path.resolve(v.path))
  return roots
}

/**
 * rootId 아래의 rel 경로를 절대경로로 해석한다.
 * 해석 결과가 루트 밖이면 던진다. 문자열 검사가 아니라 resolve 후 접두사 비교라는 점이 핵심.
 */
function resolveIn(rootId, rel = '') {
  const roots = allowedRoots()
  const root = roots.get(rootId)
  if (!root) {
    const err = new Error('허용되지 않은 저장 위치입니다: ' + rootId)
    err.status = 400
    throw err
  }
  const target = path.resolve(root, String(rel || '').replace(/^[/\\]+/, ''))
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (target !== root && !target.startsWith(rootWithSep)) {
    const err = new Error('경로가 허용 범위를 벗어났습니다.')
    err.status = 403
    throw err
  }
  return { root, target }
}

/**
 * vault·내보내기 폴더 안에서 쓸 수 있는 상대 경로인지 확인한다.
 * '..' 는 resolveIn 이 막지만, 숨김 폴더(.obsidian, .git)는 막지 못한다 —
 * 거기에 파일을 쓰면 플러그인 코드나 git 설정을 심을 수 있다.
 */
function assertPlainRelative(rel, what = '폴더') {
  const str = String(rel || '')
  if (!str) return ''
  if (path.isAbsolute(str)) {
    const e = new Error(`${what}는 상대 경로여야 합니다.`); e.status = 400; throw e
  }
  const parts = str.split(/[/\\]+/).filter(Boolean)
  for (const seg of parts) {
    if (seg === '..') { const e = new Error(`${what}에 상위 경로(..)를 쓸 수 없습니다.`); e.status = 403; throw e }
    if (seg.startsWith('.')) {
      const e = new Error(`${what}에 숨김 폴더(${seg})를 쓸 수 없습니다.`); e.status = 403; throw e
    }
  }
  return parts.join(path.sep)
}

// 파일명에서 위험/불가 문자를 제거하되 한글은 보존한다.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g')
function safeName(name, fallback = '무제') {
  const cleaned = String(name || '')
    .replace(CONTROL_CHARS, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

async function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext)
  let i = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} ${i}${ext}`)
    i++
    if (i > 999) break
  }
  return candidate
}

// 덮어쓰기 전에 원본을 백업 디렉토리에 보관한다. (되돌릴 수 없는 손실 방지)
async function backupIfExists(target) {
  if (!fs.existsSync(target)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const hash = createHash('sha1').update(target).digest('hex').slice(0, 8)
  const dest = path.join(BACKUP_DIR, `${stamp}_${hash}_${path.basename(target)}`)
  await fsp.copyFile(target, dest)
  return dest
}

function decodeBody(body) {
  if (typeof body.base64 === 'string') return Buffer.from(body.base64, 'base64')
  if (typeof body.text === 'string') return Buffer.from(body.text, 'utf8')
  const err = new Error('저장할 내용이 없습니다 (text 또는 base64 필요).')
  err.status = 400
  throw err
}

// ── 앱 ──────────────────────────────────────────────────────────────
const app = express()

/**
 * 이 서버는 파일시스템에 쓰는 권한을 가진 로컬 API 다. 세 가지를 동시에 막아야 한다.
 *
 * 1) DNS rebinding — 공격자가 evil.example 을 127.0.0.1 로 바꿔 두면 브라우저는 그 페이지를
 *    '같은 오리진' 으로 취급해 CORS 가 아예 적용되지 않는다. Host 헤더를 직접 검사해야 한다.
 * 2) 같은 컴퓨터의 다른 로컬 페이지 — localhost 아무 포트나 허용하면, 사용자가 켜 둔 다른
 *    dev 서버의 페이지가 이 API 전권을 얻는다. 우리 포트만 허용한다.
 * 3) 단순 요청 CSRF — Content-Type: text/plain 인 POST 는 프리플라이트 없이 나가므로
 *    CORS 응답을 못 봐도 서버에는 이미 도달한다. 모든 /api 에 커스텀 헤더를 요구하면
 *    브라우저가 반드시 프리플라이트를 보내게 되고, 오리진 검사에서 걸러진다.
 */
const CLIENT_HEADER = 'x-diagrammer'
const ALLOWED_PORTS = new Set([String(PORT), '5273', '5274'])

function hostAllowed(hostHeader) {
  if (!hostHeader) return false
  const withoutPort = String(hostHeader).replace(/:\d+$/, '')
  const port = (String(hostHeader).match(/:(\d+)$/) || [])[1]
  const nameOk = withoutPort === 'localhost' || withoutPort === '127.0.0.1' || withoutPort === '[::1]'
  return nameOk && (!port || ALLOWED_PORTS.has(port))
}

function originAllowed(origin) {
  if (!origin) return true // 같은 오리진 요청은 Origin 이 없을 수 있다 (Host 검사로 이미 걸러졌다)
  try {
    const u = new URL(origin)
    return (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      ALLOWED_PORTS.has(u.port || '80')
    )
  } catch {
    return false
  }
}

app.use((req, res, next) => {
  if (!hostAllowed(req.headers.host)) {
    return res.status(403).json({ ok: false, error: '허용되지 않은 호스트입니다.' })
  }
  if (!originAllowed(req.headers.origin)) {
    return res.status(403).json({ ok: false, error: '허용되지 않은 출처입니다.' })
  }
  next()
})

app.use(cors({
  origin: (origin, cb) => cb(null, originAllowed(origin)),
  allowedHeaders: ['Content-Type', 'X-Diagrammer'],
  maxAge: 600,
}))

// /api 는 커스텀 헤더를 요구한다 → 브라우저가 프리플라이트를 강제하므로 단순요청 CSRF 가 막힌다.
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return next()
  if (req.get(CLIENT_HEADER)) return next()
  res.status(403).json({ ok: false, error: '다이아그래머 클라이언트에서만 호출할 수 있습니다.' })
})

app.use(express.json({ limit: '64mb' }))

const ok = (res, data) => res.json({ ok: true, ...data })
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  const status = e.status || 500
  if (status >= 500) console.error('[diagrammer]', e)
  res.status(status).json({ ok: false, error: e.message || String(e) })
})

app.get('/api/health', (req, res) => ok(res, { version: 1, dataDir: DATA_DIR, port: PORT }))

app.get('/api/config', wrap(async (req, res) => {
  const cfg = readConfig()
  ok(res, { config: cfg, vaults: detectVaults(), dataDir: DATA_DIR, home: HOME })
}))

/**
 * 설정은 곧 권한이다.
 * exportDir 과 vaultPath 가 allowedRoots 를 만들기 때문에, 무검증으로 저장하면
 * PATCH 한 번으로 '/' 를 허용 루트로 만들어 resolveIn 을 우회 없이 무력화할 수 있다.
 */
function sanitizeConfigPatch(patch) {
  const out = structuredClone(patch || {})

  if (typeof out.exportDir === 'string') {
    const abs = path.resolve(out.exportDir)
    const homeAbs = path.resolve(HOME)
    const insideHome = abs === homeAbs || abs.startsWith(homeAbs + path.sep)
    // 홈 밖, 홈 최상위 자체, 숨김 폴더는 거부한다
    const hidden = path.relative(homeAbs, abs).split(path.sep).some(seg => seg.startsWith('.'))
    if (!insideHome || abs === homeAbs || hidden) {
      const e = new Error('내보내기 폴더는 홈 디렉토리 안의 일반 폴더여야 합니다.')
      e.status = 400
      throw e
    }
    out.exportDir = abs
  }

  if (out.obsidian && typeof out.obsidian === 'object') {
    const o = out.obsidian
    if (typeof o.vaultPath === 'string' && o.vaultPath) {
      // Obsidian 이 실제로 알고 있는 vault 만 허용한다 (임의 경로를 루트로 승격하지 못하게)
      const known = detectVaults().map(v => path.resolve(v.path))
      const abs = path.resolve(o.vaultPath)
      if (!known.includes(abs)) {
        const e = new Error('Obsidian 에 등록된 보관함 경로만 지정할 수 있습니다.')
        e.status = 400
        throw e
      }
      o.vaultPath = abs
    }
    if (typeof o.folder === 'string') o.folder = assertPlainRelative(o.folder, '저장 폴더')
    if (typeof o.attachmentFolder === 'string') o.attachmentFolder = assertPlainRelative(o.attachmentFolder, '첨부 폴더')
    if (o.embedFormat && !['svg', 'png', 'none', 'auto'].includes(o.embedFormat)) delete o.embedFormat
  }

  // 알 수 없는 최상위 키는 버린다
  const allowed = new Set(['version', 'obsidian', 'exportDir', 'ui', 'recents'])
  for (const k of Object.keys(out)) if (!allowed.has(k)) delete out[k]
  return out
}

app.patch('/api/config', wrap(async (req, res) => {
  const cfg = writeConfig(deepMerge(readConfig(), sanitizeConfigPatch(req.body)))
  ok(res, { config: cfg })
}))

app.get('/api/vaults', wrap(async (req, res) => ok(res, { vaults: detectVaults() })))

// vault(또는 임의 허용 루트) 내부 폴더 목록 — 저장 위치 선택 UI 용
app.get('/api/dirs', wrap(async (req, res) => {
  const { root: rootId = 'vault', rel = '' } = req.query
  const { target } = resolveIn(rootId, rel)
  if (!fs.existsSync(target)) return ok(res, { dirs: [], missing: true })
  const entries = await fsp.readdir(target, { withFileTypes: true })
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, rel: path.join(rel || '', e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  ok(res, { dirs })
}))

// 범용 저장. rootId 로 목적지를 제한한다.
app.post('/api/save', wrap(async (req, res) => {
  const { root: rootId, dir = '', name, ext = '', overwrite = false, backup = true } = req.body || {}
  const buf = decodeBody(req.body || {})
  const { root, target: dirAbs } = resolveIn(rootId, assertPlainRelative(dir, '저장 폴더'))
  await fsp.mkdir(dirAbs, { recursive: true })
  const base = safeName(name)
  let target = path.join(dirAbs, base + ext)
  resolveIn(rootId, path.relative(root, target)) // 이중 검증
  let backedUp = null
  if (fs.existsSync(target)) {
    if (!overwrite) target = await uniquePath(dirAbs, base, ext)
    else if (backup) backedUp = await backupIfExists(target)
  }
  await fsp.writeFile(target, buf)
  ok(res, { path: target, name: path.basename(target), bytes: buf.length, backedUp })
}))

app.get('/api/read', wrap(async (req, res) => {
  const { root: rootId, rel } = req.query
  const { target } = resolveIn(rootId, rel)
  const stat = await fsp.stat(target)
  if (!stat.isFile()) { const e = new Error('파일이 아닙니다.'); e.status = 400; throw e }
  const buf = await fsp.readFile(target)
  ok(res, { path: target, text: buf.toString('utf8'), bytes: buf.length, mtime: stat.mtimeMs })
}))

// vault 안의 마크다운 노트 목록 — 저장한 다이어그램을 다시 열기 위해
app.get('/api/notes', wrap(async (req, res) => {
  const cfg = readConfig()
  const vaults = detectVaults()
  const vaultPath = req.query.vaultPath || cfg.obsidian?.vaultPath || vaults.find(v => v.exists)?.path
  if (!vaultPath) { const e = new Error('Obsidian vault 를 찾지 못했습니다.'); e.status = 400; throw e }
  const known = new Set([...allowedRoots().values()].map(p => path.resolve(p)))
  if (!known.has(path.resolve(vaultPath))) { const e = new Error('등록되지 않은 vault 경로입니다.'); e.status = 403; throw e }

  const vaultAbs = path.resolve(vaultPath)
  const rel = String(req.query.rel ?? cfg.obsidian?.folder ?? '').replace(/^[/\\]+/, '')
  const dir = path.resolve(vaultAbs, rel)
  if (dir !== vaultAbs && !dir.startsWith(vaultAbs + path.sep)) {
    const e = new Error('폴더가 vault 를 벗어났습니다.'); e.status = 403; throw e
  }
  if (!fs.existsSync(dir)) return ok(res, { notes: [], missing: true, dir })

  // 하위 2단계까지만 훑는다. vault 전체를 훑으면 큰 보관함에서 느려진다.
  const notes = []
  async function walk(d, depth) {
    if (depth > 2 || notes.length > 500) return
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith('.md')) {
        const stat = await fsp.stat(p).catch(() => null)
        if (!stat) continue
        let head = ''
        try {
          const fd = await fsp.open(p, 'r')
          const buf = Buffer.alloc(Math.min(2048, stat.size))
          await fd.read(buf, 0, buf.length, 0)
          await fd.close()
          head = buf.toString('utf8')
        } catch { /* 읽기 실패는 건너뜀 */ }
        notes.push({
          name: path.basename(e.name, '.md'),
          rel: path.relative(vaultAbs, p),
          modified: stat.mtimeMs,
          bytes: stat.size,
          // 다이아그래머가 만든 노트인지, 아니면 mermaid 블록만 있는 일반 노트인지
          kind: head.includes('다이아그래머-데이터') ? 'diagrammer' : head.includes('```mermaid') ? 'mermaid' : 'plain',
        })
      }
    }
  }
  await walk(dir, 0)
  notes.sort((a, b) => b.modified - a.modified)
  ok(res, { notes: notes.filter(n => n.kind !== 'plain'), vaultPath: vaultAbs, dir })
}))

// vault 노트 하나 읽기
app.get('/api/notes/read', wrap(async (req, res) => {
  const cfg = readConfig()
  const vaults = detectVaults()
  const vaultPath = req.query.vaultPath || cfg.obsidian?.vaultPath || vaults.find(v => v.exists)?.path
  if (!vaultPath) { const e = new Error('Obsidian vault 를 찾지 못했습니다.'); e.status = 400; throw e }
  const known = new Set([...allowedRoots().values()].map(p => path.resolve(p)))
  if (!known.has(path.resolve(vaultPath))) { const e = new Error('등록되지 않은 vault 경로입니다.'); e.status = 403; throw e }
  const vaultAbs = path.resolve(vaultPath)
  const target = path.resolve(vaultAbs, String(req.query.rel || '').replace(/^[/\\]+/, ''))
  if (!target.startsWith(vaultAbs + path.sep)) { const e = new Error('경로가 vault 를 벗어났습니다.'); e.status = 403; throw e }
  const text = await fsp.readFile(target, 'utf8')
  ok(res, { path: target, rel: path.relative(vaultAbs, target), text })
}))

// ── 라이브러리 (앱 자체 저장소) ──────────────────────────────────────
app.get('/api/library', wrap(async (req, res) => {
  const entries = await fsp.readdir(LIBRARY_DIR, { withFileTypes: true }).catch(() => [])
  const items = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    const p = path.join(LIBRARY_DIR, e.name)
    try {
      const stat = await fsp.stat(p)
      const doc = JSON.parse(await fsp.readFile(p, 'utf8'))
      items.push({
        id: path.basename(e.name, '.json'),
        title: doc.title || path.basename(e.name, '.json'),
        diagramType: doc.diagramType || '',
        nodeCount: doc.elements ? Object.keys(doc.elements).length : 0,
        modified: stat.mtimeMs,
        thumbnail: doc.thumbnail || null,
      })
    } catch { /* 손상 파일 건너뜀 */ }
  }
  items.sort((a, b) => b.modified - a.modified)
  ok(res, { items })
}))

app.get('/api/library/:id', wrap(async (req, res) => {
  const { target } = resolveIn('library', safeName(req.params.id) + '.json')
  const doc = JSON.parse(await fsp.readFile(target, 'utf8'))
  ok(res, { doc })
}))

app.put('/api/library/:id', wrap(async (req, res) => {
  const id = safeName(req.params.id)
  const { target } = resolveIn('library', id + '.json')
  const doc = req.body?.doc
  if (!doc || typeof doc !== 'object') { const e = new Error('doc 이 필요합니다.'); e.status = 400; throw e }
  await fsp.writeFile(target, JSON.stringify(doc), 'utf8')
  ok(res, { id, path: target })
}))

app.delete('/api/library/:id', wrap(async (req, res) => {
  const { target } = resolveIn('library', safeName(req.params.id) + '.json')
  if (fs.existsSync(target)) { await backupIfExists(target); await fsp.unlink(target) }
  ok(res, { id: req.params.id })
}))

// ── Obsidian 저장 ───────────────────────────────────────────────────
app.post('/api/obsidian/save', wrap(async (req, res) => {
  const cfg = readConfig()
  const vaults = detectVaults()
  const vaultPath = req.body?.vaultPath || cfg.obsidian?.vaultPath || vaults.find(v => v.exists)?.path
  if (!vaultPath) { const e = new Error('Obsidian vault 를 찾지 못했습니다. 설정에서 경로를 지정하세요.'); e.status = 400; throw e }
  if (!fs.existsSync(vaultPath)) { const e = new Error('vault 경로가 존재하지 않습니다: ' + vaultPath); e.status = 400; throw e }

  // vault 를 임시 루트로 허용(사용자가 설정에 지정했거나 obsidian.json 에 등록된 경로만 여기 도달)
  const known = new Set([...allowedRoots().values()].map(p => path.resolve(p)))
  if (!known.has(path.resolve(vaultPath))) {
    const e = new Error('등록되지 않은 vault 경로입니다.'); e.status = 403; throw e
  }

  const vaultAbs = path.resolve(vaultPath)
  const insideVault = p => p === vaultAbs || p.startsWith(vaultAbs + path.sep)

  const folder = assertPlainRelative(String(req.body?.folder ?? cfg.obsidian?.folder ?? ''), '저장 폴더')
  const noteDir = path.resolve(vaultAbs, folder)
  if (!insideVault(noteDir)) { const e = new Error('폴더 경로가 vault 를 벗어났습니다.'); e.status = 403; throw e }
  await fsp.mkdir(noteDir, { recursive: true })

  const base = safeName(req.body?.title, '다이어그램')
  const overwrite = req.body?.overwrite !== false
  const written = []

  // 첨부(svg/png)를 먼저 쓴다. 노트가 참조하기 때문.
  const attachFolder = assertPlainRelative(String(req.body?.attachmentFolder ?? cfg.obsidian?.attachmentFolder ?? ''), '첨부 폴더')
  const attachDir = attachFolder ? path.resolve(vaultAbs, attachFolder) : noteDir
  if (!insideVault(attachDir)) { const e = new Error('첨부 폴더가 vault 를 벗어났습니다.'); e.status = 403; throw e }
  for (const a of req.body?.attachments || []) {
    await fsp.mkdir(attachDir, { recursive: true })
    const aname = safeName(a.name, base)
    let ap = path.join(attachDir, aname)
    if (fs.existsSync(ap)) {
      if (overwrite) await backupIfExists(ap)
      else ap = await uniquePath(attachDir, path.parse(aname).name, path.parse(aname).ext)
    }
    await fsp.writeFile(ap, decodeBody(a))
    written.push({ kind: 'attachment', path: ap, name: path.basename(ap) })
  }

  let notePath = path.join(noteDir, base + '.md')
  let backedUp = null
  let renamedBecauseForeign = false
  if (fs.existsSync(notePath)) {
    // 다이아그래머가 만든 노트만 덮어쓴다.
    // 사용자가 손으로 쓴 같은 이름의 노트를 통째로 갈아엎는 것이 가장 큰 파괴 사고다.
    const existing = await fsp.readFile(notePath, 'utf8').catch(() => '')
    const isOurs = existing.includes('다이아그래머-데이터') ||
      /^app:\s*다이아그래머\s*$/m.test(existing) ||
      existing.trim() === ''
    if (overwrite && isOurs) {
      backedUp = await backupIfExists(notePath)
    } else {
      notePath = await uniquePath(noteDir, base, '.md')
      renamedBecauseForeign = overwrite && !isOurs
    }
  }
  await fsp.writeFile(notePath, String(req.body?.markdown ?? ''), 'utf8')
  written.push({ kind: 'note', path: notePath, name: path.basename(notePath) })

  const rel = path.relative(vaultAbs, notePath)
  ok(res, {
    vaultPath: vaultAbs,
    notePath,
    relative: rel,
    written,
    backedUp,
    renamedBecauseForeign,
    obsidianUri: 'obsidian://open?vault=' + encodeURIComponent(path.basename(vaultAbs)) +
      '&file=' + encodeURIComponent(rel.replace(/\.md$/, '')),
  })
}))

// Finder 에서 보여주기 (macOS). 사용자가 "파일이 어디 갔지?" 를 겪지 않게.
app.post('/api/reveal', wrap(async (req, res) => {
  const p = String(req.body?.path || '')
  const known = [...allowedRoots().values()].map(r => path.resolve(r))
  const abs = path.resolve(p)
  if (!known.some(r => abs === r || abs.startsWith(r + path.sep))) {
    const e = new Error('허용 범위 밖 경로입니다.'); e.status = 403; throw e
  }
  if (process.platform === 'darwin') spawn('open', ['-R', abs], { detached: true, stdio: 'ignore' }).unref()
  else if (process.platform === 'win32') spawn('explorer', ['/select,', abs], { detached: true, stdio: 'ignore' }).unref()
  else spawn('xdg-open', [path.dirname(abs)], { detached: true, stdio: 'ignore' }).unref()
  ok(res, { path: abs })
}))

// ── 정적 서빙(빌드본) ───────────────────────────────────────────────
if (SERVE_DIST) {
  const dist = path.join(APP_ROOT, 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
  } else {
    console.warn('[diagrammer] dist 없음 — npm run build 를 먼저 실행하세요.')
  }
}

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${SERVE_DIST ? PORT : 5273}`
  console.log(`[다이아그래머] 파일 서버 준비됨  http://127.0.0.1:${PORT}`)
  console.log(`[다이아그래머] 데이터 디렉토리    ${DATA_DIR}`)
  const vs = detectVaults()
  console.log(`[다이아그래머] 감지된 vault ${vs.length}개` + (vs[0] ? ` (기본: ${vs[0].path})` : ''))
  if (OPEN_BROWSER) {
    import('open').then(m => m.default(url)).catch(() => console.log('브라우저를 직접 열어주세요: ' + url))
  }
})
