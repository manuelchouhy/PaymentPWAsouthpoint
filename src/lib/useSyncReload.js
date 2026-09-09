import { useEffect, useState } from 'react'

/**
 * Evento global que se dispara cuando el sync de Zoho termina con éxito
 * (lo emite el botón "Refresh now" del Header). Las páginas que muestran datos
 * sincronizados lo escuchan para re-fetchear sin recargar la ventana.
 */
export const SYNC_COMPLETED_EVENT = 'sync:completed'

/** Emite el evento global de sync terminado. */
export function emitSyncCompleted() {
  window.dispatchEvent(new CustomEvent(SYNC_COMPLETED_EVENT))
}

/**
 * Suscribe una página al evento global de sync: cuando el sync termina, bumpea
 * el reloadKey de la página para que su useEffect vuelva a cargar los datos.
 * Recarga suave: no toca la ventana ni el service worker.
 *
 * @param {(updater: (k: number) => number) => void} setReloadKey
 */
export function useSyncReload(setReloadKey) {
  useEffect(() => {
    function onSync() {
      setReloadKey((k) => k + 1)
    }
    window.addEventListener(SYNC_COMPLETED_EVENT, onSync)
    return () => window.removeEventListener(SYNC_COMPLETED_EVENT, onSync)
  }, [setReloadKey])
}

/**
 * Variante para páginas que no manejan su propio reloadKey: devuelve un contador
 * que se incrementa cuando termina el sync. Poné el valor devuelto en las deps
 * del useEffect de carga para que vuelva a fetchear.
 *
 * @returns {number} reloadKey que cambia en cada sync completado
 */
export function useSyncReloadKey() {
  const [reloadKey, setReloadKey] = useState(0)
  useSyncReload(setReloadKey)
  return reloadKey
}
