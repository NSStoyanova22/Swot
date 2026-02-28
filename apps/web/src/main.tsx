import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'

import { ToastProvider } from '@/components/ui/toast'
import { TimerSessionProvider } from '@/hooks/use-timer-session'
import { ThemeProvider } from '@/hooks/use-theme'
import { queryClient } from '@/lib/query-client'
import { initializeTheme } from '@/theme/applyTheme'
import './index.css'
import App from './App.tsx'

initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TimerSessionProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </TimerSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
