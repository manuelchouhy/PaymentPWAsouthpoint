import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

const POP_WIDTH = 300

/**
 * Botón-ícono que abre un popover con un texto largo (Description / Notes).
 * Mantiene las columnas de la grilla angostas y uniformes: en vez de volcar
 * todo el texto en la celda, se muestra bajo demanda.
 *
 * El popover se renderiza en un portal a <body> y se posiciona con `fixed`
 * para no quedar recortado por el scroll horizontal de la tabla.
 *
 * @param {{ label: string, text: string, icon: React.ComponentType<{size?:number}> }} props
 */
export function CellPopButton({ label, text, icon: Icon }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: 'bottom' })
  const btnRef = useRef(null)
  const popRef = useRef(null)

  const hasText = Boolean(text && text.trim())

  // Posicionar el popover respecto del botón (clamp a viewport).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    // Posicionamos por el borde izquierdo (sin translateX) para no chocar con
    // ningún transform de framer-motion. Clamp al viewport.
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - POP_WIDTH / 2, 8),
      window.innerWidth - POP_WIDTH - 8,
    )
    // Si no entra abajo, lo mostramos arriba del botón (translateY vía CSS).
    const spaceBelow = window.innerHeight - rect.bottom
    const placement = spaceBelow < 180 ? 'top' : 'bottom'
    const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8
    setCoords({ top, left, placement })
  }, [open])

  // Cerrar con Esc, click afuera, scroll o resize.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onPointerDown(event) {
      if (
        popRef.current?.contains(event.target) ||
        btnRef.current?.contains(event.target)
      ) {
        return
      }
      setOpen(false)
    }
    function onScrollOrResize() {
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    // capture: true → también captura el scroll del contenedor de la tabla.
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  if (!hasText) {
    return <span className="cell-pop-empty">—</span>
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`cell-pop-btn${open ? ' is-open' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`View ${label.toLowerCase()}`}
        title={`View ${label.toLowerCase()}`}
      >
        <Icon size={15} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <motion.div
            ref={popRef}
            className={`cell-popover cell-popover--${coords.placement}`}
            role="dialog"
            aria-label={label}
            style={{ top: coords.top, left: coords.left }}
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="cell-popover__label">{label}</span>
            <p className="cell-popover__text">{text}</p>
          </motion.div>,
          document.body,
        )}
    </>
  )
}
