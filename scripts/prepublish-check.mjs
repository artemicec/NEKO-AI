#!/usr/bin/env node
// prepublish-ignore — в этом файле перечислены шаблоны секретов, поэтому он сам не проверяется на содержимое.
//
// Проверка перед публикацией на GitHub:  npm run check:publish   (или: node scripts/prepublish-check.mjs [папка])
// Ищет то, что нельзя выкладывать: API-ключи, личные данные и пути, файлы данных приложения, VRM-модели, слишком большие файлы,
// а также проверяет, что на месте LICENSE, README и остальные обязательные файлы.
// Секреты в отчёте НЕ печатаются — только маска (первые и последние символы).
// Код выхода: 0 — всё чисто (возможны предупреждения), 1 — есть ошибки.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_FILE_BYTES = 5 * 1024 * 1024
const IGNORE_MARKER = 'prepublish-ignore'

/** Шаблоны секретов: [название, регулярное выражение] */
export const SECRET_PATTERNS = [
  ['ключ Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['ключ OpenAI/совместимый (sk-…)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['ключ Google (AIza…)', /AIza[0-9A-Za-z_-]{30,}/],
  ['ключ Groq (gsk_…)', /\bgsk_[A-Za-z0-9]{20,}/],
  ['токен GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['токен GitHub (github_pat_…)', /github_pat_[A-Za-z0-9_]{30,}/],
  ['токен Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['закрытый ключ (PEM)', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['заголовок Bearer с токеном', /Bearer\s+[A-Za-z0-9._~+/-]{24,}/],
  ['заголовок xi-api-key со значением', /xi-api-key['"]?\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/i],
  ['поле apiKey с непустым значением', /"(?:api[_-]?key|apiKey|elevenlabsApiKey|cartesiaApiKey)"\s*:\s*"[^"\s]{8,}"/i],
  ['переменная *_API_KEY со значением', /\b[A-Z][A-Z0-9_]*API_KEY\s*=\s*['"]?[A-Za-z0-9._~+/-]{8,}/],
]

/** Личные данные: пути с именем пользователя, e-mail */
const PERSONAL_PATTERNS = [
  ['личный путь Windows (C:\\Users\\<имя>)', /[A-Za-z]:\\+Users\\+(?![<%.{$])[^\\\s"'`]{2,}/],
  ['личный путь Linux/macOS (/home/<имя>, /Users/<имя>)', /(?:^|[\s"'`(=])\/(?:home|Users)\/(?![<{$.])[a-z][\w.-]{1,}\//],
  ['путь к локальному проекту (F:\\NEKO_AI)', /F:\\+NEKO_AI/i],
]
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const EMAIL_OK = /^(?:noreply@|no-reply@|.*@example\.(?:com|org|net)$|.*@users\.noreply\.github\.com$)/i

/** Файлы, которых не должно быть в публикации (пути с «/», от корня) */
const FORBIDDEN = [
  [/\.vrma?$/i, 'VRM-модель или анимация — у модели свой автор и лицензия'],
  [/\.jsonl$/i, 'файл данных (история переписки)'],
  [/(^|\/)\.env(\..+)?$/i, 'файл переменных окружения (.env)', (p) => !/\.example$/i.test(p)],
  [/\.(pem|key|p12|pfx)$/i, 'ключ или сертификат'],
  [/^(userData|memory|diary)\//i, 'папка данных приложения'],
  [/(^|\/)(settings[^/]*|reminders|app-prefs|window-state[^/]*)\.json$/i, 'файл настроек/состояния пользователя'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/^(dist|dist-electron|release)\//, 'результат сборки'],
  [/\.(zip|7z|rar)$/i, 'архив'],
]

const REQUIRED = ['LICENSE', 'README.md', 'SETUP.md', '.gitignore', 'CONTRIBUTING.md', 'PRIVACY.md', 'package.json']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'out'])
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|icns|bmp|svgz|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf|zip|7z|rar|gz|vrm|vrma|glb|gltf|bin|pdf|exe|dll)$/i

/** Маска секрета: первые 4 и последние 4 символа */
export const mask = (s) => (s.length <= 10 ? '…' : `${s.slice(0, 4)}…${s.slice(-4)}`)

/* ───────────── минимальный разбор .gitignore (когда git недоступен) ───────────── */
function globToRegex(glob) {
  let g = glob
  const anchored = g.startsWith('/') || g.slice(0, -1).includes('/')
  g = g.replace(/^\//, '')
  const dirOnly = g.endsWith('/')
  g = g.replace(/\/$/, '')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++ } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${re}${dirOnly ? '/' : '(?:/|$)'}`)
}
export function parseGitignore(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const neg = l.startsWith('!')
    return { neg, re: globToRegex(neg ? l.slice(1) : l) }
  })
}
export function isIgnored(rules, rel) {
  let ignored = false
  for (const r of rules) {
    // каталог совпадает по префиксу пути: проверяем и сам путь, и «путь/»
    if (r.re.test(rel) || r.re.test(rel + '/')) ignored = !r.neg
  }
  return ignored
}

/** Список файлов к публикации: через git, если он есть, иначе обход папки с учётом .gitignore */
export function listFiles(root) {
  if (fs.existsSync(path.join(root, '.git'))) {
    const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status === 0) return { files: r.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f))), via: 'git' }
  }
  const giPath = path.join(root, '.gitignore')
  const rules = fs.existsSync(giPath) ? parseGitignore(fs.readFileSync(giPath, 'utf8')) : []
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || isIgnored(rules, rel + '/')) continue
        walk(abs)
      } else if (e.isFile() && !isIgnored(rules, rel)) out.push(rel)
    }
  }
  walk(root)
  return { files: out, via: 'обход папки (по .gitignore)' }
}

/** Главная проверка. Возвращает { errors, warnings, ok, checked, via } — печатью занимается main() */
export function check(root) {
  const errors = []
  const warnings = []
  const oks = []
  const { files, via } = listFiles(root)
  const set = new Set(files)

  // 1. запрещённые файлы и размер
  for (const rel of files) {
    for (const [re, why, extra] of FORBIDDEN) {
      if (re.test(rel) && (!extra || extra(rel))) errors.push({ file: rel, msg: `не должно быть в репозитории: ${why}` })
    }
    let size = 0
    try { size = fs.statSync(path.join(root, rel)).size } catch { continue }
    if (size > MAX_FILE_BYTES) errors.push({ file: rel, msg: `файл больше ${MAX_FILE_BYTES / 1024 / 1024} МБ (${(size / 1024 / 1024).toFixed(1)} МБ)` })
  }

  // 2. содержимое: секреты, личные данные
  for (const rel of files) {
    if (BINARY_EXT.test(rel)) continue
    const abs = path.join(root, rel)
    let text
    try {
      if (fs.statSync(abs).size > MAX_TEXT_BYTES) continue
      text = fs.readFileSync(abs, 'utf8')
    } catch { continue }
    if (text.split(/\r?\n/, 5).some((l) => l.includes(IGNORE_MARKER))) continue
    const isLock = /(^|\/)package-lock\.json$/.test(rel)
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.length > 4000) line = line.slice(0, 4000)
      for (const [name, re] of SECRET_PATTERNS) {
        const m = re.exec(line)
        if (m) errors.push({ file: rel, line: i + 1, msg: `похоже на секрет: ${name} (${mask(m[0])})` })
      }
      if (isLock) return
      for (const [name, re] of PERSONAL_PATTERNS) {
        const m = re.exec(line)
        if (m) warnings.push({ file: rel, line: i + 1, msg: `личные данные: ${name}` })
      }
      for (const m of line.matchAll(EMAIL)) {
        if (!EMAIL_OK.test(m[0]) && !/^@/.test(m[0])) warnings.push({ file: rel, line: i + 1, msg: `адрес электронной почты (${mask(m[0])}) — точно хочешь опубликовать?` })
      }
    })
  }

  // 3. обязательные файлы
  for (const f of REQUIRED) if (!set.has(f) && !fs.existsSync(path.join(root, f))) errors.push({ file: f, msg: 'обязательный файл отсутствует' })

  // 4. package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    for (const dep of ['pixi.js', 'axios']) {
      if (pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]) warnings.push({ file: 'package.json', msg: `неиспользуемая зависимость «${dep}»` })
    }
    if ('allowScripts' in pkg) warnings.push({ file: 'package.json', msg: 'нестандартное поле allowScripts — лучше удалить' })
    if (!pkg.license) warnings.push({ file: 'package.json', msg: 'не указана лицензия (license)' })
  } catch { /* package.json нет или битый — выше уже есть ошибка/предупреждение */ }

  // 5. LICENSE и README
  try {
    if (/<YOUR NAME>/.test(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'))) {
      warnings.push({ file: 'LICENSE', msg: 'замени <YOUR NAME> на своё имя или ник — без этого лицензия неполная' })
    }
  } catch { /* LICENSE нет — ошибка выше */ }
  try {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
    const pics = [...new Set([...readme.matchAll(/\(?((?:\.\/)?docs\/screenshots\/[\w.-]+\.(?:png|jpe?g|gif|webp))\)?/g)].map((m) => m[1].replace(/^\.\//, '')))]
    const missing = pics.filter((p) => !fs.existsSync(path.join(root, p)))
    if (missing.length) warnings.push({ file: 'README.md', msg: `нет скриншотов, на которые ссылается README: ${missing.join(', ')} (см. docs/screenshots/README.md)` })
    else if (pics.length) oks.push(`скриншоты на месте (${pics.length})`)
  } catch { /* README нет — ошибка выше */ }

  if (!errors.length) oks.unshift('секретов и запрещённых файлов не найдено')
  return { errors, warnings, oks, checked: files.length, via }
}

function main() {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
  const r = check(root)
  const fmt = (x) => `${x.file}${x.line ? ':' + x.line : ''} — ${x.msg}`
  console.log(`Проверка перед публикацией: ${root}`)
  console.log(`Проверено файлов: ${r.checked} (список файлов: ${r.via})\n`)
  for (const x of r.errors) console.log('  ОШИБКА   ' + fmt(x))
  for (const x of r.warnings) console.log('  ВНИМАНИЕ ' + fmt(x))
  for (const x of r.oks) console.log('  OK       ' + x)
  console.log(`\nИтого: ошибок ${r.errors.length}, предупреждений ${r.warnings.length}.`)
  if (r.errors.length) console.log('Исправь ошибки ДО публикации. Если ключ уже мог попасть в Git — отзови его у провайдера и создай новый.')
  process.exit(r.errors.length ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
