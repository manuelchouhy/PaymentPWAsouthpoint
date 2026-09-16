// ============================================================
// Supabase Edge Function: sync-task-keys
// ============================================================
// Popula time_entries.task_key (el `key` corto de Zoho, ej. "PP1-T5"), SÓLO para display.
// DESACOPLADA del sync de horas (sync-time-logs): correrla —o que falle/tarde— NO afecta el
// sync crítico ni el botón "Refresh". El key corto NO viene en el payload de time-logs
// (verificado 2026-09-15: task.key llega vacío ahí), sólo en /tasks/; por eso se resuelve aparte.
//
// Idempotente + best-effort + CONVERGENTE: por corrida toma hasta MAX_PER_RUN tareas con horas
// que no tienen key y que no se intentaron hace poco (ver candidate filter con TTL). Resuelve el
// key (top-level de /tasks/ + GET por-tarea) y por tarea hace UPDATE INCREMENTAL. Marca
// task_key_checked_at (negative-cache) SÓLO cuando el resultado fue CONCLUYENTE — Zoho respondió
// 200 (la tarea existe, con o sin key) o 404 (borrada): un fallo TRANSITORIO (429/401/5xx/red) NO
// marca checked, para no envenenar el cache y perder un key que sí existe. Un timeout deja el
// progreso ya hecho (update por tarea). La lógica de la app sigue usando task_number (id largo).
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

// GET a Zoho devolviendo el STATUS (además del body), para distinguir 200/404 (concluyente) de
// 429/401/5xx/red (transitorio). status=0 = fallo de red. Reintenta 5xx (transitorio) hasta
// agotar; 4xx (incl. 404/429) NO se reintenta (no es transitorio a nivel HTTP). Plumbing
// compartido con las otras edge functions; se acepta la duplicación (cada una deploya self-contained).
async function zohoGetStatus(url: string, token: string): Promise<{ status: number; data: any | null }> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
      if (res.status >= 500) {
        if (attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
        return { status: res.status, data: null };
      }
      if (!res.ok) return { status: res.status, data: null }; // 4xx (incl. 404/429)
      const text = await res.text();
      if (!text || !text.trim()) return { status: res.status, data: null };
      try { return { status: res.status, data: JSON.parse(text) }; }
      catch { console.log(`Respuesta no-JSON en ${url}`); return { status: res.status, data: null }; }
    } catch (e) {
      if (attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
      return { status: 0, data: null }; // red agotada
    }
  }
  return { status: 0, data: null };
}

// Sólo el body (o null): para el fetch del portal, al que no le importa el status.
const zohoGet = async (url: string, token: string): Promise<any | null> => (await zohoGetStatus(url, token)).data;

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
    const { data } = await zohoGetStatus(`${baseUrl}${sep}index=${index}&range=${RANGE}`, token);
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

// Access token de Zoho (refresh_token flow). Reintenta transitorios: 429 (rate-limit) y 5xx del
// endpoint de token, además de errores de red. Sólo es FATAL (no reintenta) si la respuesta llegó
// bien pero sin access_token (credenciales inválidas).
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
      // 429 (rate-limit) y 5xx = transitorios → reintentar con backoff (throw sin __fatal__).
      if (res.status === 429 || res.status >= 500) throw new Error(`Zoho token HTTP ${res.status}`);
      const data = await res.json();
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
// Barato para el caso común. Devuelve null si la lista no se pudo traer (para no confundir
// "proyecto sin keys" con "no se pudo pedir"). Las subtasks/anidadas se resuelven con resolveTaskKey.
async function fetchTopLevelKeys(portalId: string, projectId: string, token: string): Promise<Map<string, string> | null> {
  const tasks = await fetchAllPagesV1(`${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/`, "tasks", token);
  if (!tasks) return null;
  const m = new Map<string, string>();
  for (const t of tasks) {
    const id = String(t.id_string || t.id || "");
    if (id && t.key) m.set(id, String(t.key));
  }
  return m;
}

