# Gestión de Pagos a Proveedores

PWA (Progressive Web App) instalable para revisar las horas registradas por
proveedor y procesar pagos. Pensada para usarse desde el celular —se instala
en iPhone y Android sin pasar por las tiendas— y también funciona en escritorio.

La pantalla principal, **Time Entries**, es una grilla de entradas de tiempo
con selección de filas, suma de horas en vivo y un flujo de pago con
validación de "un proveedor por vez". Los pagos se registran en Supabase.

---

## Características

- **Selección de filas** con checkbox por fila y "seleccionar todo" en el header.
- **Selected Hours**: suma de horas seleccionadas en vivo, como pieza destacada.
- **Filtro por proveedor** (`All users` + cada usuario).
- **Regla de pago**: sólo se puede pagar un proveedor por vez. Si la selección
  abarca varios, el botón **Pay** se deshabilita y aparece un aviso.
- **Modal "Procesar Pago"** con `Invoice Number` (requerido) y
  `Transaction Number` (opcional). Inserta una fila en `payments`.
- **Toast de confirmación** al registrar el pago.
- Diseño responsive: tabla en escritorio, tarjetas en móvil.
- Instalable y con funcionamiento offline (service worker).
- App de **solo lectura sobre time_entries**: el pago real se procesa en otro
  sistema; aquí únicamente se registra.

---

## Stack

- **React 18** + **Vite 5**
- **vite-plugin-pwa** — manifest + service worker (`registerType: autoUpdate`)
- **@supabase/supabase-js** — cliente de la base de datos
- **lucide-react** — íconos
- Sin librería de estado externa: alcanza con `useState` / `useMemo`.

---

## Requisitos

- Node.js 18 o superior (probado con Node 22).
- Una cuenta gratuita de [Supabase](https://supabase.com) (sólo para el modo
  con base real; en modo demo no hace falta).

---

## Modo demo vs modo Supabase

La app funciona en dos modos sin cambios de código:

- **Modo demo (sin Supabase)**: si `VITE_SUPABASE_URL` o
  `VITE_SUPABASE_ANON_KEY` están vacías o no existen, la app carga 12 entradas
  mock de 4 proveedores. Procesar un pago **no escribe nada** — sólo simula la
  latencia y muestra el toast. Útil para mostrar la UI, hacer demos o trabajar
  el frontend sin tocar la DB.
- **Modo Supabase (real)**: con las dos env vars completas, `getTimeEntries()`
  lee de la tabla `time_entries` y `createPayment()` inserta en `payments`.

El modo se elige automáticamente en `src/lib/supabase.js` según las env vars.

---

## Cómo correrlo localmente

### 1 · Modo demo (sin Supabase)

```bash
npm install
npm run dev
```

Vite imprime la URL local (por defecto `http://localhost:5173`). Verás un
warning en la consola del navegador indicando que está corriendo en modo demo.

### 2 · Modo Supabase (con base real)

```bash
npm install
cp .env.example .env.local        # en Windows: copy .env.example .env.local
# editá .env.local y completá las dos variables
npm run dev
```

> En modo `dev` el service worker está desactivado a propósito (evita
> problemas de caché mientras se desarrolla). Para probar la **instalación**
> y el modo offline, usá el build de producción (ver abajo).

---

## Configurar Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com) (plan gratuito sirve).
2. Abrí el **SQL Editor** → pegá el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Eso crea las tablas
   `time_entries` y `payments`, índices, RLS y los 12 registros de ejemplo.
3. En **Project Settings → API**, copiá:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
4. Pegalas en `.env.local` (local) o en las **Environment Variables** del
   hosting (producción).
5. Revisá las **políticas de RLS** comentadas en `schema.sql` y descomentá la
   opción que corresponda (interna sin login, con Supabase Auth, o backend
   con service_role). **Por defecto RLS está activo y nada es accesible.**

---

## Build de producción

```bash
npm run build      # genera la carpeta dist/
npm run preview    # sirve dist/ localmente para probar la PWA real
```

`npm run preview` levanta la app con el service worker activo: ahí se puede
verificar el prompt de instalación y el comportamiento offline.

---

## Cómo deployarlo

La app es 100% estática: se publica la carpeta `dist/`. Acordate de cargar
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en el panel del hosting
(quedan inyectadas en el bundle durante el build).

### Vercel

