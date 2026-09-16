// ============================================================
// Supabase Edge Function: sync-task-keys
// ============================================================
// Popula time_entries.task_key (el `key` corto de Zoho, ej. "PP1-T5"), SÓLO para display.
// DESACOPLADA del sync de horas (sync-time-logs): correrla —o que falle/tarde— NO afecta el
// sync crítico ni el botón "Refresh". El key corto NO viene en el payload de time-logs
// (verificado 2026-09-15: task.key llega vacío ahí), sólo en /tasks/; por eso se resuelve aparte.
//
// Idempotente + best-effort + CONVERGENTE: por corrida toma hasta MAX_PER_RUN tareas con horas
// que NO tienen key y NUNCA se intentaron (task_key IS NULL AND task_key_checked_at IS NULL),
// resuelve su key (top-level de /tasks/ + GET por-tarea para subtasks/anidadas) y, por tarea,
// hace UPDATE INCREMENTAL: setea task_key (si lo encontró) y SIEMPRE task_key_checked_at=now.
// Marcar checked aunque no haya key = negative-cache: una tarea borrada/sin-key no se re-pide
// en cada corrida (converge a 0 trabajo), y como el UPDATE es por tarea, un timeout deja el
// progreso ya hecho. La lógica de la app sigue usando task_number (el id largo).
//
// Variables de entorno (mismas que sync-time-logs): ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (inyectadas por Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZOHO_ACCOUNTS = "https://accounts.zoho.com";
const ZOHO_V3 = "https://projectsapi.zoho.com/api/v3";
const ZOHO_V1 = "https://projectsapi.zoho.com/restapi";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RETRY_DELAYS_MS = [2000, 4000, 8000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET a Zoho con reintentos ante transitorios (5xx/red/JSON). 4xx → null (no reintenta).
// (Plumbing compartido con sync-time-logs/sync-project-stages; se acepta la duplicación entre
// edge functions —cada una deploya self-contained—, ver nota de arquitectura al final.)
async function zohoGet(url: string, token: string): Promise<any | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
      if (res.status >= 500) {
        if (attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
        throw new Error(`HTTP ${res.status} on ${url}`);
      }
      if (!res.ok) { console.log(`HTTP ${res.status} on ${url}`); return null; }
      const text = await res.text();
      if (!text || !text.trim()) return null;
      try { return JSON.parse(text); } catch { console.log(`Respuesta no-JSON en ${url}`); return null; }
    } catch (e) {
      if (attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
      throw e;
    }
  }
  return null;
}

// Paginador V1 (index/range). null en la 1ª página = no usable; si no, lo acumulado.
async function fetchAllPagesV1(baseUrl: string, dataKeys: string | string[], token: string): Promise<any[] | null> {
  const RANGE = 200;
  const keys = Array.isArray(dataKeys) ? dataKeys : [dataKeys];
  const extract = (data: any): any[] | undefined =>
    Array.isArray(data) ? data : keys.map((k) => data?.[k]).find((v) => Array.isArray(v));
  const results: any[] = [];
  let index = 1;
  let prevFirstId: string | null = null;
  for (let page = 0; page < 50; page++) {
    const sep = baseUrl.indexOf("?") === -1 ? "?" : "&";
    const data = await zohoGet(`${baseUrl}${sep}index=${index}&range=${RANGE}`, token);
    if (!data) return page === 0 ? null : results;
    const items = extract(data);
    if (items === undefined) return page === 0 ? null : results;
    const first = items.length ? items[0] : null;
    const firstId = first ? String(first.id_string || first.id || JSON.stringify(first)) : "";
    if (firstId && firstId === prevFirstId) {
      console.log(`  ⚠ ${baseUrl}: el endpoint no pagina (index/range ignorado); posible truncado a ${results.length}`);
      break;
    }
    prevFirstId = firstId;
    results.push(...items);
    if (items.length < RANGE) break;
    index += RANGE;
  }
  return results;
}

// Access token de Zoho (refresh_token flow). Reintenta ante CUALQUIER fallo transitorio
// mientras queden intentos (5xx o error de red/JSON), consistente con zohoGet.
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: Deno.env.get("ZOHO_REFRESH_TOKEN")!,
    client_id: Deno.env.get("ZOHO_CLIENT_ID")!,
    client_secret: Deno.env.get("ZOHO_CLIENT_SECRET")!,
    grant_type: "refresh_token",
  });
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (res.status >= 500) throw new Error(`Zoho token HTTP ${res.status}`);
      const data = await res.json();
      // Sin access_token = credenciales inválidas: NO es transitorio → no reintentar.
      if (!data.access_token) throw new Error("__fatal__ No access_token from Zoho. Revisá las credenciales.");
      return data.access_token;
    } catch (e) {
      const fatal = String((e as Error)?.message ?? e).includes("__fatal__");
      if (!fatal && attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
      throw e;
    }
  }
  throw new Error("No se pudo obtener el access token de Zoho.");
}

