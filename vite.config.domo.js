import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Config de Vite EXCLUSIVA para el bundle de app custom de DOMO (Asset Library).
//
// Diferencias vs. vite.config.js (build web/PWA):
//   - base: './'  → assets con rutas relativas, requerido para correr dentro del
//     iframe sandbox de DOMO (*.domoapps.com), donde la app no vive en el root.
//   - define (FORCED_ENV) → fuerza modo mock + credenciales vacías + api mode
//     en tiempo de build. Vite prioriza las vars exportadas en el shell por
//     sobre los archivos .env, así que un archivo .env con valores vacíos NO
//     alcanza; `define` gana (verificado empíricamente en esta versión de Vite:
//     una VITE_SUPABASE_URL exportada en el shell NO queda en el bundle). Aun
//     así, la garantía dura la da el escáner post-build (abajo), no la premisa
//     de precedencia de `define`.
//   - Sin vite-plugin-pwa → sin service worker: un SW dentro del iframe de DOMO
//     molesta y cachea (deploy fantasma). El PWA queda sólo para el build web.
//   - plugin domoBundle() → copia el manifest y ESCANEA el bundle en busca de
//     credenciales. Al vivir en la config, corre en cualquier build con este
//     archivo (no sólo vía el npm script), cerrando el único hueco de la red.
//   - outDir: dist-domo → separado del dist/ web para no pisar el otro build.

const root = fileURLToPath(new URL('.', import.meta.url))

// Valores forzados al bundle de DOMO (ver nota de `define` arriba).
const FORCED_ENV = {
  VITE_FORCE_MOCK: 'true',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  VITE_TEST_MODE: 'false',
  VITE_TEST_ADMIN_EMAIL: '',
  VITE_TEST_ADMIN_PASSWORD: '',
  // El api layer elige cliente por VITE_API_MODE ('http' → httpApiClient hace
  // fetch REAL a VITE_API_BASE_URL sin chequear mock). Forzamos 'supabase' (que
  // con isSupabaseConfigured=false cae a los mocks de *Data.js) y base vacío,
  // para que el bundle NUNCA pueda enrutar a un backend externo.
  VITE_API_MODE: 'supabase',
  VITE_API_BASE_URL: '',
}
const forcedDefine = Object.fromEntries(
  Object.entries(FORCED_ENV).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
)

// Post-build: copia el manifest de DOMO y escanea el bundle en busca de
// credenciales con forma (URL de Supabase / JWT) además de los valores literales
// largos de .env.local si existe. Aborta el build ante cualquier match.
function domoBundle() {
  let outDir = 'dist-domo'
  let viteRoot = root
  return {
    name: 'domo-bundle',
    configResolved(cfg) {
      outDir = cfg.build.outDir
      // cfg.root es el root que Vite usa para resolver outDir (default cwd).
      // Usarlo evita escanear un dir equivocado si se buildea desde otro cwd.
      viteRoot = cfg.root
    },
    closeBundle() {
      // resolve (no join): si outDir ya es absoluto, resolve lo respeta; si es
      // relativo, lo ancla al root de Vite (donde Vite realmente emite).
      const out = resolve(viteRoot, outDir)

      // 1. Manifest (con guard de existencia, mensaje claro). El fuente vive
      // junto a este config (root), no en el cwd del build.
      const manifestSrc = join(root, 'domo', 'manifest.json')
      if (!existsSync(manifestSrc)) {
        this.error(`[domo] falta ${manifestSrc} — no se puede armar el bundle.`)
      }
      writeFileSync(join(out, 'manifest.json'), readFileSync(manifestSrc))

      // 1b. Thumbnail 300×300 (DOMO lo exige para poder crear cards del diseño).
      // Se genera con scripts/generate-domo-thumbnail.mjs. Best-effort: si falta,
      // el bundle igual publica, pero no se podrán crear cards hasta agregarlo.
      const thumbSrc = join(root, 'domo', 'thumbnail.png')
      if (existsSync(thumbSrc)) {
        writeFileSync(join(out, 'thumbnail.png'), readFileSync(thumbSrc))
      } else {
        console.warn('[domo] aviso: falta domo/thumbnail.png (300×300) — sin él no se pueden crear cards.')
      }

      // 2. Escaneo de credenciales.
      const patterns = [
        { name: 'URL de proyecto Supabase', re: /https:\/\/[a-z0-9]{16,}\.supabase\.co/ },
        // JWT: header Y payload son base64 de JSON, así que ambos arrancan en
        // 'eyJ' (base64 de '{"'). Exigir DOS segmentos 'eyJ...' separados por
        // punto es muy específico de un JWT real → casi cero falsos positivos
        // (un blob base64 suelto de vendor no tiene esa forma de 3 partes).
        { name: 'JWT (posible anon/service key)', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
      ]
      // Literales largos desde CUALQUIER .env* — de la raíz Y de domo/env (que
      // es el envDir real del build de DOMO). .env, .env.production, .env.local,
      // etc. son lugares habituales para guardar claves.
      const secretVars = /^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|VITE_TEST_ADMIN_EMAIL|VITE_TEST_ADMIN_PASSWORD)$/
      const seenLiterals = new Set()
      for (const dir of [root, join(root, 'domo', 'env')]) {
        if (!existsSync(dir)) continue
        for (const f of readdirSync(dir)) {
          if (!/^\.env($|\.)/.test(f) || f === '.env.example') continue
          const fp = join(dir, f)
          if (!statSync(fp).isFile()) continue // ignora un eventual dir '.env.d'
          for (const line of readFileSync(fp, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
            // Sólo literales largos (>=12): un password corto/común ('admin')
            // matchearía JS de vendors y abortaría todo build por falso positivo.
            if (m && secretVars.test(m[1]) && m[2].length >= 12 && !seenLiterals.has(m[2])) {
              seenLiterals.add(m[2])
              patterns.push({ name: `valor de ${m[1]} (${f})`, literal: m[2] })
            }
          }
        }
      }

      function* walk(dir) {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry)
          if (statSync(p).isDirectory()) yield* walk(p)
          else yield p
        }
      }

      const hits = []
      let scanned = 0
      for (const file of walk(out)) {
        if (!/\.(js|css|html|json|map)$/.test(file)) continue
        scanned++
        const content = readFileSync(file, 'utf8')
        for (const p of patterns) {
          if (p.literal ? content.includes(p.literal) : p.re.test(content)) {
            hits.push({ file, name: p.name })
          }
        }
      }

      if (hits.length) {
        for (const h of hits) console.error(`[domo]   - ${h.name} en ${h.file}`)
        this.error('[domo] ABORTADO: posibles credenciales en el bundle. Debe ser 100% mock — revisá el entorno de build.')
      }
      console.log(`[domo] manifest OK · ${scanned} archivos escaneados, sin credenciales. Bundle listo en ${outDir}/.`)
    },
  }
}

export default defineConfig({
  base: './',
  // Capa 1: envDir a una carpeta limpia (sin .env.local) → el build no hereda
  // las credenciales reales del proyecto desde archivos .env.
  envDir: fileURLToPath(new URL('./domo/env', import.meta.url)),
  // Capa 2: define fuerza los valores por sobre las vars del shell (que Vite
  // prioriza incluso sobre envDir).
  define: forcedDefine,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [react(), domoBundle()],
  build: {
    outDir: 'dist-domo',
    emptyOutDir: true,
  },
})
