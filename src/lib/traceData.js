import { supabase, isSupabaseConfigured } from './supabase'

function rowToTrace(row) {
  return {
    timeEntryId: row.time_entry_id,
    zohoLogId: row.zoho_log_id,
    userName: row.user_name,
    logDate: row.log_date,
    hours: Number(row.hours),
    client: row.client,
    project: row.project,
    task: row.task,
    description: row.description,
    zohoStatus: row.zoho_status,
    syncedAt: row.synced_at,
    invoiceId: row.invoice_id,
    supplierInvoiceNumber: row.supplier_invoice_number,
    invoiceDate: row.invoice_date,
    invoiceAmount: row.invoice_amount != null ? Number(row.invoice_amount) : null,
    invoiceStatus: row.invoice_status,
    paymentTermsDays: row.payment_terms_days,
    invoicedAt: row.invoiced_at,
    invoicedBy: row.invoiced_by,
    collectedAmount: Number(row.collected_amount || 0),
    lastCollectionDate: row.last_collection_date,
    collectionCount: Number(row.collection_count || 0),
    paymentId: row.payment_id,
    amountPaid: row.amount_paid != null ? Number(row.amount_paid) : null,
    paymentDate: row.payment_date,
    transferReference: row.transfer_reference,
    bankMethod: row.bank_method,
    paymentNotes: row.payment_notes,
    paidAt: row.paid_at,
    paidBy: row.paid_by,
  }
}

export async function searchTrace({ search, contractor, project, dateFrom, dateTo } = {}) {
  if (!isSupabaseConfigured) return []

  let query = supabase
    .from('trace_view')
    .select('*')
    .order('log_date', { ascending: false })
    .limit(1000)

  if (contractor) query = query.ilike('user_name', `%${contractor}%`)
  if (project) query = query.ilike('project', `%${project}%`)
  if (dateFrom) query = query.gte('log_date', dateFrom)
  if (dateTo) query = query.lte('log_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  let rows = data.map(rowToTrace)

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(
      (r) =>
        (r.userName ?? '').toLowerCase().includes(q) ||
        (r.project ?? '').toLowerCase().includes(q) ||
        (r.client ?? '').toLowerCase().includes(q) ||
        (r.supplierInvoiceNumber ?? '').toLowerCase().includes(q) ||
        (r.zohoLogId ?? '').toLowerCase().includes(q),
    )
  }

  return rows
}

export async function getCollectionsForInvoice(invoiceId) {
  if (!isSupabaseConfigured || !invoiceId) return []
  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('collection_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data.map((c) => ({
    id: c.id,
    amountReceived: Number(c.amount_received),
    collectionDate: c.collection_date,
    bankReference: c.bank_reference,
    notes: c.notes,
    createdAt: c.created_at,
    createdBy: c.created_by,
  }))
}
