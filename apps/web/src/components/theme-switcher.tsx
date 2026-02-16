import { Check, ChevronDown, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

export function ThemeSwitcher() {
  const { theme, setTheme, options } = useTheme()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  const active = options.find((option) => option.value === theme)

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        className="h-9 gap-2 px-2.5 text-xs font-medium"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Palette className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{active?.label ?? 'Theme'}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>

      <div
        className={cn(
          'absolute right-0 top-11 z-50 w-72 origin-top-right rounded-xl border border-border/70 bg-card/95 p-2 shadow-xl backdrop-blur-sm transition duration-200',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
        )}
      >
        <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Themes</p>
        <div role="listbox" aria-label="Theme presets" className="space-y-1">
          {options.map((option) => {
            const isActive = option.value === theme
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  isActive ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:border-border/70 hover:bg-secondary/55',
                )}
                onClick={() => {
                  setTheme(option.value)
                  setOpen(false)
                }}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className="flex items-center gap-1">
                      {option.preview.map((color) => (
                        <span key={color} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                </span>
                {isActive ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
