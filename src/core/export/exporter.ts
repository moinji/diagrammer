/**
 * 내보내기.
 *
 * 화면에 이미 그려진 SVG 를 복제해서 쓴다. 따로 렌더러를 두면 화면과 파일이 반드시 어긋난다.
 * 복제 후에는 편집용 요소(그리드, 선택 테두리, 핸들)를 떼어내고 독립 실행 가능한 문서로 만든다.
 *
 * PNG 주의: SVG 안에 foreignObject 나 외부 도메인 이미지가 있으면 canvas 가 오염되어
 * toBlob 이 실패한다. 우리 렌더러는 foreignObject 를 쓰지 않고, 이미지는 data: URI 만 허용한다.
 */
import type { SceneDoc } from '../types'
import { sceneBounds } from '../geometry'
import { getTheme } from '../theme'

export type BackgroundMode = 'theme' | 'transparent' | 'white' | 'dark'

export interface ExportOptions {
  padding?: number
  background?: BackgroundMode
  scale?: number
  /** 캔버스 DOM 이 아니라 전달된 SVG 루트를 쓴다(테스트용) */
  root?: SVGSVGElement | null
}

/**
 * canvas 한계. 넘으면 toBlob 이 null 을 돌려주거나 전부 투명한 이미지가 나온다.
 * 브라우저마다 다르지만 보수적으로 잡는다 — 실패보다 경고가 낫다.
 */
const MAX_CANVAS_SIDE = 16384
const MAX_CANVAS_AREA = 268_435_456 // 16384^2 / 1024 * 16 ≈ 데스크톱 기준 여유값

export function checkCanvasBudget(w: number, h: number): string | null {
  if (w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE) {
    return `한 변이 ${MAX_CANVAS_SIDE}px 를 넘습니다 (${Math.round(w)}×${Math.round(h)}). 배율을 낮추세요.`
  }
  if (w * h > MAX_CANVAS_AREA) {
    return `이미지가 너무 큽니다 (${Math.round(w)}×${Math.round(h)}). 배율을 낮추세요.`
  }
  return null
}

const DEFAULTS: Required<Pick<ExportOptions, 'padding' | 'background' | 'scale'>> = {
  padding: 24,
  background: 'theme',
  scale: 2,
}

export function findCanvasSvg(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('svg[data-diagrammer-canvas]')
}

function backgroundColor(doc: SceneDoc, mode: BackgroundMode): string | null {
  switch (mode) {
    case 'transparent': return null
    case 'white': return '#ffffff'
    case 'dark': return '#0f1115'
    default: return doc.background ?? getTheme(doc.themeId).background
  }
}

/** 문서의 실제 내용 경계 + 여백 */
export function contentBox(doc: SceneDoc, padding: number) {
  const b = sceneBounds(doc)
  if (!b || b.w <= 0 || b.h <= 0) return { x: -100, y: -60, w: 200, h: 120 }
  return { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 }
}

/**
 * 독립 실행 가능한 SVG 문자열을 만든다.
 * 외부 CSS·클래스에 의존하지 않으므로 Illustrator/Inkscape/Obsidian 에서 그대로 열린다.
 */
