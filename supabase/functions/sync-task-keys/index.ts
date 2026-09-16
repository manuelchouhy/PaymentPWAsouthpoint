// Sync del código corto de las tasks desde Zoho (feature task-key-display, slice 01).
// DESACOPLADA del sync de horas: puebla time_entries.task_key (key legible "PP1-T1")
// para que el front lo muestre en vez del id largo. Corre en la misma cadencia que el
// sync de horas pero como INVOCACIÓN SEPARADA — si falla o tarda, NO afecta el sync de
// horas ni el botón "Refresh now" (ese aislamiento es el motivo de tenerla aparte).
//
// Resuelve tasks TOP-LEVEL por listado (slice 01) y SUBTASKS por id directo (slice 02).
//
// El `key` es INMUTABLE: solo se pide a Zoho para los task_number que todavía no tienen
// key. Tras la primera corrida, un proyecto ya resuelto cuesta solo una query liviana a
// la DB (cero llamadas a Zoho). Auth/portal reusados de sync-time-logs. Requiere migraciones
// 0050 (task_key) y 0051 (task_key_checked_at, negative-cache) aplicadas ANTES de deployar.
//
// Env: ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseTaskKeyMap } from "./parseTaskKeyMap.js";

const ZOHO_ACCOUNTS = "https://accounts.zoho.com";
const ZOHO_V3 = "https://projectsapi.zoho.com/api/v3";
const ZOHO_V1 = "https://projectsapi.zoho.com/restapi";
const RANGE = 200; // page size de la Tasks API de Zoho (máx 200)
const RETRY_DELAYS_MS = [500, 1500, 4000];
// Cotas de la resolución de subtasks por-id (slice 02). Cada task_number faltante se pide
// directo por id (GET /tasks/{id}/). La convergencia se completa en corridas sucesivas (lo
// resuelto sale de `missing`; el key es inmutable → no se vuelve a pedir).
//  - RUN: total de GETs por-id de toda la corrida (para que no se eternice).
//  - PROJECT: GETs por-id por proyecto, para que un proyecto con muchos ids irresolubles no
//    drene el budget y deje a los proyectos siguientes sin turno (starvation).
//  - TIME_BUDGET: tope de tiempo (wall-clock) para la fase de subtasks, así los reintentos con
//    backoff (429/5xx) no empujan la corrida más allá del límite del edge runtime.
const MAX_SUBTASK_FETCHES_PER_RUN = 250;
const MAX_SUBTASK_FETCHES_PER_PROJECT = 50;
const SUBTASK_GET_SPACING_MS = 120; // espaciado entre GETs por-id (anti rate-limit 429)
const SUBTASK_TIME_BUDGET_MS = 120_000; // deadline absoluto de la corrida; deja ~30s de margen
// bajo el wall-clock del edge (~150s). Es un tope de wall-clock, no un presupuesto exclusivo de
// la fase subtasks: si el pase top-level ya consumió el tiempo, se saltea subtasks (correcto:
// mejor no arrancar la fase por-id cerca del límite que morir a mitad de un UPDATE).
// NEGATIVE-CACHE (slice 04): un task_number chequeado sin key (task borrada, o key null en Zoho)
// se marca task_key_checked_at y no se re-pide hasta que vence este cooldown → corta el churn/
// starvation. 1 día (cron horario → 1 probe/día en vez de 24 = 24x menos churn) es un balance:
// corta el churn y a la vez recupera en ~1 día una key asignada TARDE en Zoho (caso común de un
// feature de display), sin dejar el id largo una semana entera.
const RECHECK_COOLDOWN_DAYS = 1;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
      if (res.status >= 500 || res.status === 429) throw new Error(`Zoho token HTTP ${res.status}`);
      const data = await res.json();
      if (!data.access_token) throw new Error("No access_token from Zoho. Revisá las credenciales.");
      return data.access_token;
    } catch (e) {
      const credential = String(e).includes("No access_token");
      if (!credential && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw new Error("No se pudo obtener el access token de Zoho.");
}

async function zohoGet(url: string, token: string): Promise<any | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
      // 5xx y 429 (throttle) son transitorios → reintentar con backoff (igual que
      // getAccessToken). El spacing de 150ms reduce el 429 pero no lo garantiza, así que un
      // 429 puntual hace backoff en vez de saltear el proyecto entero de una.
      if (res.status >= 500 || res.status === 429) throw new Error(`Zoho HTTP ${res.status}`);
      if (!res.ok) return null; // otros 4xx: no reintentar, degradar
      const text = await res.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch { return null; }
    } catch (e) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw e;
    }
  }
  return null;
}

