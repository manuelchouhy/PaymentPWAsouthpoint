// Supabase Edge Function: process-email-outbox (SRS 8.3)
// Reads pending rows from email_outbox and sends via Resend API.
// Scheduled every 5 minutes via pg_cron.
//
// Required secret: RESEND_API_KEY (set in Supabase Dashboard → Settings → Edge Functions → Secrets)
// Sender: must match a domain verified in Resend. Use 'onboarding@resend.dev' for testing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Change to your verified Resend sender domain. Use onboarding@resend.dev for sandbox testing.
const FROM_ADDRESS = "Southpoint Contractors <notifications@southpointlabs.com>";
const MAX_RETRIES = 3;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(subject: string, category: string, body: string): string {
  const isPriority = category === "supplier_priority_alert";
  const accent = isPriority ? "#dc2626" : "#7c3aed";
  const badge = isPriority ? "&#9888;&#65039; PRIORITY — Action Required" : "Automated Alert";

  const bodyHtml = body
    .split("\n")
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${esc(line)}</p>`
        : "<br>"
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td>
      <table width="600" cellpadding="0" cellspacing="0"
             style="margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;box-shadow:0 4px 24px rgba(0,0,0,.06)">
        <!-- Header -->
        <tr>
          <td style="background:#0a0a0a;padding:24px 32px">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">
              SOUTHPOINT TECH LABS
            </p>
            <p style="margin:6px 0 0;font-size:12px;color:#a0a0ab">Contractors Management System</p>
          </td>
        </tr>
        <!-- Accent bar -->
        <tr><td style="height:4px;background:${accent}"></td></tr>
        <!-- Title -->
        <tr>
          <td style="padding:28px 32px 12px">
            <p style="margin:0;font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.8px">
              ${badge}
            </p>
            <h1 style="margin:10px 0 0;font-size:20px;font-weight:700;color:#09090b;line-height:1.3">
              ${esc(subject)}
            </h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:8px 32px 32px;line-height:1.7">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#f9f9fa;border-top:1px solid #e4e4e7">
            <p style="margin:0;font-size:12px;color:#a0a0ab">
              Generated automatically by the Contractors System. Do not reply to this email.
            </p>
            <p style="margin:4px 0 0;font-size:12px;color:#c4c4cc">${new Date().toUTCString()}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("RESEND_API_KEY secret is not configured.");
    return json({ ok: false, error: "RESEND_API_KEY secret not configured" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: pending, error: fetchErr } = await supabase
      .from("email_outbox")
      .select("*")
      .is("sent_at", null)
      .is("failed_at", null)
      .lt("retry_count", MAX_RETRIES)
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchErr) return json({ ok: false, error: fetchErr.message });
    if (!pending?.length) return json({ ok: true, processed: 0, sent: 0, failed: 0 });

    let sent = 0;
    let failed = 0;

    for (const email of pending) {
      // No recipients → skip, mark failed immediately
      if (!email.recipients?.length) {
        await supabase
          .from("email_outbox")
          .update({ failed_at: new Date().toISOString() })
          .eq("id", email.id);
        failed++;
        continue;
      }

      const html = buildHtml(
        email.subject ?? "",
        email.category ?? "",
        email.body ?? "",
      );

      let resErr: string | null = null;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: email.recipients,
            subject: email.subject,
            html,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          resErr = `Resend ${res.status}: ${text}`;
        }
      } catch (e) {
        resErr = String((e as Error)?.message ?? e);
      }

      if (!resErr) {
        await supabase
          .from("email_outbox")
          .update({ sent_at: new Date().toISOString() })
          .eq("id", email.id);
        sent++;
      } else {
        console.error(`email_outbox id=${email.id} send failed: ${resErr}`);
        const newRetry = (email.retry_count ?? 0) + 1;
        const upd: Record<string, unknown> = { retry_count: newRetry };
        if (newRetry >= MAX_RETRIES) upd.failed_at = new Date().toISOString();
        await supabase.from("email_outbox").update(upd).eq("id", email.id);
        failed++;
      }
    }

    return json({ ok: true, processed: pending.length, sent, failed });
  } catch (e) {
    console.error("process-email-outbox error:", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
