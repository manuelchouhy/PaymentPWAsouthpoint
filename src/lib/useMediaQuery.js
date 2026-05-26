import { useEffect, useState } from 'react'

/**
 * Hook que sigue el estado de una media query.
 * Se usa para alternar entre la tabla (escritorio) y las tarjetas (móvil).
 *
 * @param {string} query  Ej: '(max-width: 720px)'
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (event) => setMatches(event.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
