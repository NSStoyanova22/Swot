import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'

import { cn } from '@/lib/utils'

type ToastVariant = 'default' | 'success' | 'error'

type ToastItem = {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}

type ToastInput = {
  title: string
  description?: string
  variant?: ToastVariant
}

type ToastContextValue = {
  toast: (input: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function iconForVariant(variant: ToastVariant) {
  if (variant === 'success') return CheckCircle2
  if (variant === 'error') return TriangleAlert
  return Info
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((current) => [
      ...current,
      {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? 'default',
      },
    ])

    window.setTimeout(() => {
      dismiss(id)
    }, 3200)
  }, [dismiss])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[340px] max-w-[92vw] flex-col gap-2">
        {toasts.map((item) => {
          const Icon = iconForVariant(item.variant)
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto rounded-lg border bg-card p-3 shadow-soft backdrop-blur-sm',
                item.variant === 'success' && 'border-emerald-300/50',
                item.variant === 'error' && 'border-destructive/40',
              )}
            >
              <div className="flex items-start gap-2">
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4',
                    item.variant === 'success' && 'text-emerald-600',
                    item.variant === 'error' && 'text-destructive',
                    item.variant === 'default' && 'text-primary',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{item.title}</p>
                  {item.description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => dismiss(item.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider')
  }
  return context
}
