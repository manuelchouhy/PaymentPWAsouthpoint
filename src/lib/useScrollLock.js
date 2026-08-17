import { useEffect } from 'react'

/**
 * Lock del scroll del body, compartido por todos los modales y drawers.
 *
 * Cada componente guardaba y restauraba `document.body.style.overflow` por su
 * cuenta (`const prev = …; body.style.overflow = 'hidden'; return () => {
 * body.style.overflow = prev }`). Eso se rompe cuando dos overlays se solapan,
 * que es exactamente lo que pasa en los handoffs del tipo "detalle → editar":
 * el modal nuevo monta mientras el anterior todavía está desmontándose (tiene
 * `exit` dentro de un AnimatePresence), así que captura `prev = 'hidden'`; el
 * viejo termina su salida y restaura `''`, y al cerrar el nuevo se vuelve a
 * escribir `overflow: hidden` sobre un body que ya no tiene ningún overlay
 * abierto. La página queda sin scroll hasta recargar.
 *
 * Con un contador compartido el valor original se captura una sola vez (en el
 * primer lock) y se restaura una sola vez (al liberarse el último), sin
 * importar cuántos overlays se pisen ni en qué orden cierren.
 */
let locks = 0
let restoreTo = ''

/**
 * Toma el lock y devuelve la función que lo libera. El release es idempotente:
 * llamarlo dos veces no descuenta dos veces, así que un cleanup duplicado no
 * puede dejar el contador en negativo y desbloquear de más.
 *
 * @returns {() => void}
 */
export function lockBodyScroll() {
  if (locks === 0) restoreTo = document.body.style.overflow
  locks += 1
  document.body.style.overflow = 'hidden'

  let released = false
  return function releaseBodyScroll() {
    if (released) return
    released = true
    locks -= 1
    if (locks === 0) document.body.style.overflow = restoreTo
  }
}

/**
 * Bloquea el scroll del body mientras el componente esté montado.
 *
 * Va en su propio efecto sin dependencias a propósito: cuando el lock viajaba
 * dentro del efecto del listener de Escape (`[onClose]`, `[onClose,
 * submitting]`) se soltaba y volvía a tomar en cada rerun, que es otra ventana
 * para leer un `prev` contaminado por otro overlay.
 */
export function useScrollLock() {
  useEffect(() => lockBodyScroll(), [])
}
