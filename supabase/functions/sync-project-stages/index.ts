// Sync de Stages desde Zoho (feature stages-from-zoho, slice 01).
// Por cada proyecto de la app con zoho_project_id, trae las Tasks TOP-LEVEL de Zoho,
// detecta las "Stage N" (zohoStageParser) y reconcilia project_stages: upsert por
// zoho_task_id + BAJA de los que ya no están en Zoho (incluye stages manuales sin
// zoho_task_id → limpieza, ver ADR-0003). NO toca budget ni active_stage_id (del Desk).
// Auth/portal reusados de sync-time-logs. Requiere migración 0048.
//
// Env: ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectStages } from "./zohoStageParser.js";

const ZOHO_ACCOUNTS = "https://accounts.zoho.com";
const ZOHO_V3 = "https://projectsapi.zoho.com/api/v3";
const ZOHO_V1 = "https://projectsapi.zoho.com/restapi";
const RANGE = 200; // page size de la Tasks API de Zoho (máx 200)
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
      if (res.status >= 500) throw new Error(`Zoho token HTTP ${res.status}`);
      const data = await res.json();
      if (!data.access_token) throw new Error("No access_token from Zoho. Revisá las credenciales.");
      return data.access_token;
    } catch (e) {
      // Reintentar cualquier fallo transitorio (5xx, red/DNS) salvo credenciales inválidas.
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
      if (!res.ok) return null; // 4xx: no reintentar, degradar
      // Body vacío o no-JSON (ej. proyecto sin tasks) → null en vez de tirar
      // "Unexpected end of JSON input" (res.json() explota con body vacío).
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

// Tasks TOP-LEVEL de un proyecto (paginado). Las subtareas NO vienen acá (flag
// subtasks:true) — eso es la membresía de la slice 02. Normaliza a { id, key, name }.
async function fetchTopLevelTasks(portalId: string, projectId: string, token: string) {
  const out: { id: string; key: string | null; name: string }[] = [];
  const MAX_PAGES = 100; // guarda anti-loop (20k tasks)
  let index = 1;
  for (let page = 0; ; page++) {
    // Tope de páginas: abortar (tirar) en vez de devolver una lista incompleta que
    // haría borrar stages reales en la reconciliación.
    if (page >= MAX_PAGES) throw new Error(`demasiadas páginas de tasks (proyecto ${projectId})`);
    const url = `${ZOHO_V1}/portal/${portalId}/projects/${projectId}/tasks/?index=${index}&range=${RANGE}`;
    const data = await zohoGet(url, token);
    // CRÍTICO (ADR-0003 sería destructivo si no): null = fetch FALLIDO/ambiguo (4xx/429,
    // token vencido, 5xx tras reintentos, body vacío). NO es "sin tasks" — se TIRA para que
    // el catch del proyecto SALTEE la reconciliación y NO borre stages reales por un error
    // transitorio de Zoho. Una lista vacía real (200 con tasks:[]) sí reconcilia.
    if (data == null) throw new Error(`fetch de tasks falló (proyecto ${projectId}, index ${index}) — se saltea`);
    const tasks: any[] = Array.isArray(data.tasks) ? data.tasks : [];
    for (const t of tasks) {
      out.push({
        id: String(t.id_string || t.id || ""),
        key: t.key ?? null,
        name: t.name ?? "",
      });
    }
    if (tasks.length < RANGE) break;
    index += RANGE;
  }
  return out;
}

// Reconcilia los project_stages de un proyecto contra los Stages detectados de Zoho.
async function reconcileProjectStages(
  supabase: any,
  projectId: number | string,
  detected: { zohoTaskId: string; zohoTaskKey: string | null; name: string }[],
) {
  const { data: existing, error } = await supabase
    .from("project_stages")
    .select("id, zoho_task_id, stage_name, zoho_task_key, position")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  const byZoho = new Map<string, any>();
  for (const row of existing ?? []) if (row.zoho_task_id != null) byZoho.set(String(row.zoho_task_id), row);
  const detectedIds = new Set(detected.map((s) => s.zohoTaskId));

  let created = 0, updated = 0, deleted = 0;

  // Alta / update por zoho_task_id.
  for (let i = 0; i < detected.length; i++) {
    const s = detected[i];
    const row = byZoho.get(s.zohoTaskId);
    if (!row) {
      const { error: insErr } = await supabase.from("project_stages").insert({
        project_id: projectId,
        zoho_task_id: s.zohoTaskId,
        zoho_task_key: s.zohoTaskKey,
        stage_name: s.name,
        sow_number: null, // los stages de Zoho no tienen SOW (0048 relajó la columna)
        position: i,
        created_by: "zoho-sync",
      });
      if (insErr) throw new Error(insErr.message);
      created++;
    } else if (row.stage_name !== s.name || row.zoho_task_key !== s.zohoTaskKey) {
      // position NO se actualiza (solo se setea al insertar): el orden de Zoho puede no
      // ser estable entre corridas y reescribirlo cada vez generaría churn de updates.
      const { error: updErr } = await supabase
        .from("project_stages")
        .update({ stage_name: s.name, zoho_task_key: s.zohoTaskKey })
        .eq("id", row.id);
      if (updErr) throw new Error(updErr.message);
      updated++;
    }
  }

  // Baja: stages que ya no vienen de Zoho (incluye manuales con zoho_task_id null).
  // El budget se pierde (ADR-0003); active_stage_id/project_tasks.stage_id son SET NULL.
  for (const row of existing ?? []) {
    if (row.zoho_task_id != null && detectedIds.has(String(row.zoho_task_id))) continue;
    const { error: delErr } = await supabase.from("project_stages").delete().eq("id", row.id);
    if (delErr) throw new Error(delErr.message);
    deleted++;
  }

  return { created, updated, deleted };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const token = await getAccessToken();
    const portals = await zohoGet(`${ZOHO_V3}/portals`, token);
    if (!portals || !portals[0]) return json({ ok: false, error: "No portal found" }, 500);
    const portalId = String(portals[0].id);

    // Solo proyectos linkeados a Zoho: un proyecto sin zoho_project_id (manual/interno)
    // NO se toca — sus stages manuales quedan intactos.
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id, zoho_project_id")
      .not("zoho_project_id", "is", null);
    if (projErr) throw new Error(projErr.message);

    let created = 0, updated = 0, deleted = 0, processed = 0;
    const errors: { projectId: number | string; error: string }[] = [];

    for (const p of projects ?? []) {
      try {
        const tasks = await fetchTopLevelTasks(portalId, String(p.zoho_project_id), token);
        const detected = detectStages(tasks);
        const r = await reconcileProjectStages(supabase, p.id, detected);
        created += r.created; updated += r.updated; deleted += r.deleted; processed++;
      } catch (e) {
        // Un proyecto que falla no tumba la corrida entera (mismo criterio que el sync de
        // logs). CLAVE: un fetch fallido tira acá y SALTEA la reconciliación → NO se borran
        // stages reales por un error transitorio de Zoho.
        errors.push({ projectId: p.id, error: String(e) });
      }
      // Espaciado suave entre proyectos: evita gatillar el rate-limit (429) de Zoho, que
      // por el punto anterior sería un error (skip), no una pérdida de datos, pero mejor no
      // tentarlo.
      await sleep(150);
    }

    return json({ ok: true, processed, created, updated, deleted, errors });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