// Variante de zohoGet que DISTINGUE por status (para el negative-cache por-id): reintenta
// 5xx/429 (transitorios) y, agotados, TIRA; para el resto devuelve { status, data } sin
// colapsar 404/401/403/200 a un mismo null. Así el caller solo negative-cachea un "sin key"
// DEFINITIVO (200 con task sin key, o 404), no un 401/403/blip transitorio. Espeja el patrón
// de sync-stage-task-membership.
async function zohoGetStatus(url: string, token: string): Promise<{ status: number; data: any | null }> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
      if (res.status >= 500 || res.status === 429) throw new Error(`Zoho HTTP ${res.status}`);
      const text = await res.text();
      let data: any = null;
      if (text) { try { data = JSON.parse(text); } catch { data = null; } }
      return { status: res.status, data };
    } catch (e) {
      if (attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
      throw e; // 5xx/429 agotados → transitorio (el caller lo cuenta como errored, NO cachea)
    }
  }
  return { status: 0, data: null };
}

// Tasks TOP-LEVEL de un proyecto (paginado). Normaliza a { id, key, name }. Subtasks NO
// vienen acá (son la slice 02). Espeja fetchTopLevelTasks de sync-project-stages.
async function fetchTopLevelTasks(portalId: string, projectId: string, token: string) {
  const out: { id: string; key: string | null; name: string }[] = [];
  const MAX_PAGES = 100; // guarda anti-loop (20k tasks)
  let index = 1;
  // Centinela null (no ""): si la 1ª página trae una task sin id_string/id, su firstId sería
  // "" y con prevFirstId="" el guard de no-progreso rompería y DESCARTARÍA esa página. Con
  // null la 1ª iteración nunca matchea; el anti-loop real lo cubre igual MAX_PAGES.
  let prevFirstId: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`demasiadas páginas de tasks (proyecto ${projectId})`);
    const url = `${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/?index=${index}&range=${RANGE}`;
    const data = await zohoGet(url, token);
    // null = fetch FALLIDO/ambiguo (4xx/429, token vencido, 5xx tras reintentos, body
    // vacío). Se TIRA para SALTEAR el proyecto sin pisar keys ya resueltas con datos parciales.
    if (data == null) throw new Error(`fetch de tasks falló (proyecto ${projectId}, index ${index})`);
    const tasks: any[] = Array.isArray(data.tasks) ? data.tasks : [];
    // No-progreso: si Zoho ignora index/range, cada página repite la primera task → cortar.
    const firstId = tasks.length ? String(tasks[0].id_string || tasks[0].id || "") : "";
    if (tasks.length > 0 && firstId === prevFirstId) break;
    prevFirstId = firstId;
    for (const t of tasks) {
      out.push({ id: String(t.id_string || t.id || ""), key: t.key ?? null, name: t.name ?? "" });
    }
    if (tasks.length < RANGE) break;
    index += RANGE;
  }
  return out;
}

