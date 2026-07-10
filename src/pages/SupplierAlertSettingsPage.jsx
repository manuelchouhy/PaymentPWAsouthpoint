import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Save, Star } from 'lucide-react'
import { api } from '../lib/api'
import { Toast } from '../components/Toast'

export function SupplierAlertSettingsPage() {
  const { user } = useOutletContext()
  const [form, setForm] = useState(null)
  const [status, setStatus] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.supplierContracts.getAlertSettings()
      .then((s) => {
        if (cancelled) return
        setForm({
          threshold1Days: s.threshold1Days,
          threshold2Days: s.threshold2Days,
          threshold3Days: s.threshold3Days,
          recipientsText: (s.emailRecipients ?? []).join(', '),
          priorityRecipientsText: (s.prioritySupplierEmailRecipients ?? []).join(', '),
        })
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
    }
  }, [])

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function parseList(text) {
    return text.split(',').map((s) => s.trim()).filter(Boolean)
  }

  async function handleSave(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await api.supplierContracts.updateAlertSettings(
        {
          threshold1Days: Number(form.threshold1Days),
          threshold2Days: Number(form.threshold2Days),
          threshold3Days: Number(form.threshold3Days),
          emailRecipients: parseList(form.recipientsText),
          prioritySupplierEmailRecipients: parseList(form.priorityRecipientsText),
        },
        user?.email ?? null,
      )
      setToast({ id: Date.now(), message: 'Settings saved' })
    } catch (error) {
      setToast({ id: Date.now(), tone: 'error', message: error?.message ?? 'Could not save settings' })
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
          <Link to="/supplier-contracts" className="back-link">
            <ArrowLeft size={14} aria-hidden="true" /> Supplier Contracts
          </Link>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Supplier Contract Alerts</h1>
        <p className="masthead__sub">
          Warning thresholds and recipients. Priority suppliers (southpointlabs)
          use their own recipient list and receive daily alerts until the contract
          is renewed or marked as renewal in progress.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading settings…</p>}
      {status === 'error' && (
        <div className="empty">Could not load settings.</div>
      )}

      {status === 'ready' && form && (
        <motion.form
          className="settings-card"
          onSubmit={handleSave}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="settings-section">
            <span className="settings-section__label">Thresholds (days before expiration)</span>
            <div className="settings-grid">
              <div className="field">
                <label className="field__label" htmlFor="t1">Threshold 1</label>
                <input id="t1" type="number" min="0" className="field__input"
                  value={form.threshold1Days}
                  onChange={(e) => set('threshold1Days', e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="t2">Threshold 2</label>
                <input id="t2" type="number" min="0" className="field__input"
                  value={form.threshold2Days}
                  onChange={(e) => set('threshold2Days', e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="t3">Threshold 3</label>
                <input id="t3" type="number" min="0" className="field__input"
                  value={form.threshold3Days}
                  onChange={(e) => set('threshold3Days', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="field">
              <label className="field__label" htmlFor="recipients">
                Recipients — operations team (comma-separated emails)
              </label>
              <input id="recipients" type="text" className="field__input"
                value={form.recipientsText}
                placeholder="ops@company.com"
                onChange={(e) => set('recipientsText', e.target.value)} />
            </div>
          </div>

          <div className="settings-section">
            <div className="field">
              <label className="field__label" htmlFor="prio-recipients">
                <Star size={13} aria-hidden="true" className="sc-priority-star" />
                Priority recipients — southpointlabs (comma-separated emails)
              </label>
              <input id="prio-recipients" type="text" className="field__input"
                value={form.priorityRecipientsText}
                placeholder="ops@company.com, management@company.com"
                onChange={(e) => set('priorityRecipientsText', e.target.value)} />
            </div>
          </div>

          <div className="settings-actions">
            <motion.button type="submit" className="btn btn--pay" disabled={saving}
              whileTap={saving ? undefined : { scale: 0.97 }}>
              {saving ? <span className="spinner" aria-hidden="true" /> : <Save size={16} strokeWidth={2.2} />}
              {saving ? 'Saving…' : 'Save'}
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
