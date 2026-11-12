// src/neko/services/selfie.ts
// Канвас-графика дневника: «селфи» (снимок аватара на цветном фоне настроения) и открытка-заглушка.
// Работает только в браузерном окружении (Canvas 2D).

export interface PhotoStyle {
  /** Цвет настроения (#rrggbb) */
  color: string
  emoji: string
  /** Название настроения: «радость», «смущение» … */
  label: string
  /** «29 октября, четверг» */
  dateLabel: string
  title?: string
}

const W = 720
const H = 900

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = parseInt(m ? m[1] : '8b95ff', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** amount: -1 (чёрный) … 0 … +1 (белый) */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const t = amount < 0 ? 0 : 255
  const p = Math.abs(amount)
  const mix = (c: number) => Math.round(c + (t - c) * p)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D недоступен')
  return { canvas, ctx }
}

function paintBackground(ctx: CanvasRenderingContext2D, color: string) {
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H)
  g.addColorStop(0, shade(color, -0.6))
  g.addColorStop(0.55, shade(color, -0.35))
  g.addColorStop(1, shade(color, -0.05))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // мягкое свечение
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.42, 40, W * 0.5, H * 0.42, W * 0.75)
  glow.addColorStop(0, shade(color, 0.35).replace('rgb', 'rgba').replace(')', ', 0.55)'))
  glow.addColorStop(1, shade(color, 0.35).replace('rgb', 'rgba').replace(')', ', 0)'))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // боке
  ctx.save()
  ctx.globalAlpha = 0.12
  ctx.fillStyle = '#fff'
  const dots: [number, number, number][] = [[90, 120, 46], [620, 200, 30], [560, 740, 58], [140, 690, 26], [660, 480, 22], [60, 430, 34]]
  for (const [x, y, r] of dots) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
  ctx.restore()
}

function paintFooter(ctx: CanvasRenderingContext2D, st: PhotoStyle) {
  const barH = 96
  ctx.fillStyle = 'rgba(10, 8, 16, 0.55)'
  ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = '#ede9f2'
  ctx.textBaseline = 'middle'
  ctx.font = '600 30px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(st.dateLabel, 32, H - barH / 2)
  ctx.textAlign = 'right'
  ctx.font = '600 30px "Segoe UI", "Segoe UI Emoji", system-ui, sans-serif'
  ctx.fillText(`${st.emoji} ${st.label}`, W - 32, H - barH / 2)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Не удалось загрузить снимок аватара'))
    img.src = src
  })
}

/** Прозрачный PNG с аватаром → «фото» на фоне настроения (JPEG data URL) */
export async function composeSelfie(avatarPng: string, st: PhotoStyle): Promise<string> {
  const img = await loadImage(avatarPng)
  const { canvas, ctx } = newCanvas()
  paintBackground(ctx, st.color)

  // «cover» с привязкой к верху — в кадре лицо и плечи
  const scale = Math.max(W / img.width, (H - 96) / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (W - dw) / 2, 0, dw, dh)

  paintFooter(ctx, st)
  return canvas.toDataURL('image/jpeg', 0.9)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines - 1) break
    } else line = test
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

/** Открытка с настроением дня — запасной вариант, когда снимок аватара недоступен */
export async function renderMoodCard(st: PhotoStyle): Promise<string> {
  const { canvas, ctx } = newCanvas()
  paintBackground(ctx, st.color)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '300px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
  ctx.fillText(st.emoji, W / 2, H * 0.36)

  if (st.title) {
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 44px "Segoe UI", system-ui, sans-serif'
    const lines = wrap(ctx, st.title, W - 120, 3)
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.66 + i * 56))
  }
  paintFooter(ctx, st)
  return canvas.toDataURL('image/jpeg', 0.9)
}
