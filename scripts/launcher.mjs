#!/usr/bin/env node
// scripts/launcher.mjs — запуск NEKO / ARIA одним действием (двойной клик по NEKO.bat / ARIA.bat, либо npm run start:neko).
//
//   1. нет node_modules → npm install (только в первый раз);
//   2. исходники новее сборки (или сборки нет) → vite build + tsc для главного процесса;
//   3. запускает Electron с собранной версией (флаг --prod) и сразу завершается — консоль закрывается.
//
// Данные приложения лежат там же, где при npm run dev:*, но НАСТРОЙКИ окон хранятся отдельно (другой адрес страницы:
// app:// вместо localhost:5173), поэтому при первом запуске лаунчера настройки будут пустыми — это нормально.

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const STAMP = path.join('dist', '.build-stamp')
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'out', 'docs', '.github', '.vscode'])
/** Что влияет на сборку: если что-то из этого изменилось после последней сборки — пересобираем */
const WATCH = ['src', 'electron', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.electron.json', 'package.json']

/** Самое позднее время изменения файла внутри пути (мс); 0 — путь не существует */
export function newestMtime(target, skip = SKIP) {
  let st
  try { st = fs.statSync(target) } catch { return 0 }
  if (!st.isDirectory()) return st.mtimeMs
  let newest = st.mtimeMs
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (skip.has(e.name)) continue
    newest = Math.max(newest, newestMtime(path.join(target, e.name), skip))
  }
  return newest
}

/** Нужна ли сборка: нет результата сборки, нет отметки, либо исходники новее отметки */
export function needsBuild(root) {
  const must = ['dist/src/neko/index.html', 'dist/src/aria/index.html', 'dist-electron/main.js', 'dist-electron/preload.js']
  if (must.some((f) => !fs.existsSync(path.join(root, f)))) return true
  let stamp = 0
  try { stamp = fs.statSync(path.join(root, STAMP)).mtimeMs } catch { return true }
  return WATCH.some((w) => newestMtime(path.join(root, w)) > stamp + 1)
}

export function parseArgs(argv) {
  const persona = argv.find((a) => a === 'neko' || a === 'aria') ?? 'neko'
  return { persona, rebuild: argv.includes('--rebuild'), noLaunch: argv.includes('--no-launch') }
}

function run(label, cmd, args, cwd) {
  console.log(`\n▶ ${label}`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
  if (r.error || r.status !== 0) throw new Error(`${label}: не получилось${r.error ? ` (${r.error.message})` : ` (код ${r.status})`}`)
}

/** npm надо запускать как npm.cmd на Windows; через shell:false, чтобы пути с пробелами («F:\NEKO AI») не ломались */
const npmCmd = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm')

function main() {
  const root = path.resolve(HERE, '..')
  const { persona, rebuild, noLaunch } = parseArgs(process.argv.slice(2))
  const major = Number(process.versions.node.split('.')[0])
  if (major < 18) throw new Error(`Нужен Node.js 18 или новее, а установлен ${process.versions.node}. Скачай LTS с https://nodejs.org`)

  if (!fs.existsSync(path.join(root, 'node_modules', 'electron'))) {
    console.log('Первый запуск: устанавливаю зависимости (несколько минут, нужен интернет)…')
    run('npm install', npmCmd(), ['install'], root)
  }

  if (rebuild || needsBuild(root)) {
    console.log('Собираю приложение (в первый раз и после обновления кода — до минуты)…')
    run('vite build', process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], root)
    run('tsc (главный процесс)', process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.electron.json'], root)
    fs.writeFileSync(path.join(root, STAMP), String(Date.now()))
  }

  if (noLaunch) return
  const electronPath = createRequire(path.join(root, 'package.json'))('electron')
  if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
    throw new Error('Electron не установлен до конца. Удали папку node_modules и запусти ещё раз.')
  }
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // его ставит, например, терминал VS Code; из-за него Electron запускается как обычный Node
  const child = spawn(electronPath, [root, '--prod', `--persona=${persona}`], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', (e) => { console.error('Не удалось запустить Electron:', e.message); process.exit(1) })
  child.unref()
  console.log(`✓ ${persona === 'aria' ? 'ARIA' : 'NEKO'} запущена.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (e) {
    console.error('\n✗ ' + (e instanceof Error ? e.message : String(e)))
    console.error('Если не получается — открой issue на GitHub и приложи этот текст.')
    process.exit(1)
  }
}