// Resuelve el key corto de UNA tarea por id (GET de la tarea), en TRI-ESTADO:
//   - conclusive=true, key=X   → la tarea existe y tiene key.
//   - conclusive=true, key=null→ Zoho respondió 200 (existe, sin key) o 404 (borrada): NO tendrá key.
//   - conclusive=false         → fallo TRANSITORIO (429/401/5xx/red o forma inesperada): reintentar luego.
// El caller sólo marca checked_at (negative-cache) cuando conclusive=true.
async function resolveTaskKey(
  portalId: string, projectId: string, taskId: string, token: string,
): Promise<{ key: string | null; conclusive: boolean }> {
  const { status, data } = await zohoGetStatus(`${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/${taskId}/`, token);
  if (status === 200) {
    const t = data?.tasks?.[0] ?? data?.task ?? (data?.id_string || data?.key ? data : null);
    if (t) return { key: t.key ? String(t.key) : null, conclusive: true };
    return { key: null, conclusive: false }; // 200 con forma inesperada → no envenenar
  }
  if (status === 404) return { key: null, conclusive: true }; // tarea inexistente → nunca tendrá key
  return { key: null, conclusive: false }; // 429/401/5xx/red → transitorio
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

// Tope de tareas distintas a procesar por corrida (acota wall-clock; el resto en la próxima).
const MAX_PER_RUN = 300;
// Re-chequear una tarea marcada "sin key" cada tanto: por si el key aparece más tarde en Zoho
// (subtask recién keyada, lag). Acota el desperdicio (no re-pide en cada corrida) y a la vez no
// deja un negativo pegado para siempre.
const RECHECK_AFTER_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const token = await getAccessToken();
    const portals = await zohoGet(`${ZOHO_V3}/portals`, token);
    const portalId = portals?.[0]?.id;
    // null puede ser transitorio (429/5xx/red agotados en zohoGet) o config real: el mensaje lo
    // deja ambiguo a propósito para no afirmar "no existe" ante un blip. 503 = reintentable.
    if (!portalId) return json({ ok: false, error: "Portal no disponible (posible Zoho transitorio; reintentar)" }, 503);

    // Candidatas: horas con task_key NULL, con proyecto (sin él no se puede pedir a Zoho ni gastar
    // presupuesto), que NUNCA se intentaron o cuyo último intento ya venció (TTL). Keyset por id +
    // dedupe por (proyecto, tarea) — no por task_number solo: si el mismo id apareciera bajo dos
    // proyectos (dato raro), ambos pares se procesan y convergen. Corta al llegar a MAX_PER_RUN.
    const cutoffIso = new Date(Date.now() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const need = new Map<string, { taskId: string; pid: string }>();
    let lastId = 0;
    for (let guard = 0; guard < 1000 && need.size < MAX_PER_RUN; guard++) {
      const { data, error } = await supabase
        .from("time_entries")
        .select("id, zoho_project_id, task_number")
        .is("task_key", null)
        .not("zoho_project_id", "is", null)
        .neq("task_number", "")
        .or(`task_key_checked_at.is.null,task_key_checked_at.lt.${cutoffIso}`)
        .gt("id", lastId)
        .order("id")
        .limit(1000);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      for (const r of batch) {
        const taskId = r.task_number == null ? "" : String(r.task_number);
        const pid = r.zoho_project_id == null ? "" : String(r.zoho_project_id);
        const k = `${pid}|${taskId}`;
        if (taskId && pid && !need.has(k)) {
          need.set(k, { taskId, pid });
          if (need.size >= MAX_PER_RUN) break;
        }
      }
      if (batch.length === 0) break;
      lastId = batch[batch.length - 1].id;
    }
    if (need.size === 0) return json({ ok: true, needing: 0, attempted: 0, keysFound: 0, note: "nada que resolver" });

    // Top-level de cada proyecto pedido UNA vez (cache). null = no se pudo traer (transitorio) →
    // las tareas de ese proyecto van a resolveTaskKey igual, que decide conclusividad por tarea.
    const topLevelCache = new Map<string, Map<string, string> | null>();
    const topLevelFor = async (pid: string): Promise<Map<string, string> | null> => {
      if (!topLevelCache.has(pid)) {
        try { topLevelCache.set(pid, await fetchTopLevelKeys(portalId, pid, token)); }
        catch (e) { console.log(`  top-level de ${pid} no disponible: ${String((e as Error)?.message ?? e)}`); topLevelCache.set(pid, null); }
      }
      return topLevelCache.get(pid) ?? null;
    };

    const nowIso = new Date().toISOString();
    // Cortes por si Zoho está degradado: un presupuesto de tiempo (para no exceder el wall-clock
    // del edge function bajo 5xx con backoff) y un circuit-breaker de fallos seguidos (para no
    // martillar 300 requests contra un 429/5xx sostenido resolviendo nada). Lo que quede se
    // resuelve en la próxima corrida (nada se marcó checked → no se pierde).
    const startedAt = Date.now();
    const MAX_RUN_MS = 100_000;
    const MAX_CONSEC_FAIL = 8;
    let consecFail = 0;
    let attempted = 0; // tareas con resultado CONCLUYENTE (se marcó checked_at)
    let keysFound = 0; // de ésas, cuántas tenían key
    for (const { taskId, pid } of need.values()) {
      if (Date.now() - startedAt > MAX_RUN_MS) {
        console.log("presupuesto de tiempo agotado; el resto en la próxima corrida");
        break;
      }
      let key: string | null = (await topLevelFor(pid))?.get(taskId) ?? null;
      let conclusive = key != null; // si el top-level lo trajo, es concluyente
      if (!conclusive) {
        try {
          const r = await resolveTaskKey(portalId, pid, taskId, token);
          key = r.key;
          conclusive = r.conclusive;
        } catch (e) {
          console.log(`  key de ${taskId} no resuelto: ${String((e as Error)?.message ?? e)}`);
        }
      }
      // Sólo se toca la DB si el resultado fue CONCLUYENTE: se marca checked_at (para no re-pedir)
      // y task_key si hay key. Un fallo transitorio NO marca nada → se reintenta en la próxima
      // corrida. Filtro por (task_number, proyecto) y task_key IS NULL (no pisa un valor bueno).
      if (!conclusive) {
        // Muchos inconcluyentes seguidos = Zoho degradado (429/5xx): cortar y reintentar luego,
        // en vez de disparar los 300 requests igual.
        if (++consecFail >= MAX_CONSEC_FAIL) {
          console.log(`${MAX_CONSEC_FAIL} fallos seguidos resolviendo keys (¿Zoho 429/5xx?); se corta y reintenta en la próxima corrida`);
          break;
        }
        continue;
      }
      consecFail = 0;
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
    // 500 (no 200) para que un scheduler/cron pueda detectar el fallo por status. No afecta horas.
    return json({ ok: false, error: msg }, 500);
  }
});