// Tareas TOP-LEVEL de un proyecto (id_string largo → key corto), de una sola lista de /tasks/.
// Barato para el caso común; las subtasks/anidadas se resuelven con resolveTaskKey.
async function fetchTopLevelKeys(portalId: string, projectId: string, token: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const tasks = await fetchAllPagesV1(`${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/`, "tasks", token);
  for (const t of tasks ?? []) {
    const id = String(t.id_string || t.id || "");
    if (id && t.key) m.set(id, String(t.key));
  }
  return m;
}

// Key corto de UNA tarea por id (GET de la tarea). Cubre subtasks/anidadas sin adivinar
// jerarquía. Zoho envuelve la tarea en `tasks[0]` (a veces `task`). null si no hay key.
async function resolveTaskKey(portalId: string, projectId: string, taskId: string, token: string): Promise<string | null> {
  const data = await zohoGet(`${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/${taskId}/`, token);
  const t = data?.tasks?.[0] ?? data?.task ?? (data?.id_string || data?.key ? data : null);
  return t?.key ? String(t.key) : null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

// Tope de tareas distintas a procesar por corrida (acota wall-clock; el resto en la próxima).
const MAX_PER_RUN = 300;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const token = await getAccessToken();
    const portals = await zohoGet(`${ZOHO_V3}/portals`, token);
    const portalId = portals?.[0]?.id;
    if (!portalId) return json({ ok: false, error: "No portal found" }, 200);

    // Tareas con horas SIN key y NUNCA intentadas (checked_at NULL) y con proyecto (sin él no se
    // puede pedir a Zoho, y contarlas gastaría presupuesto). Keyset por id + dedupe en memoria,
    // cortando al llegar a MAX_PER_RUN. need: task_number(largo) → zoho_project_id.
    const need = new Map<string, string>();
    let lastId = 0;
    for (let guard = 0; guard < 1000 && need.size < MAX_PER_RUN; guard++) {
      const { data, error } = await supabase
        .from("time_entries")
        .select("id, zoho_project_id, task_number")
        .is("task_key", null)
        .is("task_key_checked_at", null)
        .not("zoho_project_id", "is", null)
        .neq("task_number", "")
        .gt("id", lastId)
        .order("id")
        .limit(1000);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      for (const r of batch) {
        const tn = r.task_number == null ? "" : String(r.task_number);
        const pid = r.zoho_project_id == null ? "" : String(r.zoho_project_id);
        if (tn && pid && !need.has(tn)) {
          need.set(tn, pid);
          if (need.size >= MAX_PER_RUN) break;
        }
      }
      if (batch.length === 0) break;
      lastId = batch[batch.length - 1].id;
    }
    if (need.size === 0) return json({ ok: true, needing: 0, attempted: 0, keysFound: 0, note: "nada que resolver" });

    // Se procesa tarea por tarea con UPDATE INCREMENTAL (task_key si hay + checked_at siempre),
    // así un timeout deja el progreso hecho. El top-level de cada proyecto se pide UNA vez (cache).
    const topLevelCache = new Map<string, Map<string, string>>();
    const topLevelFor = async (pid: string): Promise<Map<string, string>> => {
      let m = topLevelCache.get(pid);
      if (!m) {
        try { m = await fetchTopLevelKeys(portalId, pid, token); }
        catch (e) { console.log(`  top-level de ${pid} no disponible: ${String((e as Error)?.message ?? e)}`); m = new Map(); }
        topLevelCache.set(pid, m);
      }
      return m;
    };

    const nowIso = new Date().toISOString();
    let attempted = 0;
    let keysFound = 0;
    for (const [taskId, pid] of need) {
      let key = (await topLevelFor(pid)).get(taskId) ?? null;
      if (!key) {
        try { key = await resolveTaskKey(portalId, pid, taskId, token); }
        catch (e) { console.log(`  key de ${taskId} no resuelto: ${String((e as Error)?.message ?? e)}`); }
      }
      // UPDATE por (task_number, proyecto) sobre filas aún NULL: setea checked_at SIEMPRE (para
      // no re-intentar) y task_key sólo si se encontró. El filtro de proyecto hace explícito el
      // invariante (ids de tarea únicos por portal) y task_key IS NULL evita pisar un valor bueno.
      const patch: Record<string, unknown> = { task_key_checked_at: nowIso };
      if (key) patch.task_key = key;
      const { error } = await supabase
        .from("time_entries")
        .update(patch)
        .eq("task_number", taskId)
        .eq("zoho_project_id", pid)
        .is("task_key", null);
      if (error) {
        console.log(`  no se pudo actualizar ${taskId}: ${error.message}`);
      } else {
        attempted++;
        if (key) keysFound++;
      }
    }

    console.log(`sync-task-keys: needing=${need.size} attempted=${attempted} keysFound=${keysFound}`);
    return json({ ok: true, needing: need.size, attempted, keysFound });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.log("sync-task-keys error:", msg);
    return json({ ok: false, error: msg }, 200);
  }
});