export function buildSvgString(doc: SceneDoc, options: ExportOptions = {}): string {
  const opts = { ...DEFAULTS, ...options }
  const source = options.root ?? findCanvasSvg()
  if (!source) throw new Error('캔버스를 찾지 못했습니다.')

  const layer = source.querySelector('g[data-layer="scene"]')
  if (!layer) throw new Error('그릴 내용이 없습니다.')

  const box = contentBox(doc, opts.padding)
  const svgNS = 'http://www.w3.org/2000/svg'
  const out = document.createElementNS(svgNS, 'svg')
  out.setAttribute('xmlns', svgNS)
  out.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  out.setAttribute('version', '1.1')
  /**
   * width/height 는 반드시 붙인다.
   *  - viewBox 만 있는 SVG 는 Firefox 에서 drawImage 가 조용히 실패한다.
   *  - 배율은 여기에 곱해 구워 넣는다. drawImage 의 dw/dh 로 키우면 벡터가 아니라
   *    래스터를 늘리게 되어 흐려진다.
   */
  const pxScale = options.scale && options.scale > 0 ? options.scale : 1
  out.setAttribute('width', String(Math.round(box.w * pxScale)))
  out.setAttribute('height', String(Math.round(box.h * pxScale)))
  out.setAttribute('viewBox', `${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}`)

  // 제목/설명 — 접근성과 검색을 위해
  const title = document.createElementNS(svgNS, 'title')
  title.textContent = doc.title || '다이어그램'
  out.appendChild(title)

  // defs (마커·필터) 복제
  const defs = source.querySelector('defs')
  if (defs) {
    const clonedDefs = defs.cloneNode(true) as SVGDefsElement
    // 캔버스 전용 패턴(그리드)은 뺀다
    clonedDefs.querySelectorAll('pattern').forEach(p => p.remove())
    out.appendChild(clonedDefs)
  }

  const bg = backgroundColor(doc, opts.background)
  if (bg) {
    const rect = document.createElementNS(svgNS, 'rect')
    rect.setAttribute('x', String(round(box.x)))
    rect.setAttribute('y', String(round(box.y)))
    rect.setAttribute('width', String(round(box.w)))
    rect.setAttribute('height', String(round(box.h)))
    rect.setAttribute('fill', bg)
    out.appendChild(rect)
  }

  const cloned = layer.cloneNode(true) as SVGGElement
  cloned.querySelectorAll('[data-export="skip"]').forEach(n => n.remove())
  cloned.removeAttribute('data-layer')
  out.appendChild(cloned)

  const xml = new XMLSerializer().serializeToString(out)
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml
}

/**
 * 한글 안전 base64.
 * btoa 에 한글을 그대로 넣으면 InvalidCharacterError 가 난다. UTF-8 바이트로 먼저 바꿔야 한다.
 * 그리고 fromCharCode(...bytes) 로 한 번에 펼치면 큰 버퍼에서 스택이 넘친다 — 청크로 나눈다.
 */
export function base64FromBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml;base64,' + base64FromBytes(new TextEncoder().encode(svg))
}

export async function buildPngBlob(doc: SceneDoc, options: ExportOptions = {}): Promise<Blob> {
  const opts = { ...DEFAULTS, ...options }
  const box = contentBox(doc, opts.padding)
  const w = Math.max(1, Math.round(box.w * opts.scale))
  const h = Math.max(1, Math.round(box.h * opts.scale))

  const over = checkCanvasBudget(w, h)
  if (over) throw new Error(over)

  // 배율은 SVG width/height 에 이미 구워져 있으므로 canvas 는 1:1 로 그린다
  const svg = buildSvgString(doc, { ...options, scale: opts.scale })

  const img = new Image()
  // data: URI 를 쓰면 같은 출처 제약을 피할 수 있어 canvas 가 오염되지 않는다.
  // (blob: URL 은 Safari 에서 SVG 로드가 실패한 이력이 있다)
  img.src = svgToDataUrl(svg)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG 를 이미지로 변환하지 못했습니다.'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스 컨텍스트를 만들지 못했습니다.')
  if (opts.background !== 'transparent') {
    const bg = backgroundColor(doc, opts.background)
    if (bg) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
    }
  }
  ctx.drawImage(img, 0, 0)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG 생성에 실패했습니다. 배율을 낮춰 보세요.'))), 'image/png')
  })
}

/**
 * 단일 HTML 파일. 의존성 0, 열면 바로 팬/줌이 된다.
 */
export function buildHtmlString(doc: SceneDoc, options: ExportOptions = {}): string {
  const svg = buildSvgString(doc, { ...options, scale: 1, background: options.background ?? 'transparent' })
  const inner = svg.replace(/^<\?xml[^?]*\?>\s*/, '')
  const bg = backgroundColor(doc, options.background ?? 'theme') ?? '#ffffff'
  const title = escapeHtml(doc.title || '다이어그램')
  const dark = getTheme(doc.themeId).dark

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: ${bg};
    font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }
  #stage { position: fixed; inset: 0; cursor: grab; touch-action: none; }
  #stage.dragging { cursor: grabbing; }
  #stage svg { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: visible; }
  #bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 6px;
    padding: 6px; border-radius: 12px; background: ${dark ? 'rgba(28,32,40,.9)' : 'rgba(255,255,255,.92)'};
    box-shadow: 0 6px 24px rgba(0,0,0,.18); backdrop-filter: blur(8px); }
  #bar button { border: 0; border-radius: 8px; padding: 7px 11px; font-size: 13px; cursor: pointer;
    background: ${dark ? '#2a303c' : '#eef0f3'}; color: ${dark ? '#e6e9ef' : '#222'}; }
  #bar button:hover { background: ${dark ? '#39414f' : '#e0e3e8'}; }
  #pct { align-self: center; font-size: 12px; opacity: .7; min-width: 46px; text-align: center;
    color: ${dark ? '#e6e9ef' : '#222'}; }