// SUBTASKS (slice 02): las subtasks de Zoho NO vienen en el listado top-level. En vez de
// barrer los `/subtasks/` de cada padre (coverage incompleto si hay muchos padres, y 204s
// caros en padres sin hijos), se pide CADA task_number faltante DIRECTO por id vía
// `GET /tasks/{id}/` (shape confirmado por probe: devuelve la task —top-level, subtask o
// anidada— con su `key`). Ventajas: resuelve cualquier nivel de anidamiento, sin coverage
// gaps, sin gastar GETs en padres childless, y CONVERGE (lo resuelto sale de `missing`, así
// que la próxima corrida ataca los que faltan). Es ADITIVO: un 4xx/404 (task borrada) o un
// fallo transitorio (429/5xx que tira tras reintentos) solo saltea ESE id, nunca aborta.
// Espacia los GETs (anti-429). `budget` acota los GETs; `deadline` (epoch ms) corta por
// tiempo para no pasarse del wall-clock del edge. Devuelve las tasks {id,key,name} y GETs.
async function fetchTaskKeysById(
  portalId: string,
  projectId: string,
  missingIds: string[],
  token: string,
  budget: number,
  deadline: number,
): Promise<{ resolved: { id: string; key: string }[]; fetches: number; errored: number; noKey: string[] }> {
  const resolved: { id: string; key: string }[] = []; // 200 con task Y key
  // `noKey` = ids con "sin key" DEFINITIVO por-task: 404 (borrada), 200 con task pero key null, o
  // 200 sin task (tasks:[]/body vacío = la task no existe bajo ese proyecto, como un 404). Estos
  // se negative-cachean (con cooldown). NO incluye 5xx/429 (transitorios) ni 401/403/400 (auth/
  // permiso/malformado: pueden ser RUN-WIDE, no per-task → cachearlos suprimiría en masa tasks
  // válidas si el token falla a mitad de corrida). El cooldown recupera un 200-empty por eventual
  // consistency dentro de RECHECK_COOLDOWN_DAYS.
  const noKey: string[] = [];
  let fetches = 0;
  let errored = 0; // GETs que fallaron por transitorio (5xx/429 agotados) → outage visible al caller
  for (const id of missingIds) {
    if (fetches >= budget || Date.now() >= deadline) break;
    if (!id) continue;
    if (fetches > 0) await sleep(SUBTASK_GET_SPACING_MS); // espaciar los GETs (anti-429)
    fetches++;
    const url = `${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/${id}/`;
    let status: number, data: any;
    try {
      ({ status, data } = await zohoGetStatus(url, token));
    } catch {
      errored++;
      continue; // 429/5xx tras reintentos → transitorio: ni resuelve ni cachea (reintenta)
    }
    if (status === 404) { noKey.push(id); continue; } // task borrada en Zoho → definitivo sin key
    if (status < 200 || status >= 300) continue; // 401/403/400/etc: ambiguo run-wide → no cachear
    // 200: extraer la task. `tasks:[]`/body sin task = la task no existe bajo ese proyecto (como
    // un 404) → definitivo sin key (se cachea; el cooldown recupera un eventual-consistency raro).
    const task = Array.isArray(data?.tasks)
      ? (data.tasks.length ? data.tasks[0] : null)
      : (data?.task ?? data);
    if (!task) { noKey.push(id); continue; }
    const key = task.key != null && String(task.key) !== "" ? String(task.key) : null;
    // Se mapea por el id PEDIDO (`id`), no por el id_string devuelto: se pidió /tasks/{id}/.
    if (key) resolved.push({ id, key });
    else noKey.push(id); // 200 con task pero SIN key → definitivo sin key
  }
  return { resolved, fetches, errored, noKey };
}

