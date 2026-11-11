// electron/diaryExport.ts
//
// Экспорт дневника в Markdown и в HTML для печати в PDF. Чистые функции (без Electron и без файловой системы):
// картинки подставляет вызывающий через imageRef — относительная ссылка для .md или data: URI для PDF.
// Папка electron/ собирается отдельным tsc и не импортирует src/, поэтому названия эмоций продублированы здесь.

import type { DiaryEntry } from './diaryStore'

const EMOTION_RU: Record<string, { emoji: string; ru: string }> = {
  joy: { emoji: '😊', ru: 'радость' }, affection: { emoji: '💙', ru: 'нежность' }, playful: { emoji: '😼', ru: 'игривость' },
  smug: { emoji: '😏', ru: 'самодовольство' }, embarrassed: { emoji: '😳', ru: 'смущение' }, annoyed: { emoji: '😠', ru: 'раздражение' },
  sad: { emoji: '😢', ru: 'грусть' }, worried: { emoji: '😟', ru: 'тревога' }, curious: { emoji: '🤔', ru: 'любопытство' },
  sleepy: { emoji: '😴', ru: 'сонливость' }, excited: { emoji: '🤩', ru: 'восторг' }, neutral: { emoji: '🙂', ru: 'спокойствие' },
}
const emo = (label: string) => EMOTION_RU[label] ?? EMOTION_RU.neutral
const emoText = (label: string) => `${emo(label).emoji} ${emo(label).ru}`

const PHOTO_KIND_RU: Record<string, string> = { selfie: 'селфи', generated: 'нарисовано', user: 'фото', card: 'открытка' }

/** Ссылка на картинку для вставки в документ; null — картинку не вставлять */
export type ImageRef = (file: string) => string | null

export interface ExportOptions {
  /** Как ссылаться на картинки; не задано — без картинок */
  imageRef?: ImageRef
  /** Дата «экспортировано» (для тестов) */
  now?: Date
  /** Имя ассистента в заголовке */
  title?: string
}

/* ───────────────────────── общие помощники ───────────────────────── */

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Однострочный текст: переводы строк и повторные пробелы → один пробел */
const oneLine = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim()

const pct = (v: number): number => Math.round(Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)) * 100)

const ruDate = (date: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })
}

/** Записи по порядку дат: в файле дневник читается от старых к новым */
export const sortChronological = (entries: DiaryEntry[]): DiaryEntry[] =>
  [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)

/** Имя файла без символов, запрещённых в Windows, и без управляющих; не пустое, не длиннее 80 */
export function safeFileName(s: string, fallback = 'diary'): string {
  const cleaned = String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 80)
    .trim()
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return fallback
  return cleaned
}

/** Имя файла по умолчанию: одна запись — по дате и названию, несколько — по периоду */
export function defaultFileName(entries: DiaryEntry[], ext: 'md' | 'pdf'): string {
  const sorted = sortChronological(entries)
  if (sorted.length === 1) {
    const e = sorted[0]
    return `${safeFileName(`neko-diary ${e.date} ${e.title}`, `neko-diary-${e.date}`)}.${ext}`
  }
  const from = sorted[0]?.date ?? ''
  const to = sorted[sorted.length - 1]?.date ?? ''
  return `${from && to ? `neko-diary_${from}${from === to ? '' : `_${to}`}` : 'neko-diary'}.${ext}`
}

/** Какие картинки понадобятся (без повторов, порядок появления) */
export function imageFiles(entries: DiaryEntry[]): string[] {
  const out: string[] = []
  for (const e of entries) for (const p of e.photos ?? []) if (p.file && !out.includes(p.file)) out.push(p.file)
  return out
}

/* ───────────────────────── Markdown ───────────────────────── */