</style>
</head>
<body>
<div id="stage">${inner}</div>
<div id="bar">
  <button id="out">−</button><span id="pct">100%</span><button id="in">+</button>
  <button id="fit">화면 맞춤</button><button id="reset">100%</button>
</div>
<script>
(function(){
  var stage = document.getElementById('stage');
  var svg = stage.querySelector('svg');
  var vb = (svg.getAttribute('viewBox')||'0 0 100 100').split(/[ ,]+/).map(Number);
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('width', vb[2]); svg.setAttribute('height', vb[3]);
  var s = 1, tx = 0, ty = 0;
  function apply(){ svg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    document.getElementById('pct').textContent = Math.round(s*100) + '%'; }
  function fit(){ var r = stage.getBoundingClientRect();
    s = Math.min((r.width-48)/vb[2], (r.height-96)/vb[3]);
    tx = (r.width - vb[2]*s)/2; ty = (r.height - vb[3]*s)/2; apply(); }
  function zoomAt(f, cx, cy){ var ns = Math.min(12, Math.max(0.05, s*f));
    tx = cx - (cx - tx) * (ns/s); ty = cy - (cy - ty) * (ns/s); s = ns; apply(); }
  stage.addEventListener('wheel', function(e){ e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY*0.0125), e.clientX, e.clientY);
    else { tx -= e.deltaX; ty -= e.deltaY; apply(); } }, {passive:false});
  var drag = null;
  stage.addEventListener('pointerdown', function(e){ drag = {x:e.clientX, y:e.clientY, tx:tx, ty:ty};
    stage.classList.add('dragging'); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', function(e){ if(!drag) return;
    tx = drag.tx + (e.clientX-drag.x); ty = drag.ty + (e.clientY-drag.y); apply(); });
  stage.addEventListener('pointerup', function(){ drag = null; stage.classList.remove('dragging'); });
  document.getElementById('in').onclick = function(){ var r=stage.getBoundingClientRect(); zoomAt(1.2, r.width/2, r.height/2); };
  document.getElementById('out').onclick = function(){ var r=stage.getBoundingClientRect(); zoomAt(1/1.2, r.width/2, r.height/2); };
  document.getElementById('fit').onclick = fit;
  document.getElementById('reset').onclick = function(){ var r=stage.getBoundingClientRect();
    s=1; tx=(r.width-vb[2])/2; ty=(r.height-vb[3])/2; apply(); };
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', function(e){
    if (e.key==='0') { document.getElementById('reset').click(); }
    if (e.key==='1' || e.key.toLowerCase()==='f') fit();
    if (e.key==='+' || e.key==='=') document.getElementById('in').click();
    if (e.key==='-') document.getElementById('out').click();
  });
  fit();
})();
</script>
</body>
</html>
`
}

// ── 파일 저장 / 클립보드 ────────────────────────────────────────────
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }))
}

/**
 * PNG 를 클립보드로.
 * Safari 는 사용자 제스처 안에서 ClipboardItem 을 만들어야 한다. 그래서 Blob 을 기다리지 않고
 * Promise 를 그대로 넘긴다(표준이 허용하는 형태).
 */
export async function copyPngToClipboard(doc: SceneDoc, options: ExportOptions = {}): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('이 브라우저는 이미지 클립보드 복사를 지원하지 않습니다.')
  }
  const item = new ClipboardItem({ 'image/png': buildPngBlob(doc, options) })
  await navigator.clipboard.write([item])
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

export function safeFileName(name: string, fallback = '다이어그램'): string {
  const cleaned = String(name || '').replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 100)
  return cleaned || fallback
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
