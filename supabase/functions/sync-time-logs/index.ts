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

// CORS: necesario para que el navegador (supabase.functions.invoke) pueda
// llamar la función. El preflight OPTIONS debe responder rápido y con estos
// headers, si no el browser bloquea el POST real.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Helpers ----------
// Backoff exponencial para reintentos: 2s, 4s, 8s (3 reintentos → 4 intentos).
const RETRY_DELAYS_MS = [2000, 4000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GET a Zoho con reintentos ante fallos transitorios (5xx / red / JSON).
// - 5xx o error de red/JSON  → reintenta con backoff; si se agotan, LANZA.
// - 4xx (4xx no es transitorio) → devuelve null sin reintentar.
// Lanzar ante 5xx agotado permite que el handler marque la corrida como 'Error'
// sin tocar lo ya sincronizado (el upsert recién ocurre al final).
async function zohoGet(url: string, token: string): Promise<any | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: "Zoho-oauthtoken " + token },
      });
      if (res.status >= 500) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(`HTTP ${res.status} on ${url}`);
      }
      if (!res.ok) {
        console.log(`HTTP ${res.status} on ${url}`);
        return null; // 4xx: no se reintenta
      }
      // 2xx: el body puede venir VACÍO (proyecto/mes sin time logs). Eso NO es
      // un error → devolvemos null para que el call site haga `continue`.
      const text = await res.text();
      if (!text || !text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        console.log(`Respuesta no-JSON en ${url}`);
        return null;
      }
    } catch (e) {
      // Error de RED (fetch rechazado): tratado como transitorio.
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw e;
    }
  }
  return null;
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

