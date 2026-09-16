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
// la DB (cero llamadas a Zoho). Auth/portal reusados de sync-time-logs. Requiere mig 0050.
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
const SUBTASK_TIME_BUDGET_MS = 90_000; // deja margen bajo el wall-clock del edge (~150s)
// FOLLOW-UP CONOCIDO (negative-cache): sin persistir "task_number ya chequeado sin key", un id
// que NUNCA resuelve (task borrada, o sin key) se re-pide CADA corrida (1 GET) y, por el orden
// de proyectos, puede consumir turno de otros. El budget (run+proyecto+tiempo) acota el daño por
// corrida; el fix real es una marca persistente con cooldown (requiere migración) → slice aparte,
// gated. Ver PRD task-key-display ("negative-cache").

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
): Promise<{ resolved: { id: string; key: string | null; name: string }[]; fetches: number }> {
  const out: { id: string; key: string | null; name: string }[] = [];
  let fetches = 0;
  for (const id of missingIds) {
    if (fetches >= budget || Date.now() >= deadline) break;
    if (!id) continue;
    if (fetches > 0) await sleep(SUBTASK_GET_SPACING_MS); // espaciar los GETs (anti-429)
    fetches++;
    const url = `${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/${id}/`;
    let data: any;
    try {
      data = await zohoGet(url, token);
    } catch {
      continue; // 429/5xx tras reintentos → reintentar en la próxima corrida (additivo)
    }
    if (data == null) continue; // 4xx/404 (task borrada) o body vacío → nada que resolver
    // El detalle de una task viene bajo `tasks` (array de 1) según la API; se toleran variantes.
    const task = Array.isArray(data.tasks) ? data.tasks[0] : (data.task ?? data);
    if (task) {
      out.push({ id: String(task.id_string || task.id || id), key: task.key ?? null, name: task.name ?? "" });
    }
  }
  return { resolved: out, fetches };
}

// task_number distintos de un proyecto que TODAVÍA no tienen key (task_key IS NULL). Un
// proyecto que devuelve [] no gatilla ningún fetch a Zoho (clave de eficiencia: el key es
// inmutable, lo ya resuelto no se vuelve a pedir).
async function missingTaskNumbers(supabase: any, zohoProjectId: string): Promise<string[]> {
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

    let processed = 0, resolved = 0, updatedRows = 0, skipped = 0, subtaskFetches = 0;
    const errors: { projectId: string; error: string }[] = [];
    let subtaskBudget = MAX_SUBTASK_FETCHES_PER_RUN; // run-level, compartido entre proyectos
    const subtaskDeadline = Date.now() + SUBTASK_TIME_BUDGET_MS; // corte por tiempo de la fase subtasks

    for (const p of projects) {
      const zpid = String(p.zoho_project_id);
      try {
        // 1) ¿Qué task_number de este proyecto siguen sin key? Si ninguno, no se pide a Zoho.
        const missing = await missingTaskNumbers(supabase, zpid);
        if (missing.length === 0) { skipped++; continue; }

        // 2) Traer las tasks TOP-LEVEL del proyecto y armar el mapa id→key.
        const tasks = await fetchTopLevelTasks(portalId, zpid, token);
        const keyMap = parseTaskKeyMap(tasks);

        // 2b) SUBTASKS (slice 02): los task_number que el top-level NO resolvió pueden ser
        // subtasks. Se piden por padre (top-level) con cota run-level y early-exit, y su mapa
        // se FUSIONA en keyMap. Si se agota el budget, lo que quede sin resolver cae al próximo
        // run (el key es inmutable → converge).
        const stillMissing = missing.filter((tn) => !keyMap[tn]);
        if (stillMissing.length > 0 && subtaskBudget > 0 && Date.now() < subtaskDeadline) {
          try {
            // Cap por proyecto además del run-level: un proyecto no drena todo el budget.
            const projectBudget = Math.min(subtaskBudget, MAX_SUBTASK_FETCHES_PER_PROJECT);
            const { resolved: subResolved, fetches } = await fetchTaskKeysById(
              portalId, zpid, stillMissing, token, projectBudget, subtaskDeadline,
            );
            subtaskBudget -= fetches;
            subtaskFetches += fetches;
            // Ids resueltos por-id (distintos de los top-level de keyMap) → merge directo.
            Object.assign(keyMap, parseTaskKeyMap(subResolved));
          } catch (e) {
            // La resolución por-id es best-effort: si algo falla, NO se pierde el pase top-level
            // (el UPDATE de abajo igual corre con las keys ya resueltas). Se registra para que un
            // fallo SISTEMÁTICO sea visible en la respuesta (no queda solo en el log).
            errors.push({ projectId: zpid, error: `subtasks: ${String(e)}` });
          }
        }

        // 3) UPDATE task_key para los task_number que faltaban y ya tienen key (top-level o subtask).
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
        processed++;
      } catch (e) {
        // Un proyecto que falla no tumba la corrida; nunca toca las horas. El key es
        // cosmético: lo no resuelto queda "—" y se reintenta en la próxima corrida.
        errors.push({ projectId: zpid, error: String(e) });
      }
      // Espaciado suave entre proyectos: evita el rate-limit (429) de Zoho.
      await sleep(150);
    }

    return json({ ok: true, processed, skipped, resolved, updatedRows, subtaskFetches, errors });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