function entryMarkdown(e: DiaryEntry, opts: ExportOptions, level: 1 | 2): string {
  const h = '#'.repeat(level)
  const h2 = '#'.repeat(level + 1)
  const out: string[] = []
  out.push(`${h} ${e.date}${e.title ? ` — ${oneLine(e.title)}` : ''}`)

  const mood = `${emoText(e.mood?.label)}${e.mood ? ` (${pct(e.mood.intensity)}%)` : ''}`
  out.push(`*Настроение: ${mood}${e.mood?.summary ? ` — ${oneLine(e.mood.summary)}` : ''}*`)
  out.push('')
  if (e.text?.trim()) out.push(e.text.trim(), '')

  if (e.thoughts?.length) {
    out.push(`${h2} Мысли`, '')
    for (const t of e.thoughts) out.push(`- Про «${oneLine(t.about)}» — ${oneLine(t.thought)} (${emoText(t.emotion)})`)
    out.push('')
  }
  const stats = [...(e.emotionStats ?? [])].filter((s) => s.count > 0).sort((a, b) => b.count - a.count)
  if (stats.length) {
    out.push(`${h2} Эмоции за период`, '', stats.map((s) => `${emoText(s.label)} ×${s.count}`).join(' · '), '')
  }

  const photos = (e.photos ?? [])
    .map((p) => ({ p, ref: opts.imageRef?.(p.file) ?? null }))
    .filter((x): x is { p: (typeof e.photos)[number]; ref: string } => !!x.ref)
  if (photos.length) {
    out.push(`${h2} Фото`, '')
    for (const { p, ref } of photos) {
      const cap = oneLine(p.caption)
      out.push(`![${cap.replace(/[[\]]/g, '')}](${ref})`, `*${[PHOTO_KIND_RU[p.kind], cap].filter(Boolean).join(' · ')}*`, '')
    }
  }
  const meta = [`сообщений: ${e.messageCount}`, e.source === 'manual' ? 'написано по просьбе' : 'написано сама', e.model ? `модель: ${e.model}` : '']
  out.push(`<sub>${meta.filter(Boolean).join(' · ')}</sub>`)
  return out.join('\n')
}

export function entriesToMarkdown(entries: DiaryEntry[], opts: ExportOptions = {}): string {
  const list = sortChronological(entries)
  const now = opts.now ?? new Date()
  const title = opts.title ?? 'NEKO'
  const parts: string[] = []
  if (list.length > 1) {
    parts.push(`# Дневник ${title}`, '', `Записей: ${list.length} · ${list[0].date} — ${list[list.length - 1].date}`, '')
  }
  const level: 1 | 2 = list.length > 1 ? 2 : 1
  parts.push(list.map((e) => entryMarkdown(e, opts, level)).join('\n\n---\n\n'))
  parts.push('', '---', '', `<sub>Экспортировано из ${title}, ${now.toLocaleDateString('ru-RU')}</sub>`, '')
  return parts.join('\n')
}

/* ───────────────────────── HTML (для PDF) ───────────────────────── */

