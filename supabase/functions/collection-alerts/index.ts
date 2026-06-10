// ============================================================
// Supabase Edge Function: collection-alerts  (FR-12)
// Corre 1 vez por día. Revisa facturas no cobradas y encola un email-digest
// en email_outbox con las que están en warning u overdue.
//
//   days_pending = hoy - invoice_date
//   warning  : days_pending >= payment_terms_days - warning_days_before_due
//   overdue  : days_pending > payment_terms_days
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function daysSince(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - then) / 86400000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: settings } = await supabase
      .from("collection_alert_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (!settings) return json({ ok: false, error: "No settings" }, 200);

    const warningBefore: number = settings.warning_days_before_due ?? 7;
    const recipients: string[] = settings.email_recipients ?? [];

    // Facturas todavía no cobradas (status 'Invoiced'; Collected/Paid ya están).
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("id, supplier_invoice_number, user_name, total_amount, invoice_date, payment_terms_days")
      .eq("status", "Invoiced");
    if (error) return json({ ok: false, error: error.message }, 200);

    const affected: any[] = [];
    for (const inv of invoices ?? []) {
      const days = daysSince(inv.invoice_date);
      const terms = inv.payment_terms_days ?? 30;
      let level: "warning" | "overdue" | null = null;
      if (days > terms) level = "overdue";
      else if (days >= terms - warningBefore) level = "warning";
      if (!level) continue;
      affected.push({
        level,
        invoice: inv.supplier_invoice_number,
        contractor: inv.user_name,
        amount: Number(inv.total_amount),
        days,
        terms,
      });
    }

    const overdue = affected.filter((a) => a.level === "overdue").length;
    const warning = affected.filter((a) => a.level === "warning").length;

    let queued = 0;
    if (affected.length > 0 && recipients.length > 0) {
      const lines = affected
        .sort((a, b) => b.days - a.days)
        .map(
          (a) =>
            `- [${a.level.toUpperCase()}] ${a.invoice} · ${a.contractor} · $${a.amount.toFixed(2)} · ${a.days} días (plazo ${a.terms})`,
        );
      const body = [
        `Facturas que necesitan atención: ${affected.length} (${overdue} overdue, ${warning} warning).`,
        "",
        ...lines,
      ].join("\n");

      await supabase.from("email_outbox").insert({
        recipients,
        subject: `Collections alert: ${affected.length} invoices need attention`,
        body,
        category: "collection_alert",
      });
      queued = 1;
    }

    return json({ ok: true, scanned: invoices?.length ?? 0, overdue, warning, queued });
  } catch (e) {
    console.log("collection-alerts error:", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 200);
  }
});
