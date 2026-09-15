// DRAFT — sync-stage-task-membership (slice 02 de stages-from-zoho). NO deployada aún;
// requiere aprobación humana + verificar el shape de subtasks de Zoho (ver fetchSubtasks).
//
// Puebla stage_task_membership (migración 0049): por cada Stage (project_stages con
// zoho_task_id = una Task top-level "Stage N" de Zoho), trae sus SUBTASKS y guarda la
// membresía subtask→stage. El front la lee para armar taskToStage (zoho_task_id → stage_id)
// y repartir el consumo por stage (src/lib/stageHourAttribution.js).
//
// Reusa el patrón de sync-project-stages: auth/portal/reintentos y la GUARDA ANTI-WIPE
// (un fetch fallido NO borra membresías reales). Env: ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZOHO_ACCOUNTS = "https://accounts.zoho.com";
const ZOHO_V3 = "https://projectsapi.zoho.com/api/v3";
const ZOHO_V1 = "https://projectsapi.zoho.com/restapi";
const RANGE = 200;
const RETRY_DELAYS_MS = [500, 1500, 4000];

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
      if (res.status >= 500) throw new Error(`Zoho HTTP ${res.status}`);
      if (!res.ok) return null; // 4xx: degradar (no reintentar)
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

/**
 * SUBTASKS de una Task-Stage de Zoho, paginadas y normalizadas a { id, name }.
 *
 * ⚠️ VERIFICAR antes de deployar: el endpoint/shape exacto de subtasks de la API v1 de
 * Zoho Projects debe confirmarse con un probe (la probe original ya fue retirada). Este
 * draft asume el endpoint por-task `/tasks/{taskId}/subtasks/` con la lista bajo la clave
 * `subtasks`. Se acepta SÓLO esa clave a propósito: si el shape difiere (respuesta con otra
 * clave, o el endpoint equivocado que devuelve las tasks TOP-LEVEL bajo `tasks`), NO se
 * ingieren esas filas como subtasks —eso corrompería la membresía de todos los stages—: se
 * devuelve null y el caller SALTEA (no toca datos).
 *
 * Devoluciones:
 *   - null  → fetch fallido O shape no reconocido (sin `subtasks` array) → el caller saltea
 *             la reconciliación (NO borra membresías reales). Igual criterio anti-wipe que
 *             sync-project-stages.
 *   - []    → 200 con `subtasks: []` (el stage realmente no tiene subtasks). El caller NO
 *             borra ante lista vacía (guarda false-empty, ver reconcileStageMembership).
 *   - filas → subtasks deduplicadas por id (una página repetida no rompe el upsert).
 */
async function fetchSubtasks(
  portalId: string,
  projectId: string,
  stageTaskId: string,
  token: string,
): Promise<{ id: string; name: string }[] | null> {
  const byId = new Map<string, { id: string; name: string }>();
  const MAX_PAGES = 100;
  let index = 1;
  let prevFirstId = "";
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`demasiadas páginas de subtasks (task ${stageTaskId})`);
    const url = `${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/${stageTaskId}/subtasks/?index=${index}&range=${RANGE}`;
    const data = await zohoGet(url, token);
    if (data == null) return null; // fetch fallido → el caller saltea (no borra)
    // SÓLO la clave `subtasks`: un 200 sin ese array = shape no reconocido → null (no se
    // asumen las top-level `tasks` como subtasks, que ensuciaría la membresía).
    if (!Array.isArray(data.subtasks)) return null;
    const items: any[] = data.subtasks;
    const firstId = items.length ? String(items[0].id_string || items[0].id || "") : "";
    if (items.length > 0 && firstId === prevFirstId) break; // Zoho ignora paginación → cortar
    prevFirstId = firstId;
    for (const t of items) {
      const id = String(t.id_string || t.id || "");
      if (!id) continue;
      byId.set(id, { id, name: String(t.name ?? "") }); // dedup por id (páginas solapadas)
    }
    if (items.length < RANGE) break;
    index += RANGE;
  }
  return [...byId.values()];
}

