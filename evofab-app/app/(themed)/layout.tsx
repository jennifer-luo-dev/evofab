// layout.tsx ((themed) route group)
// Shared shell for the Pipelines/History/Machine Settings pages. Wraps them
// in ThemeProvider so only these three pages support the light/dark toggle —
// every other page in the app stays on the single dark theme defined in
// globals.css. This route group doesn't affect the URL: routes stay
// /pipelines, /history, /machine-settings.

import type { ReactNode } from 'react'
import { ThemeProvider } from '@/app/contexts/ThemeContext'
import { ThemeToggle } from '@/app/components/theme/ThemeToggle'

/** Route-group layout providing the scoped light/dark theme toggle shared by these three pages. */
export default function ThemedLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <div className="max-w-5xl mx-auto px-6 py-8 animate-fade-up">
        <div className="flex justify-end mb-4">
          <ThemeToggle />
        </div>
        {children}
      </div>
    </ThemeProvider>
  )
}
