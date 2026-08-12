import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { ClientFormModal } from '../components/ClientFormModal'
import { ClientDetailDrawer } from '../components/ClientDetailDrawer'
import { Toast } from '../components/Toast'

export function ClientsPage() {
  const { user, can } = useOutletContext()
  const [clients, setClients] = useState([])
  const [status, setStatus] = useState('loading')
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    api.clients.list()
      .then((data) => {
        if (cancelled) return
        setClients(data)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar los clientes:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(payload, msaFile) {
    const msaUrl = await api.clients.uploadMsa(msaFile)
    const created = await api.clients.create({ ...payload, msaUrl }, user?.email ?? null)
    api.audit.log({
      actorEmail: user?.email,
      action: 'client.create',
      resourceType: 'client',
      resourceId: created.id,
      after: { clientName: created.clientName },
    })
    setClients((prev) => [...prev, created].sort((a, b) => a.clientName.localeCompare(b.clientName, 'es')))
    setFormOpen(false)
    setToast({ id: Date.now(), message: `Client created: ${created.clientName}` })
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
          <span className="masthead__kicker">Client management</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Clients</h1>
        <p className="masthead__sub">
          Master list of clients, with their MSA on file. Projects and SO
          look up their MSA from here.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading clients…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load clients</h2>
        </div>
      )}

      {status === 'ready' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="toolbar">
            {can('clients.create') && (
              <button type="button" className="btn btn--pay" onClick={() => setFormOpen(true)}>
                <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                New Client
              </button>
            )}
            <span className="toolbar__count">
              {clients.length} {clients.length === 1 ? 'client' : 'clients'}
            </span>
          </div>

          {clients.length === 0 ? (
            <div className="empty">No clients to display.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Client Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Domain</th>
                    <th scope="col">Primary Contact</th>
                    <th scope="col">Contact Email</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, index) => (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.3) }}
                      onClick={() => setDetail(c)}
                      title={`View ${c.clientName}`}
                    >
                      <td className="cell-strong">{c.clientName}</td>
                      <td className="cell-soft">{c.email || '—'}</td>
                      <td className="cell-mono">{c.domain || '—'}</td>
                      <td>{c.primaryContactName}</td>
                      <td className="cell-soft">{c.primaryContactEmail}</td>
                      <td className="cell-mono">{formatDateTime(c.createdAt)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {formOpen && (
          <ClientFormModal
            key="new-client"
            onClose={() => setFormOpen(false)}
            onSubmit={handleCreate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <ClientDetailDrawer
            key={`client-detail-${detail.id}`}
            client={detail}
            onClose={() => setDetail(null)}
            onEdit={() => {
              setDetail(null)
              setToast({ id: Date.now(), message: 'Editing clients is coming in the next update.' })
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