1. Subí el proyecto a un repositorio Git e importálo en
   [vercel.com/new](https://vercel.com/new), **o** instalá la CLI y corré
   `npx vercel` desde la carpeta del proyecto.
2. Vercel detecta el preset **Vite** automáticamente:
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. **Settings → Environment Variables**: cargá `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY`.
4. Deploy. La URL resultante ya sirve la PWA con HTTPS (requisito para que
   sea instalable).

### Netlify

1. Importá el repositorio en [app.netlify.com](https://app.netlify.com), **o**
   arrastrá la carpeta `dist/` a la sección *Deploys* (deploy manual).
2. Configuración de build:
   - Build command: `npm run build`
   - Publish directory: `dist`
3. **Site settings → Environment variables**: cargá las dos `VITE_…`.
4. Deploy. Netlify sirve la app con HTTPS.

> Cualquier hosting estático con HTTPS sirve (GitHub Pages, Cloudflare Pages,
> etc.). El HTTPS es obligatorio para instalar una PWA.

---

## Cómo instalarla en el celular

Primero deployá la app (necesita HTTPS). Después, desde el navegador del
teléfono, abrí la URL deployada.

### iPhone (Safari)

1. Abrí la URL en **Safari** (no funciona desde otros navegadores en iOS).
2. Tocá el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elegí **Agregar a pantalla de inicio**.
4. Confirmá con **Agregar**. El ícono queda en la pantalla de inicio y la app
   abre a pantalla completa.

### Android (Chrome)

1. Abrí la URL en **Chrome**.
2. Aparece el aviso **Instalar app** / **Agregar a la pantalla principal**;
   tocálo. Si no aparece, abrí el menú **⋮** y elegí **Instalar app**.
3. Confirmá. La app se instala como una aplicación más del sistema.

---

## Estructura del proyecto

```
payment-pwa/
├─ .env.example             # plantilla de variables de entorno
├─ index.html
├─ vite.config.js           # Vite + configuración de la PWA (manifest, SW)
├─ supabase/
│  └─ schema.sql            # tablas, índices, RLS y datos de ejemplo
├─ scripts/
│  └─ generate-icons.mjs    # genera los íconos PWA (placeholder)
├─ public/
│  ├─ favicon.svg
│  ├─ icon-192.png          # generados por scripts/generate-icons.mjs
│  ├─ icon-512.png
│  ├─ icon-maskable-512.png
│  └─ apple-touch-icon.png
└─ src/
   ├─ main.jsx
   ├─ App.jsx               # estado, derivados y orquestación
   ├─ index.css             # sistema de diseño completo
   ├─ lib/
   │  ├─ supabase.js         # cliente de Supabase (lazy: null si falta env)
   │  ├─ data.js             # getTimeEntries() + createPayment() (con fallback mock)
   │  ├─ avatarColor.js      # color e iniciales de avatar
   │  ├─ format.js           # formato de fechas y horas
   │  └─ useMediaQuery.js    # hook tabla/tarjetas
   └─ components/
      ├─ Avatar.jsx
      ├─ Checkbox.jsx
      ├─ StatusBadge.jsx
      ├─ UserFilter.jsx
      ├─ SelectionBar.jsx
      ├─ EntriesTable.jsx
      ├─ EntriesCards.jsx
      ├─ PaymentModal.jsx
      └─ Toast.jsx
```

---

## Capa de datos

Todo el acceso a datos pasa por **dos funciones** en `src/lib/data.js`:

```js
async function getTimeEntries()
async function createPayment({ userName, totalHours, invoiceNumber, transactionNumber, entryIds })
```

Cada función decide sola si va contra Supabase o devuelve mock, mirando
`isSupabaseConfigured`. Eso permite tener la misma UI funcionando en demo y
en producción sin condicionales repartidos por la app.

---

## Íconos

Los íconos PWA son **placeholders** generados por script (círculos concéntricos
terracota / hueso), sin dependencias externas:

```bash
npm run icons
```

Esto regenera los PNG en `public/`. Reemplazá esos archivos por el set de
íconos definitivo cuando lo tengas (manteniendo los nombres y tamaños).

---

## Fase 3 — sync con Zoho Projects (próxima)

La siguiente fase suma una **Supabase Edge Function** que consume la API V3
de **Zoho Projects** y puebla incrementalmente la tabla `time_entries`. El
campo `zoho_log_id` (UNIQUE) ya está previsto para el upsert y la
deduplicación: la PWA no necesita cambios, sólo va a empezar a ver datos
reales en cuanto el sync corra.

---

## Notas

- Las animaciones usan sólo `transform` y `opacity`, y respetan
  `prefers-reduced-motion`.
- Mantené `.env.local` fuera de git (ya está en `.gitignore`).
- La **anon key** de Supabase viaja embebida en el bundle del cliente. Tratá
  el acceso a la base como público y dependé de **Row Level Security** (RLS)
  para autorizar. El `schema.sql` deja RLS activado y políticas comentadas.
