// electron/modelFiles.ts
//
// Файлы аватара вне папки программы. Установленное приложение (.exe) нельзя «дополнить» файлами внутри его папки:
// они только для чтения, да и в репозитории .vrm нет (чужие лицензии). Поэтому модели и анимации можно положить в
//   <userData>/models/…  и  <userData>/animations/…
// — протокол app:// отдаёт их раньше, чем встроенные. Здесь же — безопасное скачивание образца VRM.
// Модуль чистый (без electron): fetch и пути передаются снаружи, поэтому он проверяется тестами.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export const MAX_MODEL_BYTES = 300 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 180_000

/** «/models/default.vrm» → «default.vrm». Только .vrm в папке /models/, без подпапок и «..» */
export function modelFileName(urlPath: unknown): string | null {
  if (typeof urlPath !== 'string') return null
  const m = /^\/models\/([A-Za-z0-9][A-Za-z0-9._-]{0,80}\.vrm)$/i.exec(urlPath.trim())
  return m && !m[1].includes('..') ? m[1] : null
}

/**
 * Путь из адреса app://bundle/<rel> к файлу пользователя. Подходят только «models/…» и «animations/…»,
 * результат всегда внутри <userData>/<models|animations>; всё остальное — null (отдаётся встроенный файл).
 */
export function userAssetPath(userData: string, rel: string): string | null {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  const top = clean.split('/')[0]
  if (top !== 'models' && top !== 'animations') return null
  const root = path.resolve(userData, top)
  const file = path.resolve(userData, clean)
  return file !== root && file.startsWith(root + path.sep) ? file : null
}

/** Куда класть скачанную модель: при разработке — в public/models (его раздаёт Vite), иначе — в папку пользователя */
export const modelsDir = (isDev: boolean, appPath: string, userData: string): string =>
  isDev ? path.join(appPath, 'public', 'models') : path.join(userData, 'models')

/** Файл начинается с «glTF» — так начинается любой VRM/VRMA (бинарный glTF) */
export function looksLikeGlb(file: string): boolean {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(4)
    return fs.readSync(fd, buf, 0, 4, 0) === 4 && buf.toString('latin1') === 'glTF'
  } catch {
    return false
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

export interface ManifestModel {
  id: string
  title: string
  url: string
  sha256: string | null
  verified: boolean
  license: string
  licenseUrl: string
}

/** Манифест scripts/models.json → список с проверенной формой. Адреса не-https отбрасываются */
export function parseManifest(raw: unknown): ManifestModel[] {
  const list = (raw as { models?: unknown })?.models
  if (!Array.isArray(list)) return []
  const out: ManifestModel[] = []
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.url !== 'string' || !/^https:\/\//i.test(o.url)) continue
    out.push({
      id: o.id,
      title: typeof o.title === 'string' ? o.title : o.id,
      url: o.url,
      sha256: typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(o.sha256) ? o.sha256.toLowerCase() : null,
      verified: o.verified === true,
      license: typeof o.license === 'string' ? o.license : '',
      licenseUrl: typeof o.licenseUrl === 'string' && /^https:\/\//i.test(o.licenseUrl) ? o.licenseUrl : '',
    })
  }
  return out
}

export interface FetchedResponse {
  ok: boolean
  status: number
  body: unknown
  headers: { get(name: string): string | null }
}
export type FetchFn = (url: string, init?: { redirect?: 'follow'; signal?: AbortSignal }) => Promise<FetchedResponse>

export interface DownloadOptions {
  fetchFn: FetchFn
  expectSha256?: string | null
  maxBytes?: number
  onProgress?: (received: number, total: number) => void
}

/**
 * Скачивает url в dest через «.part»: пока файл не проверен, настоящего имени у него нет.
 * Проверки: https, размер, сигнатура «glTF» (страница с ошибкой вместо модели не сохранится), контрольная сумма (если задана).
 * Бросает Error с понятным текстом; «.part» при ошибке удаляется.
 */
export async function downloadModelFile(url: string, dest: string, o: DownloadOptions): Promise<{ bytes: number; sha256: string }> {
  if (!/^https:\/\//i.test(url)) throw new Error('Разрешены только ссылки https://')
  const maxBytes = o.maxBytes ?? MAX_MODEL_BYTES
  let res: FetchedResponse
  try {
    res = await o.fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (e) {
    throw new Error(`Нет связи с сервером скачивания. Проверь интернет. (${e instanceof Error ? e.message : String(e)})`)
  }
  if (!res.ok) throw new Error(`Сервер ответил HTTP ${res.status}`)
  if (!res.body) throw new Error('Пустой ответ сервера')
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error(`Файл слишком большой (${Math.round(declared / 1048576)} МБ)`)

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const hash = crypto.createHash('sha256')
  let bytes = 0
  let head = Buffer.alloc(0)
  try {
    const counter = async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new Error('Файл больше допустимого размера')
        if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4)
        hash.update(chunk)
        o.onProgress?.(bytes, declared)
        yield chunk
      }
    }
    await pipeline(Readable.fromWeb(res.body as never) as unknown as AsyncIterable<Buffer>, counter, fs.createWriteStream(part))
    if (head.toString('latin1') !== 'glTF') {
      throw new Error('Скачанный файл — не VRM (возможно, ссылка ведёт на страницу, а не на файл)')
    }
    const sha256 = hash.digest('hex')
    if (o.expectSha256 && sha256 !== o.expectSha256.toLowerCase()) throw new Error('Контрольная сумма не совпала — файл не сохранён')
    fs.renameSync(part, dest)
    return { bytes, sha256 }
  } catch (e) {
    try { fs.rmSync(part, { force: true }) } catch { /* ignore */ }
    throw e
  }
}
