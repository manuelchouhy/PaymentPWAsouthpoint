import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Save } from 'lucide-react'
import {
  getPaymentAlertSettings,
  updatePaymentAlertSettings,
} from '../lib/paymentsData'
import { Toast } from '../components/Toast'

export function PaymentAlertSettingsPage() {
  const { user } = useOutletContext()
  const [form, setForm] = useState(null)
  const [status, setStatus] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPaymentAlertSettings()
      .then((s) => {
        if (cancelled) return
        setForm({
          warningDaysBeforeDue: s.warningDaysBeforeDue,
          recipientsText: (s.emailRecipients ?? []).join(', '),
        })
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
    }
  }, [])

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  async function handleSave(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await updatePaymentAlertSettings(
        {
          warningDaysBeforeDue: Number(form.warningDaysBeforeDue),
          emailRecipients: form.recipientsText.split(',').map((s) => s.trim()).filter(Boolean),
          emailFrequency: 'daily',
        },
        user?.email ?? null,
      )
      setToast({ id: Date.now(), message: 'Configuración guardada' })
    } catch (error) {
      setToast({ id: Date.now(), tone: 'error', message: error?.message ?? 'No se pudo guardar' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <Link to="/payments" className="back-link">
            <ArrowLeft size={14} aria-hidden="true" /> Payments
          </Link>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Alertas de pago</h1>
        <p className="masthead__sub">
          Umbral de aviso y destinatarios de las alertas de pagos al contractor
          vencidos.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Cargando configuración…</p>}
      {status === 'error' && <div className="empty">No se pudo cargar la configuración.</div>}

      {status === 'ready' && form && (
        <motion.form
          className="settings-card"
          onSubmit={handleSave}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="settings-section">
            <div className="field">
              <label className="field__label" htmlFor="warn">
                Días de aviso antes del vencimiento (warning)
              </label>
              <input id="warn" type="number" min="0" className="field__input"
                value={form.warningDaysBeforeDue}
                onChange={(e) => set('warningDaysBeforeDue', e.target.value)} />
            </div>
          </div>

          <div className="settings-section">
            <div className="field">
              <label className="field__label" htmlFor="recipients">
                Destinatarios (emails separados por coma)
              </label>
              <input id="recipients" type="text" className="field__input"
                value={form.recipientsText}
                placeholder="pagos@empresa.com, finanzas@empresa.com"
                onChange={(e) => set('recipientsText', e.target.value)} />
            </div>
          </div>

          <div className="settings-section">
            <p className="settings-note">Frecuencia de email: <strong>diaria</strong>.</p>
          </div>

          <div className="settings-actions">
            <motion.button type="submit" className="btn btn--pay" disabled={saving}
              whileTap={saving ? undefined : { scale: 0.97 }}>
              {saving ? <span className="spinner" aria-hidden="true" /> : <Save size={16} strokeWidth={2.2} />}
              {saving ? 'Guardando…' : 'Guardar'}
            </motion.button>
          </div>
        </motion.form>
      )}

      <AnimatePresence>
        {toast && (
          <Toast key={toast.id} message={toast.message} tone={toast.tone}
            onDismiss={() => setToast(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
