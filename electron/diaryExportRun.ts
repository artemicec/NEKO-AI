// electron/diaryExportRun.ts
//
// Экспорт дневника: диалог «Сохранить как», запись .md (с картинками в папке рядом) или .pdf.
// PDF печатается из скрытого окна без скриптов и без доступа к сети: HTML собран заранее, весь текст экранирован,
// картинки встроены как data:-адреса, CSP разрешает только их. Сама сборка текста — в ./diaryExport (чистые функции).

import { BrowserWindow, app, dialog, shell } from 'electron'
import type { SaveDialogOptions } from 'electron'
import fs from 'fs'
import path from 'path'
import type { DiaryEntry, DiaryStore } from './diaryStore'
import { defaultFileName, entriesToHtml, entriesToMarkdown, imageFiles, parseExportRequest, relativeImageRef, sortChronological } from './diaryExport'
import type { ExportRequest } from './diaryExport'

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  path?: string
  count?: number
  /** Сколько картинок вошло в файл */
  images?: number
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 80 * 1024 * 1024 // общий размер встроенных в PDF картинок
const PDF_TIMEOUT_MS = 60_000
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function collect(store: DiaryStore, req: ExportRequest): DiaryEntry[] {
  if (!req.ids) return store.list()
  const out: DiaryEntry[] = []
  for (const id of req.ids) {
    const e = store.get(id)
    if (e) out.push(e)
  }
  return out
}

async function askPath(parent: BrowserWindow | null, entries: DiaryEntry[], ext: 'md' | 'pdf'): Promise<string | null> {
  const opts: SaveDialogOptions = {
    title: ext === 'md' ? 'Сохранить дневник как Markdown' : 'Сохранить дневник как PDF',
    defaultPath: path.join(app.getPath('documents'), defaultFileName(entries, ext)),
    filters: [ext === 'md' ? { name: 'Markdown', extensions: ['md'] } : { name: 'PDF', extensions: ['pdf'] }],
  }
  const res = parent && !parent.isDestroyed() ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  return res.filePath.toLowerCase().endsWith(`.${ext}`) ? res.filePath : `${res.filePath}.${ext}`
}

async function writeMarkdown(store: DiaryStore, entries: DiaryEntry[], dest: string, withImages: boolean): Promise<number> {
  const folder = `${path.basename(dest, path.extname(dest))}_files`
  const dir = path.join(path.dirname(dest), folder)
  const copied = new Set<string>()
  if (withImages) {
    for (const file of imageFiles(entries)) {
      const src = store.imagePath(file)
      if (!src) continue
      try {
        fs.mkdirSync(dir, { recursive: true })
        fs.copyFileSync(src, path.join(dir, path.basename(file)))
        copied.add(file)
      } catch { /* не скопировалась — эта картинка просто не войдёт в файл */ }
    }
  }
  const md = entriesToMarkdown(entries, { imageRef: (f) => (copied.has(f) ? relativeImageRef(folder, path.basename(f)) : null) })
  fs.writeFileSync(dest, md, 'utf8')
  return copied.size
}

async function writePdf(store: DiaryStore, entries: DiaryEntry[], dest: string, withImages: boolean): Promise<number> {
  const embedded = new Set<string>()
  const uris = new Map<string, string>()
  let total = 0
  if (withImages) {
    for (const file of imageFiles(entries)) {
      const src = store.imagePath(file)
      const mime = MIME[path.extname(file).toLowerCase()]
      if (!src || !mime) continue
      try {
        const size = fs.statSync(src).size
        if (size > MAX_IMAGE_BYTES || total + size > MAX_TOTAL_BYTES) continue
        uris.set(file, `data:${mime};base64,${fs.readFileSync(src).toString('base64')}`)
        embedded.add(file)
        total += size
      } catch { /* пропускаем */ }
    }
  }
  const html = entriesToHtml(entries, { imageRef: (f) => uris.get(f) ?? null })
  const tmp = path.join(app.getPath('temp'), `neko-diary-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(tmp, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    width: 820,
    height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true },
  })
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    const work = (async () => {
      await win.loadFile(tmp)
      return win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    const pdf = await Promise.race([
      work,
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('PDF не получился за минуту')), PDF_TIMEOUT_MS) }),
    ]).finally(() => clearTimeout(timer))
    fs.writeFileSync(dest, pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
  }
  return embedded.size
}

export async function exportDiary(store: DiaryStore, raw: unknown, parent: BrowserWindow | null): Promise<ExportResult> {
  const req = parseExportRequest(raw)
  if (!req) return { ok: false, error: 'Неверный запрос на экспорт' }
  try {
    const entries = sortChronological(collect(store, req))
    if (!entries.length) return { ok: false, error: 'Нет записей для экспорта' }
    const dest = await askPath(parent, entries, req.format)
    if (!dest) return { ok: false, canceled: true }
    const images = req.format === 'md' ? await writeMarkdown(store, entries, dest, req.images) : await writePdf(store, entries, dest, req.images)
    try { shell.showItemInFolder(dest) } catch { /* не критично */ }
    return { ok: true, path: dest, count: entries.length, images }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
