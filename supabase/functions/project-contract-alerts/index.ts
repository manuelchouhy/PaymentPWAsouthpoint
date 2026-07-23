// ============================================================
// Supabase Edge Function: project-contract-alerts  (FR-08)
// Corre 1 vez por día (vía pg_cron). Recorre proyectos cuyo contrato vence
// dentro del umbral más amplio y encola un email por cada uno en email_outbox.
//
// Frecuencias (contract_alert_settings.email_frequency):
//   'on_threshold_cross' → 1 email por proyecto por umbral cruzado (90/60/30/0).
//   'daily'              → 1 email por proyecto en cada corrida.
//   'weekly'             → 1 email por proyecto si no se mandó en los últimos 7 días.
//
// Mientras no haya servicio de email, se encola en email_outbox (stub).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: settings, error: sErr } = await supabase
      .from("contract_alert_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (sErr || !settings) {
      return json({ ok: false, error: "No se pudo leer contract_alert_settings" }, 200);
    }

    const thresholds = [
      settings.threshold_1_days,
      settings.threshold_2_days,
      settings.threshold_3_days,
    ];
    const widest = Math.max(...thresholds);
    const frequency: string = settings.email_frequency;
    const recipients: string[] = settings.email_recipients ?? [];
    // Sin destinatarios configurados: no tiene sentido encolar (fallaría al
    // enviar con "Recipients: None") ni marcar los proyectos como ya alertados
    // en contract_alert_log — se corta acá para no perder el aviso una vez
    // que sí se configuren destinatarios.
    if (recipients.length === 0) {
      return json({ ok: true, queued: 0, note: "No recipients configured." });
    }

    // Proyectos cuyo contrato vence dentro de la ventana más amplia.
    const horizon = isoDaysFromNow(widest);
    const { data: projects, error: pErr } = await supabase
      .from("projects")
      .select("id, project_name, client, contract_number, contract_expiration_date")
      .lte("contract_expiration_date", horizon);
    if (pErr) {
      return json({ ok: false, error: pErr.message }, 200);
    }

    let queued = 0;
    const weekAgo = isoDaysFromNow(-7);

    for (const p of projects ?? []) {
      const days = daysUntil(p.contract_expiration_date);
      const threshold = pickThreshold(days, thresholds);
      if (threshold === null) continue;

      // Anti-spam según frecuencia.
      if (frequency === "on_threshold_cross") {
        const { data: existing } = await supabase
          .from("contract_alert_log")
          .select("id")
          .eq("project_id", p.id)
          .eq("threshold_days", threshold)
          .limit(1);
        if (existing && existing.length) continue;
      } else if (frequency === "weekly") {
        const { data: recent } = await supabase
          .from("contract_alert_log")
          .select("id")
          .eq("project_id", p.id)
          .gte("email_sent_at", `${weekAgo}T00:00:00Z`)
          .limit(1);
        if (recent && recent.length) continue;
      }
      // 'daily' → siempre.

      const subject =
        `Contract alert: ${p.project_name} expires in ${days} days`;
      const body = [
        `Project: ${p.project_name}`,
        `Client: ${p.client}`,
        `Contract #: ${p.contract_number}`,
        `Expiration date: ${p.contract_expiration_date}`,
        `Days remaining: ${days}`,
      ].join("\n");

      await supabase.from("email_outbox").insert({
        recipients,
        subject,
        body,
        category: "contract_alert",
      });
      await supabase.from("contract_alert_log").insert({
        project_id: p.id,
        threshold_days: threshold,
        days_remaining: days,
      });
      queued++;
    }

    return json({ ok: true, scanned: projects?.length ?? 0, queued });
  } catch (e) {
    console.log("contract-alerts error:", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 200);
  }
});
