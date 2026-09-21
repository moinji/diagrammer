import React from 'react'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { useStore } from '../store/useStore'

const ICONS = {
  info: <Info size={15} />,
  success: <CheckCircle2 size={15} />,
  error: <AlertCircle size={15} />,
  warn: <TriangleAlert size={15} />,
}

export function Toasts() {
  const toasts = useStore(s => s.toasts)
  const dismiss = useStore(s => s.dismissToast)
  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="icon">{ICONS[t.kind]}</span>
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              className="btn sm"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn icon sm ghost" onClick={() => dismiss(t.id)} title="닫기">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
