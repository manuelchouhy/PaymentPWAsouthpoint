/*
 * Genera los íconos PWA (placeholders) sin dependencias externas.
 * Dibuja círculos concéntricos terracota / hueso y los codifica como PNG
 * usando sólo módulos nativos de Node (zlib + buffers).
 *
 * Uso:  node scripts/generate-icons.mjs   (o bien: npm run icons)
 *
 * Reemplazá estos archivos por el set de íconos definitivo cuando lo tengas.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const TERRACOTTA = [0xc2, 0x50, 0x2f]
const BONE = [0xf1, 0xe7, 0xd6]

// --- Codificación PNG -------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePNG(size, rgba) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // profundidad de bit
  ihdr[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filtro: ninguno
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Dibujo -----------------------------------------------------------------
function colorAt(distance, size) {
  if (distance < size * 0.085) return BONE
  if (distance < size * 0.225) return TERRACOTTA
  if (distance < size * 0.34) return BONE
  return TERRACOTTA
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const center = size / 2
  const SAMPLES = [0.25, 0.75] // supersampling 2x2 para bordes suaves
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0
      for (const ox of SAMPLES) {
        for (const oy of SAMPLES) {
          const dx = x + ox - center
          const dy = y + oy - center
          const col = colorAt(Math.hypot(dx, dy), size)
          r += col[0]
          g += col[1]
          b += col[2]
        }
      }
      const i = (y * size + x) * 4
      rgba[i] = Math.round(r / 4)
      rgba[i + 1] = Math.round(g / 4)
      rgba[i + 2] = Math.round(b / 4)
      rgba[i + 3] = 255
    }
  }
  return rgba
}

// --- Generación -------------------------------------------------------------
mkdirSync(PUBLIC_DIR, { recursive: true })

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]

for (const [name, size] of targets) {
  const png = encodePNG(size, render(size))
  writeFileSync(join(PUBLIC_DIR, name), png)
  console.log(`  ✓ public/${name}  (${size}×${size}, ${png.length} bytes)`)
}

console.log('Iconos PWA generados.')
