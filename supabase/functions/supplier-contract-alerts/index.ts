// ============================================================
// Supabase Edge Function: supplier-contract-alerts  (FR-16)
// Corre 1 vez por día (vía pg_cron). Revisa supplier_contracts activos cuyo
// vencimiento cae dentro del umbral más amplio (90/60/30/0) y encola emails.
//
//   No priority → 1 email por umbral cruzado (anti-spam vía supplier_alert_log).
//                 Asunto: "Supplier contract alert: [Supplier] expires in [N] days".
//   Priority    → email DIARIO hasta renovar o marcar Renewal in Progress.
//                 Asunto: "Action Required: [Supplier] contract renewal — [N] days remaining".
//
// Skipea los contratos con status = 'Renewal in Progress' (snoozed) y los archivados.
// Mientras no haya servicio de email, se encola en email_outbox (stub).
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

// Días entre hoy (UTC, date-only) y una fecha ISO YYYY-MM-DD. Negativo = vencido.
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const exp = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((exp - today) / 86400000);
}

// Umbral (banda) cruzado por `days`: el más ajustado que cumple days <= t.
// Vencido (days < 0) → 0. Fuera de ventana → null.
function pickThreshold(days: number, thresholds: number[]): number | null {
  if (days < 0) return 0;
  const asc = [...thresholds].sort((a, b) => a - b);
  for (const t of asc) if (days <= t) return t;
  return null;
}

function isoDaysFromNow(offset: number): string {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(base + offset * 86400000).toISOString().slice(0, 10);
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
    const { data: settings, error: sErr } = await supabase
      .from("supplier_alert_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (sErr || !settings) {
      return json({ ok: false, error: "No se pudo leer supplier_alert_settings" }, 200);
    }

    const thresholds = [
      settings.threshold_1_days,
      settings.threshold_2_days,
      settings.threshold_3_days,
    ];
    const widest = Math.max(...thresholds);
    const teamRecipients: string[] = settings.email_recipients ?? [];
    const priorityRecipients: string[] = settings.priority_supplier_email_recipients ?? [];

    // Contratos activos (no archivados, no snoozed) que vencen dentro de la ventana.
    const horizon = isoDaysFromNow(widest);
    const { data: contracts, error: cErr } = await supabase
      .from("supplier_contracts")
      .select("id, supplier_name, contract_number, expiration_date, is_priority_supplier, status, archived")
      .eq("archived", false)
      .neq("status", "Renewal in Progress")
      .lte("expiration_date", horizon);
    if (cErr) return json({ ok: false, error: cErr.message }, 200);

    const todayStart = `${isoDaysFromNow(0)}T00:00:00Z`;
    let queued = 0;
    let priorityQueued = 0;

    for (const c of contracts ?? []) {
      if (!c.expiration_date) continue;
      const days = daysUntil(c.expiration_date);
      const threshold = pickThreshold(days, thresholds);
      if (threshold === null) continue;

      if (c.is_priority_supplier) {
        // PRIORITY → email diario hasta que se accione. Anti-doble-envío: 1 por día.
        const { data: sentToday } = await supabase
          .from("supplier_alert_log")
          .select("id")
          .eq("contract_id", c.id)
          .gte("email_sent_at", todayStart)
          .limit(1);
        if (sentToday && sentToday.length) continue;

        const subject =
          `Action Required: ${c.supplier_name} contract renewal — ${days} days remaining`;
        const body = [
          `PRIORITY SUPPLIER — action required.`,
          ``,
          `Supplier: ${c.supplier_name}`,
          `Contract #: ${c.contract_number}`,
          `Expiration date: ${c.expiration_date}`,
          days < 0
            ? `Status: EXPIRED ${Math.abs(days)} days ago`
            : `Days remaining: ${days}`,
          ``,
          `Renew the contract or mark it as "Renewal in Progress" to stop these alerts.`,
        ].join("\n");

        await supabase.from("email_outbox").insert({
          recipients: priorityRecipients,
          subject,
          body,
          category: "supplier_priority_alert",
        });
        await supabase.from("supplier_alert_log").insert({
          contract_id: c.id,
          threshold_crossed: threshold,
          email_sent_at: new Date().toISOString(),
        });
        priorityQueued++;
        continue;
      }

      // NO priority → 1 email por umbral cruzado.
      const { data: already } = await supabase
        .from("supplier_alert_log")
        .select("id")
        .eq("contract_id", c.id)
        .eq("threshold_crossed", threshold)
        .not("email_sent_at", "is", null)
        .limit(1);
      if (already && already.length) continue;

      const subject = `Supplier contract alert: ${c.supplier_name} expires in ${days} days`;
      const body = [
        `Supplier: ${c.supplier_name}`,
        `Contract #: ${c.contract_number}`,
        `Expiration date: ${c.expiration_date}`,
        `Days remaining: ${days}`,
      ].join("\n");

      await supabase.from("email_outbox").insert({
        recipients: teamRecipients,
        subject,
        body,
        category: "supplier_contract_alert",
      });
      await supabase.from("supplier_alert_log").insert({
        contract_id: c.id,
        threshold_crossed: threshold,
        email_sent_at: new Date().toISOString(),
      });
      queued++;
    }

    return json({
      ok: true,
      scanned: contracts?.length ?? 0,
      queued,
      priorityQueued,
    });
  } catch (e) {
    console.log("supplier-contract-alerts error:", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 200);
  }
});
