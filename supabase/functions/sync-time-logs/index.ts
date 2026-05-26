// ============================================================
// Supabase Edge Function: sync-time-logs
// Porta la lógica del conector de Domo (Zoho Projects → tabla)
// Extrae time logs de Zoho y hace upsert en la tabla time_entries.
// ============================================================
//
// Variables de entorno necesarias (Supabase → Edge Functions → Secrets):
//   ZOHO_CLIENT_ID
//   ZOHO_CLIENT_SECRET
//   ZOHO_REFRESH_TOKEN
//   SUPABASE_URL              (la inyecta Supabase automáticamente)
//   SUPABASE_SERVICE_ROLE_KEY (la inyecta Supabase automáticamente)
//
// Si tu cuenta de Zoho NO es US, cambiá el dominio en ZOHO_ACCOUNTS y
// los hosts de la API (.eu / .in / .com.au / .com.cn).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZOHO_ACCOUNTS = "https://accounts.zoho.com";
const ZOHO_V3 = "https://projectsapi.zoho.com/api/v3";
const ZOHO_V1 = "https://projectsapi.zoho.com/restapi";

// ---------- Helpers ----------
async function zohoGet(url: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: "Zoho-oauthtoken " + token },
    });
    if (!res.ok) {
      console.log(`HTTP ${res.status} on ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`Fetch/JSON error on ${url}: ${e}`);
    return null;
  }
}

async function fetchAllPagesV3(
  baseUrl: string,
  dataKey: string,
  token: string,
): Promise<any[]> {
  let results: any[] = [];
  let page = 1;
  while (page <= 50) {
    const sep = baseUrl.indexOf("?") === -1 ? "?" : "&";
    const data = await zohoGet(
      `${baseUrl}${sep}page=${page}&per_page=100`,
      token,
    );
    if (!data) break;
    const items = Array.isArray(data) ? data : (data[dataKey] || []);
    results = results.concat(items);
    if (!data.page_info || !data.page_info.has_next_page) break;
    page++;
  }
  return results;
}

function safe(obj: any, path: string, fallback: any): any {
  if (obj == null) return fallback;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return fallback;
    cur = cur[p];
  }
  return cur == null ? fallback : cur;
}

// Zoho log date "MM-DD-YYYY" -> ISO "YYYY-MM-DD"
function logDateToISO(s: string): string | null {
  if (!s || s.length < 10) return null;
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[0]}-${parts[1]}`;
}

// ---------- Access token ----------
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: Deno.env.get("ZOHO_REFRESH_TOKEN")!,
    client_id: Deno.env.get("ZOHO_CLIENT_ID")!,
    client_secret: Deno.env.get("ZOHO_CLIENT_SECRET")!,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("No access_token from Zoho. Revisá las credenciales.");
  }
  return data.access_token;
}

// ---------- Main ----------
Deno.serve(async (_req) => {
  try {
    const token = await getAccessToken();
    console.log("Access token obtenido");

    // Portal
    const portals = await zohoGet(`${ZOHO_V3}/portals`, token);
    if (!portals || !portals[0]) {
      return json({ error: "No portal found" }, 500);
    }
    const portalId = portals[0].id;
    console.log("Portal ID:", portalId);

    // Projects
    const projects = await fetchAllPagesV3(
      `${ZOHO_V3}/portal/${portalId}/projects`,
      "projects",
      token,
    );
    console.log("Projects:", projects.length);

    // Fechas mes a mes desde enero hasta el mes actual
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthDates: string[] = [];
    for (let m = 1; m <= currentMonth; m++) {
      const mm = m < 10 ? "0" + m : "" + m;
      monthDates.push(`${mm}-15-${currentYear}`);
    }

    const rows: any[] = [];

    for (const p of projects) {
      const projectId = p.id;
      const projectName = p.name;
      const projectStatus = safe(p, "status.name", "");
      const projectOwner = safe(p, "owner.full_name", "");

      for (const dateParam of monthDates) {
        const logsUrl =
          `${ZOHO_V1}/portal/${portalId}/projects/${projectId}` +
          `/logs/?users_list=all&view_type=month&date=${dateParam}` +
          `&bill_status=All&component_type=task`;

        const logsData = await zohoGet(logsUrl, token);
        if (!logsData?.timelogs?.date) continue;

        for (const bucket of logsData.timelogs.date) {
          const logDate = logDateToISO(bucket.date);
          for (const tl of (bucket.tasklogs || [])) {
            rows.push({
              // --- mapeo a la tabla time_entries ---
              zoho_log_id: String(tl.id_string || tl.id || ""),
              user_name: tl.owner_name || safe(tl, "added_by.name", ""),
              project: projectName,
              task: safe(tl, "task.name", ""),
              description: tl.notes || "",
              notes: tl.notes || "",
              log_date: logDate,
              hours: Number(tl.total_minutes || 0) / 60,
              status: tl.approval_status || tl.bill_status || "",
              synced_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    console.log("Filas extraídas:", rows.length);

    if (rows.length === 0) {
      return json({ ok: true, synced: 0, note: "Sin time logs en el rango." });
    }

    // Upsert por zoho_log_id (no duplica)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // upsert en lotes de 500 para no pasarse de tamaño
    let synced = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("time_entries")
        .upsert(batch, { onConflict: "zoho_log_id" });
      if (error) {
        console.log("Upsert error:", error.message);
        return json({ error: error.message, synced }, 500);
      }
      synced += batch.length;
    }

    return json({ ok: true, synced });
  } catch (e) {
    console.log("Sync error:", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
