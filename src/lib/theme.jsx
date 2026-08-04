import { useEffect, useState } from 'react'
import { ThemeContext, readStoredTheme, useTheme } from './useTheme.js'

// Runs on import (before ThemeProvider's own effect gets a chance to paint),
// so the correct data-theme attribute is already on <html> for the very
// first frame — no light-flash-then-dark-snap on load.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', readStoredTheme())
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('svm_theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// Small pill button — drop into any header/nav. Colors are theme vars so it
// looks right regardless of which theme is currently active.
export function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm transition hover:brightness-110 ${className}`}
      style={{ background: 'rgba(200,134,10,0.15)', border: '1px solid rgba(200,134,10,0.3)' }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
