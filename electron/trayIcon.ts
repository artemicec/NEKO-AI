// electron/trayIcon.ts
//
// Запасной значок для трея, если файла public/icons/<persona>.png рядом нет: без значка трей на Windows невидим.
// Рисуем кружок нужного цвета и кодируем в PNG сами (zlib есть в Node) — без картинок и сторонних пакетов.

import zlib from 'zlib'

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Круглый значок size×size: цвет [r,g,b], мягкий край, светлая «искра» в центре. Возвращает байты PNG */
export function fallbackIconPng(color: [number, number, number], size = 32): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const c = (size - 1) / 2
  const R = size / 2 - 1
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // фильтр «без фильтра»
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const alpha = Math.max(0, Math.min(1, R + 0.5 - d)) // сглаженный край
      const spark = Math.max(0, 1 - d / (R * 0.45)) * 0.55 // светлое пятно в центре
      const o = row + 1 + x * 4
      raw[o] = Math.round(color[0] + (255 - color[0]) * spark)
      raw[o + 1] = Math.round(color[1] + (255 - color[1]) * spark)
      raw[o + 2] = Math.round(color[2] + (255 - color[2]) * spark)
      raw[o + 3] = Math.round(alpha * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8 бит на канал
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Цвета ассистентов: NEKO — фиолетовый, ARIA — голубой */
export const PERSONA_COLOR: Record<'neko' | 'aria', [number, number, number]> = {
  neko: [155, 123, 184],
  aria: [64, 180, 230],
}
