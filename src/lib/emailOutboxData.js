import { supabase } from './supabase'

export async function getEmailOutbox() {
  const { data, error } = await supabase
    .from('email_outbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    recipients: r.recipients ?? [],
    subject: r.subject,
    body: r.body,
    category: r.category,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    failedAt: r.failed_at,
    retryCount: r.retry_count ?? 0,
  }))
}

// Reset a failed email so the cron job picks it up again on the next run.
export async function retryEmail(id) {
  const { error } = await supabase
    .from('email_outbox')
    .update({ failed_at: null, retry_count: 0 })
    .eq('id', id)
  if (error) throw error
}