// Fecha de fin del proyecto en Zoho -> ISO YYYY-MM-DD (o null).
// Prioriza el epoch (end_date_long) que es independiente del formato del portal.
function zohoProjectEndDate(p: any): string | null {
  const long = p.end_date_long ?? safe(p, "end_date_long", null);
  if (long && Number(long) > 0) {
    const d = new Date(Number(long));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(p.end_date || safe(p, "end_date", "")).trim();
  if (s.length >= 8) {
    const parts = s.replace(/\//g, "-").split("-");
    if (parts.length === 3) {
      // YYYY-MM-DD o MM-DD-YYYY
      if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    }
  }
  return null;
}

// ---------- Access token ----------
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: Deno.env.get("ZOHO_REFRESH_TOKEN")!,
    client_id: Deno.env.get("ZOHO_CLIENT_ID")!,
    client_secret: Deno.env.get("ZOHO_CLIENT_SECRET")!,
    grant_type: "refresh_token",
  });

  // El token es crítico: reintentar ante fallos transitorios con el mismo backoff.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (res.status >= 500) {
        throw new Error(`Zoho token HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.access_token) {
        // Credenciales inválidas: no es transitorio, no reintentar.
        throw new Error("No access_token from Zoho. Revisá las credenciales.");
      }
      return data.access_token;
    } catch (e) {
      const transient = String(e).includes("HTTP 5");
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        const wait = RETRY_DELAYS_MS[attempt];
        console.log(`getAccessToken falló (transitorio) — reintento ${attempt + 1} en ${wait}ms: ${e}`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw new Error("No se pudo obtener el access token de Zoho.");
}

// ---------- Registro de estado (sync_status + sync_log) ----------
async function recordStatus(
  supabase: any,
  status: "OK" | "Error",
  recordsCount: number,
  errorMessage: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    // sync_status: fila singleton (id = 1) con el ÚLTIMO resultado.
    await supabase.from("sync_status").upsert(
      {
        id: 1,
        last_synced_at: now,
        last_status: status,
        last_records_count: recordsCount,
        last_error_message: errorMessage,
      },
      { onConflict: "id" },
    );
    // sync_log: una fila por corrida (historial).
    await supabase.from("sync_log").insert({
      ran_at: now,
      status,
      records_count: recordsCount,
      error_message: errorMessage,
    });
  } catch (e) {
    // No queremos que un fallo al registrar el estado tumbe la respuesta.
    console.log("No se pudo registrar el estado del sync:", e);
  }
}

// ---------- Auto-crear/actualizar proyectos desde Zoho (FR-07) ----------
// Solo toca los campos que vienen de Zoho (project_name, client). Los datos de
// contrato (number, expiration, approver, etc.) son manuales y NO se pisan.
async function upsertProjects(supabase: any, projects: any[]): Promise<number> {
  let synced = 0;
  for (const p of projects) {
    const zid = String(p.id_string || p.id || "");
    if (!zid) continue;
    const projectName = p.name || "";
    // FR-02 · si Zoho no expone cliente para este proyecto (no está configurado
    // ahí tampoco), se deja vacío en vez de adivinar con el nombre del proyecto:
    // un cliente puede tener varios proyectos con nombres distintos, así que
    // "inventar" el cliente a partir del nombre de UN proyecto rompe el
    // agrupamiento real (dos proyectos del mismo cliente terminan con
    // "clientes" distintos).
    const clientName =
      safe(p, "client_name", "") ||
      safe(p, "client.name", "") ||
      safe(p, "client_company_name", "") ||
      "";
    // Status de Zoho: puede venir como objeto {name} o como string plano.
    const zohoStatus =
      safe(p, "status.name", "") ||
      (typeof p.status === "string" ? p.status : "") ||
      safe(p, "status_name", "");
    const endDate = zohoProjectEndDate(p);

    try {
      const { data: existing } = await supabase
        .from("projects")
        .select("id, contract_expiration_date")
        .eq("zoho_project_id", zid)
        .maybeSingle();

      if (existing) {
        const patch: any = {
          project_name: projectName,
          client: clientName,
          zoho_status: zohoStatus,
        };
        // Solo seteamos la fecha desde Zoho si todavía NO hay una cargada a mano.
        if (!existing.contract_expiration_date && endDate) {
          patch.contract_expiration_date = endDate;
        }
        await supabase.from("projects").update(patch).eq("zoho_project_id", zid);
      } else {
        await supabase.from("projects").insert({
          zoho_project_id: zid,
          project_name: projectName,
          client: clientName,
          zoho_status: zohoStatus,
          contract_expiration_date: endDate, // fecha de fin de Zoho (inicial)
          // project_number arranca con el id de Zoho; editable a mano luego.
          project_number: String(p.key || zid),
          created_by: "zoho-sync",
        });
      }
      synced++;
    } catch (e) {
      console.log(`upsertProjects ${zid} error: ${e}`);
    }
  }
  return synced;
}

// ---------- Main ----------
Deno.serve(async (req) => {
  // Responder el preflight CORS de inmediato (sin correr el sync).
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Cliente creado al inicio para poder registrar el estado incluso ante error.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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

    // FR-07 · crear/actualizar el maestro de proyectos desde Zoho.
    const projectsSynced = await upsertProjects(supabase, projects);
    console.log("Proyectos sincronizados:", projectsSynced);

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

      // FR-02 · Cliente del proyecto. Zoho no siempre expone el cliente con la
      // misma clave, así que probamos varias — si no hay ninguna (no está
      // configurado en Zoho tampoco), se deja vacío en vez de adivinar con el
      // nombre del proyecto (ver misma nota en upsertProjects).
      const clientName =
        safe(p, "client_name", "") ||
        safe(p, "client.name", "") ||
        safe(p, "client_company_name", "") ||
        "";

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
              client: clientName,
              task: safe(tl, "task.name", ""),
              // FR-02 · ID numérico de la tarea en Zoho (string para no perder
              // precisión en ids largos).
              task_number: String(
                safe(tl, "task.id_string", "") || safe(tl, "task.id", ""),
              ),
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
      await recordStatus(supabase, "OK", 0, null);
      return json({
        ok: true,
        synced: 0,
        projects: projectsSynced,
        note: "Sin time logs en el rango.",
      });
    }

    // upsert en lotes de 500 para no pasarse de tamaño
    let synced = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("time_entries")
        .upsert(batch, { onConflict: "zoho_log_id" });
      if (error) {
        console.log("Upsert error:", error.message);
        await recordStatus(supabase, "Error", synced, error.message);
        return json({ ok: false, error: error.message, synced }, 200);
      }
      synced += batch.length;
    }

    await recordStatus(supabase, "OK", synced, null);
    return json({ ok: true, synced, projects: projectsSynced });
  } catch (e) {
    // Fallo de Zoho (5xx tras reintentos, red, credenciales, etc.): NO se tocó
    // lo ya sincronizado. Registramos el error y devolvemos { ok:false } sin
    // crashear (HTTP 200 para que el cliente reciba el body con el detalle).
    const msg = String((e as Error)?.message ?? e);
    console.log("Sync error:", msg);
    await recordStatus(supabase, "Error", 0, msg);
    return json({ ok: false, error: msg }, 200);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
