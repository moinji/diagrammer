import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 파일 서버 포트를 바꾸면(DIAGRAMMER_PORT) 프록시도 따라가야 한다.
// 안 따라가면 화면은 뜨는데 저장·Obsidian 만 조용히 죽는다.
const API_PORT = process.env.DIAGRAMMER_PORT || '5274'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.DIAGRAMMER_WEB_PORT || 5273),
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2000 },
})