/** Упрощённый Markdown → HTML: всё экранируется заранее, потом включается только разрешённая разметка */
export function markdownLiteToHtml(src: string): string {
  const inline = (s: string): string =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<i>$1</i>')
      .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1') // ссылки в печатной версии — просто текст
  const blocks = String(src ?? '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)
  const out: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`)
    } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`)
    } else if (/^#{1,6}\s+/.test(lines[0])) {
      out.push(`<h4>${inline(lines[0].replace(/^#{1,6}\s+/, ''))}</h4>`)
      if (lines.length > 1) out.push(`<p>${lines.slice(1).map(inline).join('<br>')}</p>`)
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`)
    }
  }
  return out.join('\n')
}

const CSS = `
@page { size: A4; margin: 16mm 15mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11pt/1.55 'Segoe UI', 'Noto Sans', Arial, 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; color: #222; }
h1 { font-size: 22pt; margin: 0 0 4pt; }
h2 { font-size: 16pt; margin: 0 0 4pt; }
h3 { font-size: 12.5pt; margin: 14pt 0 4pt; color: #555; }
h4 { font-size: 11.5pt; margin: 10pt 0 2pt; }
.sub { color: #777; font-size: 9.5pt; }
.mood { margin: 2pt 0 10pt; padding: 6pt 10pt; border-left: 3pt solid #9b7bb8; background: #f5f1fa; font-style: italic; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
code { font-family: Consolas, monospace; background: #eee; padding: 0 2pt; }
.entry + .entry { break-before: page; }
.thought { margin: 0 0 4pt; } .thought .em { color: #777; }
figure { margin: 8pt 0; break-inside: avoid; }
figure img { max-width: 100%; max-height: 95mm; object-fit: contain; border-radius: 4pt; display: block; }
figcaption { color: #666; font-size: 9.5pt; margin-top: 2pt; }
footer { margin-top: 18pt; color: #999; font-size: 9pt; }
`

function entryHtml(e: DiaryEntry, opts: ExportOptions): string {
  const out: string[] = ['<section class="entry">']
  out.push(`<h2>${escapeHtml(oneLine(e.title) || 'Без названия')}</h2>`)
  out.push(`<div class="sub">${escapeHtml(ruDate(e.date))}</div>`)
  const mood = `${emoText(e.mood?.label)}${e.mood ? ` (${pct(e.mood.intensity)}%)` : ''}${e.mood?.summary ? ` — ${oneLine(e.mood.summary)}` : ''}`
  out.push(`<div class="mood">${escapeHtml(mood)}</div>`)
  if (e.text?.trim()) out.push(markdownLiteToHtml(e.text))

  if (e.thoughts?.length) {
    out.push('<h3>Мысли</h3>')
    for (const t of e.thoughts) {
      out.push(`<div class="thought">Про «${escapeHtml(oneLine(t.about))}» — ${escapeHtml(oneLine(t.thought))} <span class="em">${escapeHtml(emoText(t.emotion))}</span></div>`)
    }
  }
  const stats = [...(e.emotionStats ?? [])].filter((s) => s.count > 0).sort((a, b) => b.count - a.count)
  if (stats.length) out.push(`<h3>Эмоции за период</h3><p>${escapeHtml(stats.map((s) => `${emoText(s.label)} ×${s.count}`).join(' · '))}</p>`)

  const figs: string[] = []
  for (const p of e.photos ?? []) {
    const ref = opts.imageRef?.(p.file)
    if (!ref) continue
    // ссылка попадает в атрибут: разрешаем только data:image и экранируем кавычки
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(ref)) continue
    const cap = [PHOTO_KIND_RU[p.kind], oneLine(p.caption)].filter(Boolean).join(' · ')
    figs.push(`<figure><img src="${ref}" alt="">${cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : ''}</figure>`)
  }
  if (figs.length) out.push('<h3>Фото</h3>', ...figs)
  out.push('</section>')
  return out.join('\n')
}

export function entriesToHtml(entries: DiaryEntry[], opts: ExportOptions = {}): string {
  const list = sortChronological(entries)
  const now = opts.now ?? new Date()
  const title = opts.title ?? 'NEKO'
  const head = list.length > 1
    ? `<header><h1>Дневник ${escapeHtml(title)}</h1><div class="sub">Записей: ${list.length} · ${escapeHtml(list[0].date)} — ${escapeHtml(list[list.length - 1].date)}</div></header>`
    : ''
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Дневник ${escapeHtml(title)}</title><style>${CSS}</style></head>
<body>${head}
${list.map((e) => entryHtml(e, opts)).join('\n')}
<footer>Экспортировано из ${escapeHtml(title)}, ${escapeHtml(now.toLocaleDateString('ru-RU'))}</footer>
</body></html>`
}

/** Относительная ссылка на картинку в папке рядом с .md: «имя_files/файл.png» (с экранированием для Markdown) */
export const relativeImageRef = (folder: string, file: string): string => `${encodeURIComponent(folder)}/${encodeURIComponent(file)}`

/* ───────────────────────── запрос на экспорт (из окна) ───────────────────────── */

export interface ExportRequest {
  format: 'md' | 'pdf'
  /** null — все записи */
  ids: string[] | null
  images: boolean
}

const ENTRY_ID = /^[\w.-]{1,64}$/

/** Приводит запрос из окна к безопасному виду. null — запрос не наш */
export function parseExportRequest(raw: unknown): ExportRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.format !== 'md' && r.format !== 'pdf') return null
  let ids: string[] | null = null
  if (Array.isArray(r.ids)) ids = r.ids.filter((x): x is string => typeof x === 'string' && ENTRY_ID.test(x)).slice(0, 5000)
  return { format: r.format, ids, images: r.images !== false }
}

