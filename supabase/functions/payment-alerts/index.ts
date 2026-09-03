// ============================================================
// Supabase Edge Function: payment-alerts  (FR-13)
// Corre 1 vez por día. Revisa invoices Invoiced sin pago al contractor y encola
// un email-digest con las que están en warning u overdue.
//
// Flujo Billing → Payments (sin Collections): una factura emitida (Invoiced) es
// pagable directo; al pagarla pasa a Paid. El vencimiento corre desde la fecha de
// factura (igual que el frontend en PaymentsPage):
//   payment_due_date = invoice_date + payment_terms_days
//   days_until_due   = payment_due_date - hoy
//   warning : days_until_due <= warning_days_before_due
//   overdue : days_until_due < 0
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

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
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
      .from("payment_alert_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (!settings) return json({ ok: false, error: "No settings" }, 200);

    const warnBefore: number = settings.warning_days_before_due ?? 3;
    const recipients: string[] = settings.email_recipients ?? [];

    // Invoices Invoiced (pendientes de pago al contractor; al pagar pasan a Paid).
    // Modelo AGRUPADO en horas (slice 04d): la factura ya no lleva monto/moneda ni un
    // único contractor (user_name). El deadline sigue por factura; se identifica por el
    // SP invoice number. La fecha base es invoice_date si existe, si no created_at (las
    // facturas agrupadas no cargan invoice_date).
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("id, sp_invoice_number, supplier_invoice_number, invoice_date, created_at, payment_terms_days")
      .eq("status", "Invoiced");
    if (error) return json({ ok: false, error: error.message }, 200);

    const affected: any[] = [];
    for (const inv of invoices ?? []) {
      const issue = inv.invoice_date ?? (inv.created_at ? String(inv.created_at).slice(0, 10) : null);
      // Sin fecha base no hay deadline calculable → se omite.
      if (!issue) continue;
      const dueDate = addDaysISO(issue, inv.payment_terms_days ?? 30);
      const days = daysUntil(dueDate);
      let level: "warning" | "overdue" | null = null;
      if (days < 0) level = "overdue";
      else if (days <= warnBefore) level = "warning";
      if (!level) continue;
      affected.push({
        level,
        // sp_invoice_number es el número de la factura agrupada; para filas legacy que
        // sólo tengan supplier_invoice_number se cae a ése, y a `#id` si faltan ambos,
        // para no imprimir "null" en la alerta.
        invoice: inv.sp_invoice_number ?? inv.supplier_invoice_number ?? `#${inv.id}`,
        days,
        dueDate,
      });
    }

    const overdue = affected.filter((a) => a.level === "overdue").length;
    const warning = affected.filter((a) => a.level === "warning").length;

    let queued = 0;
    if (affected.length > 0 && recipients.length > 0) {
      const lines = affected
        .sort((a, b) => a.days - b.days)
        .map(
          (a) =>
            `- [${a.level.toUpperCase()}] ${a.invoice} · ` +
            (a.days < 0 ? `${Math.abs(a.days)} días vencido` : `vence en ${a.days} días`),
        );
      const body = [
        `Pagos a contractor que necesitan atención: ${affected.length} (${overdue} overdue, ${warning} warning).`,
        "",
        ...lines,
      ].join("\n");

      await supabase.from("email_outbox").insert({
        recipients,
        subject: `Payments alert: ${affected.length} contractor payments overdue`,
        body,
        category: "payment_alert",
      });
      queued = 1;
    }

    return json({ ok: true, scanned: invoices?.length ?? 0, overdue, warning, queued });
  } catch (e) {
    console.log("payment-alerts error:", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 200);
  }
});
