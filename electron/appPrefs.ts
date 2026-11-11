// electron/appPrefs.ts
//
// Настройки, которые главному процессу нужны ДО запуска окон (трей, «закрывать в трей»): userData/app-prefs.json.
// Остальные настройки живут в localStorage окон; эти два окно присылает сюда при запуске и при изменении.

import fs from 'fs'
import path from 'path'

export interface AppPrefs {
  /** Значок в трее */
  trayEnabled: boolean
  /** Закрытие окна сворачивает приложение в трей, а не завершает его (работает только вместе с трейем) */
  closeToTray: boolean
}

export const DEFAULT_PREFS: AppPrefs = { trayEnabled: true, closeToTray: true }

export function sanitizePrefs(raw: unknown, fallback: AppPrefs = DEFAULT_PREFS): AppPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    trayEnabled: typeof r.trayEnabled === 'boolean' ? r.trayEnabled : fallback.trayEnabled,
    closeToTray: typeof r.closeToTray === 'boolean' ? r.closeToTray : fallback.closeToTray,
  }
}

export function loadPrefs(file: string): AppPrefs {
  try { return sanitizePrefs(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { return { ...DEFAULT_PREFS } }
}

/** Пишет только если что-то изменилось; возвращает true, если файл обновлён */
export function savePrefs(file: string, prefs: AppPrefs, previous?: AppPrefs): boolean {
  if (previous && previous.trayEnabled === prefs.trayEnabled && previous.closeToTray === prefs.closeToTray) return false
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(prefs), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

/** Закрытие окна должно спрятать приложение в трей, а не выйти? */
export const shouldHideOnClose = (prefs: AppPrefs, trayAlive: boolean, quitting: boolean): boolean =>
  !quitting && prefs.closeToTray && trayAlive
