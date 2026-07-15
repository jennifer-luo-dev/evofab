// ThemeContext.tsx
// React context for the light/dark theme toggle used on the Pipelines,
// History, and Machine Settings pages only — every other page in the app is
// dark-only and never mounts this provider. Persists the choice to
// localStorage and exposes it via a `data-theme` attribute so the CSS
// overrides in globals.css cascade to just this part of the tree.

'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'evofab-theme'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Provides a light/dark theme value, persisted to localStorage, to its subtree via a `data-theme` wrapper. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div data-theme={theme}>{children}</div>
    </ThemeContext.Provider>
  )
}

/** Returns the current theme and toggle function from the nearest ThemeProvider. Throws outside one. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