// task_number distintos de un proyecto que TODAVÍA no tienen key (task_key IS NULL) Y que no
// fueron chequeados-sin-key recientemente (negative-cache: task_key_checked_at NULL o más viejo
// que `cutoffIso`). Un proyecto que devuelve [] no gatilla ningún fetch a Zoho.
async function missingTaskNumbers(supabase: any, zohoProjectId: string, cutoffIso: string): Promise<string[]> {
  const set = new Set<string>();
  // Paginado explícito: PostgREST corta en 1000 filas por defecto. Un proyecto con miles
  // de time_entries sin key podría dejar afuera task_numbers que solo aparecen pasadas las
  // 1000 filas → nunca se resolverían. Se recorre por páginas ordenadas hasta agotar.
  const PAGE = 1000;
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from("time_entries")
      .select("task_number")
      .eq("zoho_project_id", zohoProjectId)
      .is("task_key", null)
      // Negative-cache: excluir los ya chequeados-sin-key dentro del cooldown. Los NULL (nunca
      // chequeados) o vencidos vuelven a intentarse (recupera keys asignadas tarde en Zoho).
      // cutoffIso viene de Date.toISOString() → sin comas/paréntesis, seguro dentro de .or()
      // (verificado contra el REST). NO cambiar a un formato con comas o offset "+00:00".
      .or(`task_key_checked_at.is.null,task_key_checked_at.lt.${cutoffIso}`)
      .not("task_number", "is", null)
      .neq("task_number", "")
      // Ordenar por id (PK ÚNICA), no por task_number (no-único): el offset paging necesita
      // un orden TOTAL estable, si no una fila en el borde de página podría no caer en ninguna
      // ventana entre dos queries y saltearse. La dedup por task_number la hace el Set.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      const tn = String(row.task_number ?? "");
      if (tn) set.add(tn);
    }
    // Cortar SOLO en página vacía y avanzar por las filas REALES devueltas: robusto a que
    // el max-rows del server sea menor que PAGE (con `rows.length < PAGE` cortaría de más).
    if (rows.length === 0) break;
    from += rows.length;
  }
  return [...set];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const token = await getAccessToken();
    const portals = await zohoGet(`${ZOHO_V3}/portals`, token);
    if (!portals || !portals[0]) return json({ ok: false, error: "No portal found" }, 500);
    const portalId = String(portals[0].id);

    // Solo proyectos linkeados a Zoho (los manuales no tienen tasks de Zoho que resolver).
    // Paginado por la misma razón que missingTaskNumbers: PostgREST corta en 1000 filas por
    // defecto, así que sin paginar un tenant con +1000 proyectos dejaría la cola sin procesar.
    const projects: { id: any; zoho_project_id: any }[] = [];
    for (let from = 0; ; ) {
      const PAGE = 1000;
      const { data, error } = await supabase
        .from("projects")
        .select("id, zoho_project_id")
        .not("zoho_project_id", "is", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) projects.push(r);
      if (rows.length === 0) break;
      from += rows.length;
    }

    let processed = 0, resolved = 0, updatedRows = 0, skipped = 0, subtaskFetches = 0, markedNoKey = 0, subtaskErrored = 0;
    const errors: { projectId: string; error: string }[] = [];
    let subtaskBudget = MAX_SUBTASK_FETCHES_PER_RUN; // run-level, compartido entre proyectos
    const subtaskDeadline = Date.now() + SUBTASK_TIME_BUDGET_MS; // corte por tiempo de la fase subtasks
    // Cutoff del negative-cache: los task_number chequeados-sin-key después de este instante
    // se saltean; los más viejos (o nunca chequeados) se reintentan.
    const cutoffIso = new Date(Date.now() - RECHECK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    for (const p of projects) {
      const zpid = String(p.zoho_project_id);
      try {
        // 1) ¿Qué task_number de este proyecto siguen sin key y no fueron chequeados hace poco?
        const missing = await missingTaskNumbers(supabase, zpid, cutoffIso);
        if (missing.length === 0) { skipped++; continue; }

        // 2) Traer las tasks TOP-LEVEL del proyecto y armar el mapa id→key.
        const tasks = await fetchTopLevelTasks(portalId, zpid, token);
        const keyMap = parseTaskKeyMap(tasks);
        const topLevelIds = new Set(tasks.map((t) => t.id).filter(Boolean));

        // NEGATIVE-CACHE barato: un task_number que el listado top-level DEVOLVIÓ pero con key
        // null se marca directo, sin gastar un GET (y NO va a by-id). El listado es autoritativo
        // para la key (en el sync real 862 keys salieron del listado y solo 44 necesitaron by-id),
        // así que null en el listado = sin key. TRADEOFF: si Zoho asignara la key TARDE, el
        // cooldown (RECHECK_COOLDOWN_DAYS) re-lista y la recupera → falso-cache dura ≤ cooldown
        // (mientras tanto el front cae al id largo, no rompe).
        const toMark = new Set<string>(missing.filter((tn) => topLevelIds.has(tn) && !keyMap[tn]));

        // 2b) SUBTASKS (slice 02): los task_number que NO están en el listado top-level pueden ser
        // SUBTASKS (o tasks top-level que la paginación se perdió). Se piden DIRECTO por id
        // (GET /tasks/{id}/). Se fusionan en keyMap antes del UPDATE; los "sin key" definitivos
        // (`noKey`) se suman al negative-cache. Si se agota budget/tiempo, lo que quede cae al
        // próximo run (el key es inmutable → converge).
        const stillMissing = missing.filter((tn) => !keyMap[tn] && !topLevelIds.has(tn));
        if (stillMissing.length > 0 && subtaskBudget > 0 && Date.now() < subtaskDeadline) {
          try {
            // Cap por proyecto además del run-level: un proyecto no drena todo el budget.
            const projectBudget = Math.min(subtaskBudget, MAX_SUBTASK_FETCHES_PER_PROJECT);
            const { resolved: subResolved, fetches, errored, noKey } = await fetchTaskKeysById(
              portalId, zpid, stillMissing, token, projectBudget, subtaskDeadline,
            );
            subtaskBudget -= fetches;
            subtaskFetches += fetches;
            subtaskErrored += errored; // acumulado RUN-LEVEL para detectar outage (ver abajo)
            for (const r of subResolved) keyMap[r.id] = r.key; // ids de subtask (no colisionan)
            for (const id of noKey) toMark.add(id); // sin key DEFINITIVO por-id → negative-cache
          } catch (e) {
            // Best-effort: un error inesperado no pierde el pase top-level (el UPDATE igual corre).
            errors.push({ projectId: zpid, error: `subtasks: ${String(e)}` });
          }
        }

        // 3) UPDATE task_key para los task_number que faltaban y ya tienen key (top-level o subtask).
        // Va PRIMERO: es el feature real. El negative-cache (marcado) es una optimización y va
        // después, para que un fallo del marcado nunca aborte la escritura de las keys.
        for (const tn of missing) {
          const key = keyMap[tn];
          // Sin key ni top-level ni subtask (o budget de subtasks agotado este run): queda NULL
          // → en el front cae al id largo. Se reintenta en la próxima corrida.
          if (!key) continue;
          const { error: updErr, count } = await supabase
            .from("time_entries")
            .update({ task_key: key }, { count: "exact" })
            .eq("zoho_project_id", zpid)
            .eq("task_number", tn)
            .is("task_key", null);
          if (updErr) throw new Error(updErr.message);
          // Solo contar como resuelto si el UPDATE tocó filas (evita inflar la métrica si
          // otra corrida concurrente ya lo había llenado → count 0).
          if ((count ?? 0) > 0) {
            resolved++;
            updatedRows += count ?? 0;
          }
        }

        // 4) NEGATIVE-CACHE (best-effort, DESPUÉS del paso 3): marcar task_key_checked_at=now() en
        // los "sin key" definitivos (top-level null-key + by-id noKey) para no re-pedirlos hasta
        // que venza el cooldown. Solo toca filas aún sin key. Un fallo acá NO pierde las keys ya
        // escritas (solo se pierde la optimización → esos ids se reintentan la próxima corrida).
        // Chunked: `.in()` con muchos ids armaría una URL/consulta ilimitada.
        if (toMark.size > 0) {
          try {
            const nowIso = new Date().toISOString();
            const ids = [...toMark];
            const CHUNK = 200;
            for (let i = 0; i < ids.length; i += CHUNK) {
              const { error: markErr, count } = await supabase
                .from("time_entries")
                .update({ task_key_checked_at: nowIso }, { count: "exact" })
                .eq("zoho_project_id", zpid)
                .in("task_number", ids.slice(i, i + CHUNK))
                .is("task_key", null);
              if (markErr) throw new Error(markErr.message);
              markedNoKey += count ?? 0;
            }
          } catch (e) {
            errors.push({ projectId: zpid, error: `negative-cache: ${String(e)}` });
          }
        }
        processed++;
      } catch (e) {
        // Un proyecto que falla no tumba la corrida; nunca toca las horas. El key es
        // cosmético: lo no resuelto queda "—" y se reintenta en la próxima corrida.
        errors.push({ projectId: zpid, error: String(e) });
      }
      // Espaciado suave entre proyectos: evita el rate-limit (429) de Zoho.
      await sleep(150);
    }

    // Señal de outage RUN-LEVEL de la fase BY-ID (no per-proyecto, que sería ruidoso): si hubo
    // varios GETs por-id en toda la corrida y TODOS fallaron, es un outage real. Nota: un outage
    // que tumba también el pase TOP-LEVEL ya se ve por otro lado (cada proyecto tira en
    // fetchTopLevelTasks → una entrada por proyecto en `errors`); esta alarma cubre el caso
    // "top-level ok pero by-id todo falla". Con pocos GETs (o algunos ok) no se alarma.
    if (subtaskFetches >= 3 && subtaskErrored === subtaskFetches) {
      errors.push({ projectId: "(run)", error: `subtasks: los ${subtaskErrored} GET(s) por-id de la corrida fallaron (outage?)` });
    }

    return json({ ok: true, processed, skipped, resolved, updatedRows, subtaskFetches, markedNoKey, errors });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
