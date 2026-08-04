import { createContext, useContext } from 'react'

export const ThemeContext = createContext(null)
export const THEME_STORAGE_KEY = 'svm_theme'

export function readStoredTheme() {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null
  return stored === 'light' || stored === 'dark' ? stored : 'dark'
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
