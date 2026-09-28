import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 파일 서버 포트를 바꾸면(DIAGRAMMER_PORT) 프록시도 따라가야 한다.
// 안 따라가면 화면은 뜨는데 저장·Obsidian 만 조용히 죽는다.
const API_PORT = process.env.DIAGRAMMER_PORT || '5274'
const WEB_PORT = Number(process.env.DIAGRAMMER_WEB_PORT || 5273)

if (String(WEB_PORT) === String(API_PORT)) {
  throw new Error(
    `화면 포트(${WEB_PORT})와 파일 서버 포트(${API_PORT})가 같습니다. ` +
    'DIAGRAMMER_WEB_PORT 또는 DIAGRAMMER_PORT 중 하나를 다른 값으로 지정하세요.',
  )
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    /**
     * 포트가 막히면 **반드시 멈춘다.**
     * strictPort 없이 두면 vite 가 +1 해서 다음 포트를 잡는데, 그 다음 포트가 하필
     * 파일 서버(5274)다. 둘은 IPv6/IPv4 로 주소 계열이 달라 OS 가 충돌로 막지 못하고,
     * 같은 포트를 두 프로그램이 나눠 듣는 상태가 된다. 그때부터는 localhost 가
     * 어느 쪽으로 풀리느냐에 따라 동작이 달라져 원인을 찾기가 매우 어려워진다.
     */
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2000 },
})
