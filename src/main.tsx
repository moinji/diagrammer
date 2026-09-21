import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store/useStore'
import './styles/app.css'

const el = document.getElementById('root')
if (el) createRoot(el).render(<React.StrictMode><App /></React.StrictMode>)

// 개발 중 콘솔에서 상태를 들여다보기 위한 창구.
// (동적 import 로 스토어를 가져오면 HMR 때문에 다른 인스턴스가 잡힐 수 있어 여기서 노출한다)
if (import.meta.env.DEV) {
  ;(window as unknown as { __dgm?: typeof useStore }).__dgm = useStore
}
