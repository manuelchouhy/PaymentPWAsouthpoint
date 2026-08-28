/*
 * Genera domo/thumbnail.png (300×300) para el bundle de app de DOMO.
 * DOMO exige un thumbnail 300×300 en el diseño para poder crear cards.
 * Reusa la misma técnica de PNG puro (zlib + buffers, sin dependencias) que
 * scripts/generate-icons.mjs, con el mismo motivo de círculos concéntricos.
 *
 * Uso:  node scripts/generate-domo-thumbnail.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'domo')
const SIZE = 300

const TERRACOTTA = [0xc2, 0x50, 0x2f]
const BONE = [0xf1, 0xe7, 0xd6]

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
  ihdr[8] = 8 // bit depth
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

function colorAt(distance, size) {
  if (distance < size * 0.085) return BONE
  if (distance < size * 0.225) return TERRACOTTA
  if (distance < size * 0.34) return BONE
  return TERRACOTTA
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const center = size / 2
  const SAMPLES = [0.25, 0.75]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0
      for (const ox of SAMPLES) {
        for (const oy of SAMPLES) {
          const col = colorAt(Math.hypot(x + ox - center, y + oy - center), size)
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

mkdirSync(OUT_DIR, { recursive: true })
const png = encodePNG(SIZE, render(SIZE))
writeFileSync(join(OUT_DIR, 'thumbnail.png'), png)
console.log(`✓ domo/thumbnail.png (${SIZE}×${SIZE}, ${png.length} bytes)`)
