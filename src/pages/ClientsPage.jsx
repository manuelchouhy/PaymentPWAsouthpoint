import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { ClientFormModal } from '../components/ClientFormModal'
import { ClientDetailDrawer } from '../components/ClientDetailDrawer'
import { Toast } from '../components/Toast'

const sortByName = (list) => [...list].sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'))

export function ClientsPage() {
  const { user, can } = useOutletContext()
  const [clients, setClients] = useState([])
  const [status, setStatus] = useState('loading')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
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
    // MSA opcional: si no se subió archivo, el cliente se crea sin MSA (trabajo
    // interno, o alta previa a la firma) y no se registra versión en el historial.
    const msaUrl = msaFile ? await api.clients.uploadMsa(msaFile) : null
    const created = await api.clients.create({ ...payload, msaUrl }, user?.email ?? null)
    if (msaUrl) {
      await api.clients.recordMsaVersion({ clientId: created.id, fileUrl: msaUrl, uploadedBy: user?.email ?? null })
    }
    api.audit.log({
      actorEmail: user?.email,
      action: 'client.create',
      resourceType: 'client',
      resourceId: created.id,
      after: { clientName: created.clientName },
    })
    setClients((prev) => sortByName([...prev, created]))
    setFormOpen(false)
    setToast({ id: Date.now(), message: `Client created: ${created.clientName}` })
  }

  async function handleUpdate(payload, msaFile) {
    let msaUrl = editing.msaUrl
    if (msaFile) {
      msaUrl = await api.clients.uploadMsa(msaFile)
    }
    const updated = await api.clients.update(editing, { ...payload, msaUrl })
    if (msaFile) {
      await api.clients.recordMsaVersion({ clientId: updated.id, fileUrl: msaUrl, uploadedBy: user?.email ?? null })
    }
    api.audit.log({
      actorEmail: user?.email,
      action: 'client.update',
      resourceType: 'client',
      resourceId: updated.id,
      before: { clientName: editing.clientName },
      after: { clientName: updated.clientName },
    })
    setClients((prev) => sortByName(prev.map((c) => (c.id === updated.id ? updated : c))))
    setEditing(null)
    setToast({ id: Date.now(), message: `Client updated: ${updated.clientName}` })
  }

  async function handleDeactivate(client) {
    // Borrado lógico (definido en la reunión): no se elimina la fila, se desactiva.
    // Si el cliente todavía tiene proyectos vinculados, deactivateClient lanza
    // (code 'has_projects'); se deja PROPAGAR para que el drawer muestre el motivo
    // inline y no se toque la lista.
    await api.clients.deactivate({ id: client.id })
    // El audit es fire-and-forget pero con catch (acción sensible).
    Promise.resolve(
      api.audit.log({
        actorEmail: user?.email,
        action: 'client.deactivate',
        resourceType: 'client',
        resourceId: client.id,
        before: { clientName: client.clientName },
      }),
    ).catch((e) => console.error('No se pudo registrar el audit de client.deactivate:', e))
    // getClients ya no lo trae (sólo activos): sale de la lista visible.
    setClients((prev) => prev.filter((c) => c.id !== client.id))
    setDetail(null)
    setToast({ id: Date.now(), message: `Client deactivated: ${client.clientName}` })
  }

  // Clientes auto-creados por el sync a completar (un solo scan para banner + count).
  const pendingReview = clients.filter((c) => c.needsReview)

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

          {pendingReview.length > 0 && (
            <div role="status" className="review-notice">
              ⚠ {pendingReview.length} client(s) were auto-created from Zoho project groups and need their
              data completed. Open each one and Save to clear the flag.
            </div>
          )}
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
                      <td className="cell-strong">
                        {c.clientName}
                        {c.needsReview && <span className="review-badge">needs review</span>}
                      </td>
                      <td className="cell-soft">{c.email || '—'}</td>
                      <td className="cell-mono">{c.domain || '—'}</td>
                      <td>{c.primaryContactName || '—'}</td>
                      <td className="cell-soft">{c.primaryContactEmail || '—'}</td>
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
        {editing && (
          <ClientFormModal
            key={`edit-client-${editing.id}`}
            initial={editing}
            onClose={() => setEditing(null)}
            onSubmit={handleUpdate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <ClientDetailDrawer
            key={`client-detail-${detail.id}`}
            client={detail}
            canEdit={can('clients.edit')}
            canDeactivate={can('clients.deactivate')}
            onClose={() => setDetail(null)}
            onEdit={() => {
              setDetail(null)
              setEditing(detail)
            }}
            onDeactivate={() => handleDeactivate(detail)}
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
