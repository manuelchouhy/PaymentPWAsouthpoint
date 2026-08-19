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

// Paginador de la API V1 (restapi): pagina por index (1-based) + range, NO por
// page_info como V3. Se itera hasta que una página vuelve con menos ítems que el
// range (esa es la última). dataKeys admite varias claves candidatas porque la
// forma de la respuesta varía por endpoint/portal (p. ej. groups vs projectgroups).
//
// Devuelve null (no []) cuando la PRIMERA página no trae una respuesta usable
// —4xx/vacío, o una forma inesperada donde ninguna clave candidata es un array—
// para que el caller distinga "no se pudo traer" de "vino vacío" y no pise datos
// ya guardados. Cap de páginas como backstop, y una guarda de no-progreso corta
// si el endpoint ignora index/range y devuelve siempre la misma página.
async function fetchAllPagesV1(
  baseUrl: string,
  dataKeys: string | string[],
  token: string,
): Promise<any[] | null> {
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
    if (items === undefined) return page === 0 ? null : results; // forma inesperada
    // Guarda de no-progreso: si el endpoint ignora index/range, la página vuelve
    // idéntica → se corta en vez de refetchear hasta el cap. Se compara por id y,
    // si el item no tiene id, por una huella del primer elemento (fallback robusto
    // para respuestas sin id).
    const first = items.length ? items[0] : null;
    // || (no ??) en la cadena: un id_string "" presente igual debe caer al id o a
    // la huella, o la guarda de no-progreso quedaría deshabilitada.
    const firstId = first ? String(first.id_string || first.id || JSON.stringify(first)) : "";
    if (firstId && firstId === prevFirstId) {
      // El endpoint devolvió la misma página que la anterior → ignora index/range.
      // Se corta para no refetchear hasta el cap, PERO puede haber >RANGE ítems que
      // no se pueden paginar: se avisa para que el truncado no sea silencioso.
      console.log(`  ⚠ ${baseUrl}: el endpoint no pagina (index/range ignorado); posible truncado a ${results.length} ítems`);
      break;
    }
    prevFirstId = firstId;
    results.push(...items);
    if (items.length < RANGE) break; // última página
    index += RANGE;
    // Si salimos por el cap de páginas con la última llena, hay más datos sin
    // traer: se avisa para que ese truncado tampoco sea silencioso.
    if (page === 49) {
      console.log(`  ⚠ ${baseUrl}: alcanzado el cap de 50 páginas (${results.length} ítems); puede haber más sin traer`);
    }
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

// Mapa projectId → nombre del Project Group de Zoho.
//
// En Zoho el cliente vive como Project Group, y el listado de proyectos NO trae
// el grupo (confirmado en la doc v1). Hay que pedir los grupos aparte y, por
// cada grupo, qué proyectos lo integran (filtrando el listado por json_string).
//
// IMPORTANTE (a verificar en la PRIMERA corrida real): la forma exacta de la
// respuesta de /projects/groups y del filtro por grupo depende del portal. Por
// eso esto es defensivo y MUY logueado: si algo no viene como se espera, un
// proyecto simplemente queda sin grupo (→ "Sin cliente" en la app), nunca tira
// la corrida. Los console.log de acá son los que nos dicen cómo ajustar.
async function fetchGroupByProjectId(
  portalId: string,
  token: string,
): Promise<{ map: Map<string, string>; groups: string[] } | null> {
  const map = new Map<string, string>();
  // Proyectos que aparecen en más de un grupo: ambiguos. Misma filosofía que las
  // guardas byKey/byName del resolver — no se adivina el cliente, se deja sin
  // grupo para que caiga a "sin cliente" y se resuelva a mano.
  const ambiguous = new Set<string>();
  // Nombres de TODOS los grupos reales de Zoho (tengan o no proyectos). Se usa para
  // auto-crear un cliente por grupo, incluso los que hoy no tienen proyectos.
  const allGroups = new Set<string>();
  try {
    // Tanto la lista de grupos como los proyectos por grupo se paginan con el
    // paginador V1 (index/range): así no se truncan silenciosamente ni los grupos
    // (portal con muchos clientes) ni los proyectos de un grupo grande.
    // Sin barra final: la doc de Zoho documenta el endpoint como
    // /restapi/portal/{id}/projects/groups (con barra da HTTP 400 en este portal).
    const groups = await fetchAllPagesV1(
      `${ZOHO_V1}/portal/${portalId}/projects/groups`,
      ["groups", "projectgroups"],
      token,
    );
    // null = no se pudo traer la lista de grupos (4xx / forma inesperada) → se
    // aborta la resolución de grupos devolviendo null. Que no borre los grupos ya
    // guardados NO depende de este null: la protección real es la guarda has(zid)
    // de upsertProjects, que tampoco toca la columna ante un map vacío (ver ahí).
    if (groups === null) {
      console.log("Project Groups: sin respuesta usable del endpoint (4xx/forma inesperada) — no se tocan los grupos guardados");
      return null;
    }
    console.log("Project groups encontrados:", groups.length);
    for (const g of groups) {
      const gid = String(g.id_string || g.id || "");
      const gname = g.name || g.group_name || "";
      if (!gid || !gname) continue;
      // Pseudo-grupo interno de Zoho ("ungrouped projects"): NO es un cliente, se
      // saltea (ni se mapea ni se auto-crea cliente).
      if (/ungroupproj/i.test(gname)) continue;
      allGroups.add(gname);
      // La doc de Zoho envuelve el filtro en `filter`: {"filter":{"group":[id]}}.
      // Sin ese wrapper el listado ignora el filtro o devuelve error.
      const filter = encodeURIComponent(JSON.stringify({ filter: { group: [gid] } }));
      // Un fallo al traer los proyectos de UN grupo no es catastrófico: ese grupo
      // queda sin proyectos mapeados (→ esos proyectos "sin cliente"), sin abortar.
      const projs = (await fetchAllPagesV1(
        `${ZOHO_V1}/portal/${portalId}/projects/?json_string=${filter}`,
        "projects",
        token,
      )) ?? [];
      console.log(`  grupo '${gname}' (${gid}): ${projs.length} proyectos`);
      for (const p of projs) {
        const pid = String(p.id_string || p.id || "");
        if (!pid || ambiguous.has(pid)) continue;
        const prev = map.get(pid);
        if (prev !== undefined && prev !== gname) {
          // El proyecto ya estaba en otro grupo: ambiguo. Se saca del map y se
          // marca para que un tercer grupo tampoco lo re-agregue.
          ambiguous.add(pid);
          map.delete(pid);
          console.log(`  ⚠ proyecto ${pid} en múltiples grupos ('${prev}' y '${gname}') → sin cliente por ambigüedad`);
        } else {
          map.set(pid, gname);
        }
      }
    }
  } catch (e) {
    // El grupo es "nice to have": si falla, los proyectos quedan sin cliente
    // resoluble, pero el sync de horas sigue. Se devuelve null (igual que un map
    // vacío) para señalar que no hay mapeo. upsertProjects sólo escribe el grupo
    // ante presencia positiva (has(zid)), así que ni null ni un map vacío borran
    // los grupos ya guardados.
    console.log("No se pudieron traer los Project Groups:", String((e as Error)?.message ?? e));
    return null;
  }
  return { map, groups: [...allGroups] };
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
// Solo toca campos que vienen de Zoho (project_name, zoho_status, grupo). Los
// datos manuales —contrato, y AHORA también `client`/`client_id`— NO se pisan.
// `groupByProjectId`: Map projectId→grupo, o null si la consulta de grupos falló
// (en ese caso no se toca zoho_project_group para no borrar lo ya guardado).
async function upsertProjects(
  supabase: any,
  projects: any[],
  groupByProjectId: Map<string, string> | null,
): Promise<number> {
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
    // Sólo se escribe zoho_project_group cuando el proyecto aparece POSITIVAMENTE
    // en el mapa (undefined = no tocar la columna). La AUSENCIA no significa "sin
    // grupo" y nunca borra: el listado por grupo de Zoho trae sólo activos, así que
    // un proyecto archivado —o uno ausente por un fallo parcial, o cuando la
    // respuesta de grupos vino vacía— no estaría en el mapa y escribir null borraría
    // el grupo que se guardó cuando el proyecto estaba activo (wipe en cada sync).
    // Contra: si un proyecto se saca de su grupo en Zoho, el grupo viejo queda
    // pegado hasta corregirlo a mano; es el mal menor frente al borrado masivo.
    const group = groupByProjectId?.has(zid) ? groupByProjectId.get(zid) : undefined;

    try {
      const { data: existing } = await supabase
        .from("projects")
        .select("id, contract_expiration_date")
        .eq("zoho_project_id", zid)
        .maybeSingle();

      if (existing) {
        // `client` YA NO se escribe en el update: Zoho no lo expone (llega
        // vacío) y escribirlo pisaba el cliente cargado a mano en cada corrida.
        // El cliente ahora se deriva del Project Group (ver clientResolver).
        const patch: any = {
          project_name: projectName,
          zoho_status: zohoStatus,
        };
        if (group !== undefined) patch.zoho_project_group = group;
        // Solo seteamos la fecha desde Zoho si todavía NO hay una cargada a mano.
        if (!existing.contract_expiration_date && endDate) {
          patch.contract_expiration_date = endDate;
        }
        await supabase.from("projects").update(patch).eq("zoho_project_id", zid);
      } else {
        await supabase.from("projects").insert({
          zoho_project_id: zid,
          project_name: projectName,
          // Fila nueva: no hay cliente manual que pisar. Se deja `client` vacío
          // (Zoho no lo trae) y el cliente se resuelve por grupo.
          client: clientName,
          zoho_status: zohoStatus,
          zoho_project_group: group ?? null,
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

// Normaliza igual que normalizeClientKey del front y que el índice único de la
// 0030 (minúsculas + colapso de espacios + trim), para comparar grupos y clientes.
function normKey(v: any): string {
  return (v == null ? "" : String(v)).toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------- Lista de Clients de Zoho (empresas, aparte de los Project Groups) ----
// Zoho Projects tiene un endpoint de Clients a nivel portal, distinto de los Project
// Groups. Se trae para que TODOS los clientes cargados en Zoho aparezcan en la app,
// no sólo los que están modelados como grupo. Best effort: si el endpoint no responde
// (scope ZohoProjects.clients.READ ausente, u otra forma), se loguea y se sigue.
// Se prueban las dos formas de URL (sin/con barra final) porque Zoho es inconsistente.
async function fetchZohoClients(
  portalId: string,
  token: string,
): Promise<string[]> {
  for (const url of [
    `${ZOHO_V1}/portal/${portalId}/clients`,
    `${ZOHO_V1}/portal/${portalId}/clients/`,
  ]) {
    const data = await fetchAllPagesV1(url, ["clients", "clientusers"], token);
    if (data && data.length) {
      const names = [
        ...new Set(
          data
            .map((c: any) => c.name || c.client_name || c.company_name || "")
            .filter((n: string) => Boolean(n)),
        ),
      ];
      console.log(`Zoho Clients encontrados: ${names.length} (${url})`);
      return names as string[];
    }
  }
  console.log("Zoho Clients: sin resultados (¿scope ZohoProjects.clients.READ o forma del endpoint?)");
  return [];
}

// ---------- Auto-provisión de clientes desde los Project Groups de Zoho ----------
// Cada grupo REAL de Zoho (con o sin proyectos; el pseudo-grupo interno ya se excluyó
// en fetchGroupByProjectId) que todavía NO tenga cliente (por nombre o alias) se crea
// como cliente: client_name = nombre del grupo, alias = mismo grupo (así sobrevive a
// un rename del cliente), needs_review = true (datos a completar a mano). Nunca pisa
// clientes existentes ni sus datos. Si algo falla, se loguea y el sync sigue: la
// auto-provisión es "best effort".
async function ensureClientsForGroups(
  supabase: any,
  groupNames: string[],
): Promise<void> {
  if (!groupNames || groupNames.length === 0) return;
  const { data: clients, error } = await supabase
    .from("clients")
    .select("client_name, zoho_group_name");
  if (error) {
    console.log("Auto-clientes: no se pudo leer clients, se omite:", error.message);
    return;
  }
  const covered = new Set<string>();
  for (const c of clients ?? []) {
    if (c.client_name) covered.add(normKey(c.client_name));
    if (c.zoho_group_name) covered.add(normKey(c.zoho_group_name));
  }
  for (const g of groupNames) {
    const key = normKey(g);
    if (!key || covered.has(key)) continue;
    const { error: insErr } = await supabase.from("clients").insert({
      client_name: g,
      // alias = grupo: si mañana renombran el cliente, el grupo sigue mapeando.
      zoho_group_name: g,
      // Contactos vacíos y sin MSA: datos a completar. needs_review lo avisa en la UI.
      primary_contact_name: "",
      primary_contact_email: "",
      msa_url: null,
      needs_review: true,
      created_by: "zoho-sync",
    });
    if (insErr) {
      console.log(`Auto-clientes: no se pudo crear '${g}':`, insErr.message);
      continue;
    }
    covered.add(key); // evita duplicar si dos grupos normalizan igual en esta corrida
    console.log(`Auto-cliente creado desde grupo '${g}' (needs_review)`);
  }
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

    // Projects — activos + archivados. Un proyecto archivado en Zoho puede tener
    // horas todavía sin facturar; si no lo trajéramos, esas horas perderían el
    // grupo y el cliente. Los archivados son un complemento "nice to have": si su
    // endpoint falla (4xx no soportado, o 5xx persistente que agotó los reintentos)
    // se degrada a lista vacía y el sync sigue con los activos —nunca rompe—, en
    // vez de que una caída del endpoint de archivados tumbe toda la corrida.
    const [activeProjects, archivedProjects] = await Promise.all([
      fetchAllPagesV3(`${ZOHO_V3}/portal/${portalId}/projects`, "projects", token),
      fetchAllPagesV3(
        `${ZOHO_V3}/portal/${portalId}/projects?status_type=archived`,
        "projects",
        token,
      ).catch((e) => {
        console.log("Projects archivados no disponibles, se sigue con activos:", String((e as Error)?.message ?? e));
        return [] as any[];
      }),
    ]);
    // Merge único por id (activos + archivados) SOLO para el maestro de proyectos:
    // los archivados entran para CONSERVAR el grupo que ya tenían (fix del wipe) y
    // para no perder sus datos del maestro. OJO: el listado por grupo de Zoho trae
    // sólo activos, así que un proyecto que NUNCA se sincronizó estando activo no
    // aparece en el mapa de grupos y quedará sin grupo hasta que la fuente de
    // grupos cubra archivados (a verificar en el primer run). NO se barren sus logs
    // mes a mes (ver el loop de abajo). Un proyecto no debería estar en ambas
    // listas, pero si el filtro de archived se ignora y devuelve los mismos, no se
    // duplica.
    // Archivados PRIMERO: si un proyecto aparece en ambas listas (el filtro de
    // archived se ignora o lo devuelve marcado archivado), la copia ACTIVA queda
    // como valor final (last-write-wins), que es el estado autoritativo.
    const projectsById = new Map<string, any>();
    for (const p of [...archivedProjects, ...activeProjects]) {
      const pid = String(p.id_string || p.id || "");
      if (pid) projectsById.set(pid, p);
    }
    const projects = [...projectsById.values()];
    console.log(
      `Projects: ${projects.length} (activos ${activeProjects.length}, archivados ${archivedProjects.length})`,
    );

    // Cliente = Project Group de Zoho. Se trae el mapa projectId→grupo y la lista
    // de TODOS los grupos reales aparte (el listado de proyectos no incluye el
    // grupo). Ver fetchGroupByProjectId.
    const groupInfo = await fetchGroupByProjectId(portalId, token);
    const groupByProjectId = groupInfo?.map ?? null;

    // FR-07 · crear/actualizar el maestro de proyectos desde Zoho.
    const projectsSynced = await upsertProjects(supabase, projects, groupByProjectId);
    console.log("Proyectos sincronizados:", projectsSynced);

    // Auto-provisión: un cliente por cada grupo de Zoho (con o sin proyectos) Y por
    // cada Client de la lista de Zoho (empresas, aparte de los grupos) que aún no
    // tenga uno en la app.
    const zohoClientNames = await fetchZohoClients(portalId, token);
    const allClientNames = [...new Set([...(groupInfo?.groups ?? []), ...zohoClientNames])];
    await ensureClientsForGroups(supabase, allClientNames);

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

    // El barrido de logs es SOLO sobre activos: los archivados casi nunca tienen
    // horas nuevas y barrerlos mes a mes multiplicaría las llamadas a Zoho (riesgo
    // de rate-limit/timeout de la edge function). Sus horas viejas ya se
    // sincronizaron cuando el proyecto estaba activo, y su grupo/cliente igual se
    // resuelve porque entraron al maestro (merge de arriba).
    for (const p of activeProjects) {
      // Llave EXACTA del proyecto, igual que zid en upsertProjects: los ids de
      // Zoho superan el rango seguro de JS, así que p.id (número) pierde
      // precisión. id_string es la forma canónica en string. Se usa TANTO para
      // guardar zoho_project_id como para pedir los logs: pedir con el p.id
      // numérico redondeado devolvería 0 logs para proyectos de id grande.
      const projectIdStr = String(p.id_string || p.id || "");
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
          `${ZOHO_V1}/portal/${portalId}/projects/${projectIdStr}` +
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
              // Llave hora→proyecto robusta a renames (ver clientResolver /
              // entryClient). El nombre queda como fallback en la app.
              zoho_project_id: projectIdStr,
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
