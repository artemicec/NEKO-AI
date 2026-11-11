#!/usr/bin/env node
// scripts/download-models.mjs — скачать VRM-модель в public/models/ (npm run models:download).
//
//   npm run models:download                              — рекомендованный образец из scripts/models.json
//   npm run models:download -- --list                    — показать, что есть в манифесте
//   npm run models:download -- --only sample --force     — выбрать запись и перезаписать существующий файл
//   npm run models:download -- --url https://… --target public/models/aria.vrm   — своя ссылка
//
// Безопасность: только https, лимит размера, файл сначала скачивается в «.part», проверяется (первые 4 байта «glTF» —
// так начинается любой VRM/VRMA; страница с ошибкой вместо модели не сохранится) и только потом переименовывается.
// Лицензию модели выбирает и проверяет пользователь — скрипт её только показывает.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MAX_BYTES = 300 * 1024 * 1024
const TIMEOUT_MS = 180_000

export function parseArgs(argv) {
  const a = { list: false, force: false, only: null, url: null, target: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const next = () => argv[++i]
    if (k === '--list') a.list = true
    else if (k === '--force') a.force = true
    else if (k === '--help' || k === '-h') a.help = true
    else if (k === '--only') a.only = next() ?? null
    else if (k === '--url') a.url = next() ?? null
    else if (k === '--target' || k === '--out') a.target = next() ?? null
    else throw new Error(`Неизвестный параметр: ${k}`)
  }
  return a
}

/** Что скачивать: список { id, title, url, target (абсолютный), sha256, verified, license, licenseUrl } */
export function planDownloads(manifest, args, root) {
  if (args.url) {
    let u
    try { u = new URL(args.url) } catch { throw new Error(`Некорректная ссылка: ${args.url}`) }
    const target = args.target || path.posix.join('public/models', path.posix.basename(u.pathname) || 'model.vrm')
    return [{ id: 'custom', title: 'Своя ссылка', url: args.url, target: resolveInside(root, target), sha256: null, verified: false, license: 'Лицензию модели проверь у автора.', licenseUrl: '' }]
  }
  const all = Array.isArray(manifest?.models) ? manifest.models : []
  const picked = args.only ? all.filter((m) => m.id === args.only) : all
  if (!picked.length) throw new Error(args.only ? `В манифесте нет записи «${args.only}»` : 'Манифест пуст')
  return picked.map((m) => ({ ...m, target: resolveInside(root, args.target && picked.length === 1 ? args.target : m.target) }))
}

/** Путь назначения — только внутри папки проекта (никаких ../ и абсолютных путей наружу) */
export function resolveInside(root, rel) {
  const abs = path.resolve(root, rel)
  const base = path.resolve(root)
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`Путь вне папки проекта: ${rel}`)
  return abs
}

/**
 * Скачивает url в dest. fetchFn подменяется в тестах.
 * Возвращает { bytes, sha256 }. Бросает Error с понятным текстом.
 */
export async function download(url, dest, { fetchFn = fetch, expectSha256 = null, maxBytes = MAX_BYTES, onProgress } = {}) {
  if (!/^https:\/\//i.test(url)) throw new Error('Разрешены только ссылки https://')
  const res = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Сервер ответил HTTP ${res.status}`)
  if (!res.body) throw new Error('Пустой ответ сервера')
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error(`Файл слишком большой (${(declared / 1048576).toFixed(0)} МБ)`)

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const hash = crypto.createHash('sha256')
  let bytes = 0
  let head = Buffer.alloc(0)
  try {
    const counter = async function* (src) {
      for await (const chunk of src) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new Error('Файл больше допустимого размера')
        if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4)
        hash.update(chunk)
        onProgress?.(bytes, declared)
        yield chunk
      }
    }
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part))
    if (/\.vrma?$/i.test(dest) && head.toString('latin1') !== 'glTF') {
      throw new Error('Скачанный файл — не VRM/VRMA (возможно, ссылка ведёт на страницу, а не на файл)')
    }
    const sha256 = hash.digest('hex')
    if (expectSha256 && sha256 !== String(expectSha256).toLowerCase()) throw new Error('Контрольная сумма не совпала — файл не сохранён')
    fs.renameSync(part, dest)
    return { bytes, sha256 }
  } catch (e) {
    try { fs.rmSync(part, { force: true }) } catch { /* ignore */ }
    throw e
  }
}

const HELP = `Скачивание VRM-модели
  npm run models:download                    рекомендованный образец → public/models/default.vrm
  npm run models:download -- --list          показать список
  npm run models:download -- --only <id>     только одна запись
  npm run models:download -- --force         перезаписать существующий файл
  npm run models:download -- --url https://… --target public/models/aria.vrm   своя ссылка`

async function main() {
  const root = path.resolve(HERE, '..')
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message + '\n\n' + HELP); process.exit(2) }
  if (args.help) { console.log(HELP); return }

  let manifest = { models: [] }
  try { manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'models.json'), 'utf8')) } catch { /* без манифеста работает только --url */ }

  if (args.list) {
    for (const m of manifest.models ?? []) console.log(`${m.id}\t${m.target}\t${m.verified ? '' : '(адрес не проверен)'}\t${m.title}`)
    return
  }

  let plan
  try { plan = planDownloads(manifest, args, root) } catch (e) { console.error('Ошибка: ' + e.message); process.exit(2) }

  let failed = 0
  for (const m of plan) {
    const rel = path.relative(root, m.target)
    if (fs.existsSync(m.target) && !args.force) { console.log(`✓ ${rel} уже есть (--force — перезаписать)`); continue }
    console.log(`\n${m.title}\n  ${m.url}\n  → ${rel}`)
    if (m.license) console.log(`  Лицензия: ${m.license}${m.licenseUrl ? ' ' + m.licenseUrl : ''}`)
    if (!m.verified) console.log('  ⚠ Адрес не проверялся автором проекта — если скачивание не удалось, возьми модель вручную.')
    try {
      let last = 0
      const r = await download(m.url, m.target, {
        expectSha256: m.sha256,
        onProgress: (b) => { if (b - last > 2 * 1048576) { process.stdout.write(`\r  ${(b / 1048576).toFixed(0)} МБ…`); last = b } },
      })
      console.log(`\r  Готово: ${(r.bytes / 1048576).toFixed(1)} МБ, sha256 ${r.sha256}`)
      if (!m.sha256) console.log('  (sha256 в манифесте не задан — можно прописать его в scripts/models.json, чтобы файл нельзя было подменить)')
    } catch (e) {
      failed++
      console.error(`\r  ✗ Не удалось: ${e.message}`)
    }
  }
  if (failed) {
    console.error('\nСкачай .vrm вручную (VRoid Hub, Booth, своя модель) и положи в public/models/default.vrm — см. public/models/README.md')
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
