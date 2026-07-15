// Genera tests/visual/report.html: baseline vs. after, lado a lado, para
// revisión manual (no es una aserción — se espera que todo haya cambiado).
import { readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const baselineDir = join(dir, 'baseline')
const afterDir = join(dir, 'after')

const baselineFiles = new Set(readdirSync(baselineDir).filter((f) => f.endsWith('.png')))
const afterFiles = new Set(readdirSync(afterDir).filter((f) => f.endsWith('.png')))
const names = [...new Set([...baselineFiles, ...afterFiles])].sort()

const rows = names
  .map((name) => {
    const inBaseline = baselineFiles.has(name)
    const inAfter = afterFiles.has(name)
    const label = name.replace(/\.png$/, '').replace(/^\d+-/, '')
    return `
      <section class="pair">
        <h2>${label}${!inBaseline ? ' <span class="tag tag--new">new</span>' : ''}${!inAfter ? ' <span class="tag tag--missing">missing in after</span>' : ''}</h2>
        <div class="shots">
          <figure>
            <figcaption>Baseline</figcaption>
            ${inBaseline ? `<img src="baseline/${name}" loading="lazy" />` : '<div class="empty">—</div>'}
          </figure>
          <figure>
            <figcaption>After</figcaption>
            ${inAfter ? `<img src="after/${name}" loading="lazy" />` : '<div class="empty">—</div>'}
          </figure>
        </div>
      </section>`
  })
  .join('\n')

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Southpoint UI redesign — baseline vs. after</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #0D0D0F; color: #FAFAFA; font-family: Inter, system-ui, sans-serif; }
  h1 { font-family: Montserrat, sans-serif; font-weight: 300; letter-spacing: .04em; text-transform: uppercase; }
  .pair { margin-bottom: 48px; border-bottom: 1px solid #1F1F24; padding-bottom: 32px; }
  .pair h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: #B8B8BC; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: none; letter-spacing: 0; }
  .tag--new { background: rgba(0,191,212,.15); color: #00BFD4; }
  .tag--missing { background: rgba(239,68,68,.15); color: #EF4444; }
  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; }
  figcaption { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6B6B72; margin-bottom: 8px; }
  img { width: 100%; height: auto; border: 1px solid #1F1F24; border-radius: 6px; display: block; }
  .empty { border: 1px dashed #1F1F24; border-radius: 6px; padding: 40px; text-align: center; color: #6B6B72; }
  @media (max-width: 900px) { .shots { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <h1>Southpoint UI redesign</h1>
  <p>Baseline (antes) vs. after (después) — ${names.length} pantallas. Todo debería verse distinto; esto es para revisión manual, no valida nada automáticamente.</p>
  ${rows}
</body>
</html>`

writeFileSync(join(dir, 'report.html'), html)
console.log(`report.html generado con ${names.length} pares (baseline/${baselineFiles.size}, after/${afterFiles.size})`)
