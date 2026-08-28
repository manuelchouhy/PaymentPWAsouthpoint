import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'southpoint-theme'
const ThemeContext = createContext(null)

function readInitialTheme() {
  if (typeof document === 'undefined') return 'dark'
  // El script inline en index.html ya aplicó la clase antes del primer
  // paint — acá solo leemos ese resultado para que el estado de React
  // arranque en sync (evita un re-render que pise el tema correcto).
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    // localStorage puede tirar (SecurityError) dentro de un iframe sandbox como
    // el de DOMO; persistir la preferencia es best-effort, no debe romper el
    // render. El tema visual ya se aplicó vía la clase de arriba.
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch (e) {
      /* almacenamiento no disponible: seguimos sin persistir */
    }
    document.getElementById('theme-color-meta')
      ?.setAttribute('content', theme === 'dark' ? '#0A0A0A' : '#FAFAFA')
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
