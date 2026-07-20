import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

/**
 * Toast de confirmación / aviso. Sube desde abajo con spring physics y se
 * descarta solo tras unos segundos (o con el botón de cierre).
 *
 * @param {{ message: string, tone?: 'success' | 'error', onDismiss: () => void }} props
 */
export function Toast({ message, tone = 'success', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, tone === 'error' ? 7000 : 4000)
    return () => clearTimeout(timer)
  }, [message, tone, onDismiss])

  const Icon = tone === 'error' ? AlertCircle : CheckCircle2

  return (
    <div className="toast-layer">
      <motion.div
        className={`toast toast--${tone}`}
        role={tone === 'error' ? 'alert' : 'status'}
        aria-live={tone === 'error' ? 'assertive' : 'polite'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="toast__icon">
          <Icon size={18} strokeWidth={2.2} />
        </span>
        <span className="toast__msg">{message}</span>
        <button
          type="button"
          className="toast__close"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          <X size={15} />
        </button>
      </motion.div>
    </div>
  )
}
