import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { api } from '../lib/api'

/**
 * Dropdown de clientes existentes + autopopulado (solo lectura) del MSA
 * asociado. Pensado para reusarse en el wizard de Projects and SOW: "al
 * elegir el cliente, se autopopula el MSA... no se edita a mano" (reunión
 * 2026-08-05).
 *
 * @param {{
 *   value: string|number|null,
 *   onChange: (clientId: string|number|null, client: object|null) => void,
 *   disabled?: boolean,
 *   error?: string,
 * }} props
 */
export function ClientPicker({
  value,
  onChange,
  disabled,
  error,
  label = 'Client',
  required = true,
  id = 'client-picker',
  showMsaHint = true,
}) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.clients
      .list()
      .then((rows) => !cancelled && setClients(rows))
      .catch((e) => !cancelled && setLoadError(e?.message ?? 'Could not load clients.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const selected = clients.find((c) => String(c.id) === String(value)) ?? null

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && <span className="field__req">required</span>}
      </label>
      <select
        id={id}
        className={`field__input${error ? ' field__input--error' : ''}`}
        value={value ?? ''}
        disabled={disabled || loading}
        onChange={(e) => {
          const id = e.target.value || null
          onChange(id, clients.find((c) => String(c.id) === String(id)) ?? null)
        }}
      >
        <option value="">{loading ? 'Loading clients…' : 'Select a client…'}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.clientName}
          </option>
        ))}
      </select>
      {error && <span className="field__error">{error}</span>}
      {loadError && <span className="field__error">{loadError}</span>}

      {selected && showMsaHint && (
        <div className="field__hint" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={13} strokeWidth={2} aria-hidden="true" />
          MSA on file · autopopulated from {selected.clientName}, not editable here
        </div>
      )}
    </div>
  )
}