// Reconcilia la membresía de UN stage contra sus subtasks actuales de Zoho.
async function reconcileStageMembership(
  supabase: any,
  projectId: number | string,
  stageId: number | string,
  subtasks: { id: string; name: string }[],
) {
  // GUARDA FALSE-EMPTY (igual que sync-project-stages): una lista vacía NO borra nada. Un
  // "cero subtasks" es ambiguo (stage sin subtasks real, o un shape raro que igual pasó el
  // filtro) y borrar la membresía tiraría la atribución de horas del stage. Se prefiere
  // dejarla stale; un stage que realmente se vació se limpia a mano. (El fetch fallido ni
  // llega acá: devolvió null y el caller salteó.)
  if (subtasks.length === 0) return { upserted: 0, deleted: 0 };

  const { data: existing, error } = await supabase
    .from("stage_task_membership")
    .select("zoho_task_id, task_name")
    .eq("project_id", projectId)
    .eq("stage_id", stageId);
  if (error) throw new Error(error.message);

  const existingByTask = new Map<string, { task_name: string | null }>();
  for (const row of existing ?? []) existingByTask.set(String(row.zoho_task_id), { task_name: row.task_name ?? null });

  // Sólo se upsertea lo NUEVO o lo que cambió de nombre: así no se reescribe (ni se pisa
  // updated_at de) membresía sin cambios en cada corrida.
  const changed = subtasks.filter((s) => {
    const prev = existingByTask.get(s.id);
    return !prev || (prev.task_name ?? "") !== (s.name ?? "");
  });
  let upserted = 0;
  if (changed.length > 0) {
    const rows = changed.map((s) => ({
      project_id: projectId,
      stage_id: stageId,
      zoho_task_id: s.id,
      task_name: s.name,
      updated_at: new Date().toISOString(),
    }));
    // onConflict por la PK (project_id, zoho_task_id): si un subtask cambió de stage, se
    // reasigna (pisa stage_id). Nota: sin dedup en `changed` porque fetchSubtasks ya dedupó.
    const { error: upErr } = await supabase
      .from("stage_task_membership")
      .upsert(rows, { onConflict: "project_id,zoho_task_id" });
    if (upErr) throw new Error(upErr.message);
    upserted = rows.length;
  }

  // Baja: membresías de ESTE stage cuyo subtask ya no viene de Zoho, en UN solo delete.
  const currentIds = new Set(subtasks.map((s) => s.id));
  const orphanIds = (existing ?? [])
    .map((r: any) => String(r.zoho_task_id))
    .filter((id: string) => !currentIds.has(id));
  let deleted = 0;
  if (orphanIds.length > 0) {
    const { error: delErr } = await supabase
      .from("stage_task_membership")
      .delete()
      .eq("project_id", projectId)
      .eq("stage_id", stageId)
      .in("zoho_task_id", orphanIds);
    if (delErr) throw new Error(delErr.message);
    deleted = orphanIds.length;
  }

  return { upserted, deleted };
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

    // Stages con zoho_task_id (los sincronizados desde Zoho) + el zoho_project_id de su
    // proyecto para armar la URL de subtasks. Los stages manuales (sin zoho_task_id) no
    // tienen subtasks en Zoho → se saltean.
    const { data: stages, error: stErr } = await supabase
      .from("project_stages")
      .select("id, project_id, zoho_task_id, projects!inner(zoho_project_id)")
      .not("zoho_task_id", "is", null);
    if (stErr) throw new Error(stErr.message);

    let upserted = 0, deleted = 0, processed = 0;
    const errors: { stageId: number | string; error: string }[] = [];

    for (const s of stages ?? []) {
      const zohoProjectId = s.projects?.zoho_project_id;
      if (!zohoProjectId) continue;
      try {
        const subtasks = await fetchSubtasks(portalId, String(zohoProjectId), String(s.zoho_task_id), token);
        // null = fetch fallido → SALTEAR (no reconciliar): no se borran membresías reales.
        if (subtasks == null) throw new Error(`fetch de subtasks falló (stage ${s.id}) — se saltea`);
        const r = await reconcileStageMembership(supabase, s.project_id, s.id, subtasks);
        upserted += r.upserted; deleted += r.deleted; processed++;
      } catch (e) {
        errors.push({ stageId: s.id, error: String(e) });
      }
      await sleep(150); // espaciado suave anti rate-limit
    }

    return json({ ok: true, processed, upserted, deleted, errors });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
