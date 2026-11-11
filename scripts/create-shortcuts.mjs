#!/usr/bin/env node
// scripts/create-shortcuts.mjs — ярлыки «NEKO» и «ARIA» на рабочем столе Windows (npm run shortcuts).
// Ярлык запускает NEKO.bat / ARIA.bat, поэтому приложение стартует двойным кликом, а после обновления кода пересобирается само.
// Ярлык можно закрепить на панели задач или перетащить в автозагрузку (Win+R → shell:startup).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Контейнер .ico с одним PNG внутри (Windows читает PNG в .ico с Vista). Размер — до 256 px; больше — null */
export function pngToIco(png) {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return null
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  if (!w || !h || w > 256 || h > 256 || w !== h) return null
  const head = Buffer.alloc(22)
  head.writeUInt16LE(0, 0) // reserved
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(1, 4) // count
  head[6] = w === 256 ? 0 : w
  head[7] = h === 256 ? 0 : h
  head.writeUInt16LE(1, 10) // planes
  head.writeUInt16LE(32, 12) // bpp
  head.writeUInt32LE(png.length, 14)
  head.writeUInt32LE(22, 18) // смещение данных
  return Buffer.concat([head, png])
}

/** Значок для ярлыка: public/icons/<persona>.png → .ico в папке данных проекта; нет такого — значок electron.exe */
function iconFor(root, persona) {
  const png = path.join(root, 'public', 'icons', `${persona}.png`)
  try {
    const ico = pngToIco(fs.readFileSync(png))
    if (ico) {
      const out = path.join(root, 'node_modules', '.cache', 'neko-icons')
      fs.mkdirSync(out, { recursive: true })
      const file = path.join(out, `${persona}.ico`)
      fs.writeFileSync(file, ico)
      return file
    }
  } catch { /* нет картинки — запасной вариант ниже */ }
  return path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
}

function main() {
  if (process.platform !== 'win32') {
    console.log('Ярлыки на рабочем столе создаются только в Windows. На других системах: npm run start:neko / npm run start:aria.')
    return
  }
  const root = path.resolve(HERE, '..')
  // значения передаём через переменные окружения: пути с пробелами и кириллицей не ломают командную строку PowerShell
  const ps = `
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
foreach ($p in @('NEKO','ARIA')) {
  $lnk = $sh.CreateShortcut((Join-Path $desktop ($p + '.lnk')))
  $lnk.TargetPath = (Join-Path $env:NEKO_ROOT ($p + '.bat'))
  $lnk.WorkingDirectory = $env:NEKO_ROOT
  $lnk.IconLocation = [Environment]::GetEnvironmentVariable('NEKO_ICON_' + $p)
  $lnk.Description = $p
  $lnk.Save()
  Write-Output ('Создан ярлык: ' + (Join-Path $desktop ($p + '.lnk')))
}`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'inherit',
    env: { ...process.env, NEKO_ROOT: root, NEKO_ICON_NEKO: iconFor(root, 'neko'), NEKO_ICON_ARIA: iconFor(root, 'aria') },
  })
  if (r.status !== 0) { console.error('Не получилось создать ярлыки. Можно просто перетащить NEKO.bat и ARIA.bat на рабочий стол с зажатым Alt.'); process.exit(1) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
