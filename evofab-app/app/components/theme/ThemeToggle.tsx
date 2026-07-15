// ThemeToggle.tsx
// Light/dark switch control for the pages wrapped in ThemeProvider.

'use client'

import { useTheme } from '@/app/contexts/ThemeContext'
import { cn } from '@/app/lib/utils'

/** Pill switch that toggles the current ThemeProvider's theme between light and dark. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-pressed={isLight}
      className="flex items-center gap-2 text-xs text-muted"
    >
      <span>{isLight ? 'Light mode' : 'Dark mode'}</span>
      <span
        className={cn(
          'relative inline-block w-8.5 h-4.75 rounded-full transition-colors',
          isLight ? 'bg-border-2' : 'bg-teal'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-3.75 h-3.75 rounded-full bg-surface shadow transition-all',
            isLight ? 'left-0.5' : 'left-4.25'
          )}
        />
      </span>
    </button>
  )
}
