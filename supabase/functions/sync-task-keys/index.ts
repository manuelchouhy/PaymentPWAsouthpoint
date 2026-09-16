// Sync del código corto de las tasks desde Zoho (feature task-key-display, slice 01).
// DESACOPLADA del sync de horas: puebla time_entries.task_key (key legible "PP1-T1")
// para que el front lo muestre en vez del id largo. Corre en la misma cadencia que el
// sync de horas pero como INVOCACIÓN SEPARADA — si falla o tarda, NO afecta el sync de
// horas ni el botón "Refresh now" (ese aislamiento es el motivo de tenerla aparte).
//
// Resuelve tasks TOP-LEVEL (slice 01) y SUBTASKS (slice 02, por padre con cota run-level).
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
// Cota RUN-LEVEL de fetches de subtasks por corrida (slice 02): acota el fan-out de GETs
// por-padre para que una corrida no se eternice. La convergencia se completa en corridas
// sucesivas (el key es inmutable → lo resuelto no se vuelve a pedir).
const MAX_SUBTASK_FETCHES_PER_RUN = 250;

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

// SUBTASKS (slice 02): las subtasks de Zoho NO vienen en el listado top-level; se piden por
// PADRE vía `/tasks/{parentId}/subtasks/` (shape confirmado: lista bajo `tasks`, item con
// id_string/key/name; 204 = sin subtasks). Recorre los padres (top-level) resolviendo hasta
// encontrar todas las `wanted` (los task_number que siguen sin key) o agotar `budget` (cota de
// fetches por corrida, run-level). Es ADITIVO: un fetch fallido/204 (zohoGet → null) solo
// significa "nada que agregar de este padre" y no aborta nada (a diferencia de la membresía,
// que es destructiva). Devuelve las subtasks normalizadas {id,key,name} y cuántos fetches usó.
async function fetchSubtaskKeys(
  portalId: string,
  projectId: string,
  parentIds: string[],
  wanted: Set<string>,
  token: string,
  budget: number,
): Promise<{ subtasks: { id: string; key: string | null; name: string }[]; fetches: number }> {
  const out: { id: string; key: string | null; name: string }[] = [];
  const remaining = new Set(wanted);
  let fetches = 0;
  for (const parentId of parentIds) {
    if (fetches >= budget || remaining.size === 0) break; // cota por corrida / early-exit
    fetches++;
    let index = 1;
    let prevFirstId: string | null = null;
    for (let page = 0; page < 100; page++) {
      const url = `${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/${parentId}/subtasks/?index=${index}&range=${RANGE}`;
      const data = await zohoGet(url, token);
      // null = 204 (sin subtasks), body vacío, o 4xx/fallo → nada que agregar de este padre.
      if (data == null) break;
      const items: any[] = Array.isArray(data.tasks) ? data.tasks : [];
      const firstId = items.length ? String(items[0].id_string || items[0].id || "") : "";
      if (items.length > 0 && firstId === prevFirstId) break; // Zoho ignora paginación → cortar
      prevFirstId = firstId;
      for (const t of items) {
        const id = String(t.id_string || t.id || "");
        out.push({ id, key: t.key ?? null, name: t.name ?? "" });
        remaining.delete(id);
      }
      if (items.length < RANGE) break;
      index += RANGE;
    }
  }
  return { subtasks: out, fetches };
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
        const stillMissing = new Set(missing.filter((tn) => !keyMap[tn]));
        if (stillMissing.size > 0 && subtaskBudget > 0) {
          const parentIds = tasks.map((t) => t.id).filter(Boolean);
          const { subtasks, fetches } = await fetchSubtaskKeys(
            portalId, zpid, parentIds, stillMissing, token, subtaskBudget,
          );
          subtaskBudget -= fetches;
          subtaskFetches += fetches;
          const subMap = parseTaskKeyMap(subtasks);
          for (const [id, key] of Object.entries(subMap)) {
            if (keyMap[id] == null) keyMap[id] = key; // el top-level tiene prioridad
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
