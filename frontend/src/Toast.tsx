import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ToastVariant = 'error' | 'success' | 'info'

type ToastState = { message: string; variant: ToastVariant } | null

const ToastContext = createContext<(message: string, variant?: ToastVariant) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null)

  const showToast = useCallback((message: string, variant: ToastVariant = 'error') => {
    setToast({ message, variant })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(t)
  }, [toast])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className="toast-backdrop" role="presentation" onClick={() => setToast(null)}>
          <div
            className={`toast-dialog toast-${toast.variant}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="toast-msg"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="toast-msg" className="toast-message">
              {toast.message}
            </p>
            <button type="button" className="btn btn-primary toast-ok" onClick={() => setToast(null)}>
              OK
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string, variant?: ToastVariant) => void {
  return useContext(ToastContext)
}
