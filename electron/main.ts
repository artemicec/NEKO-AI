// electron/main.ts
//
// Что изменено:
//  • production-страницы грузятся через собственный протокол app:// (file:// ломал абсолютные пути
//    /assets/..., /models/default.vrm и fetch локальных файлов);
//  • безопасность: sandbox, проверка источника IPC, внешние ссылки — только в браузере, CORS-заплатка
//    ограничена локальными сервисами и известными облачными API (electron/cors.ts);
//  • реальное хранилище истории чата (memoryService) и дневника (diaryStore);
//  • окно дневника, рассылка событий между окнами, запоминание позиции/размера окон;
//  • IPC net:fetchText — для новостей (RSS без CORS) и плагина «Интернет» (Википедия, DuckDuckGo).

import { app, BrowserWindow, ipcMain, net, protocol, screen, session, shell } from 'electron'
import { installCorsFix, type CorsPolicy } from './cors'
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent, Rectangle } from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { MemoryService } from './memoryService'
import { DiaryStore } from './diaryStore'
import { exportDiary } from './diaryExportRun'
import { ReminderService } from './reminders'
import { loadPrefs, sanitizePrefs, savePrefs, shouldHideOnClose, type AppPrefs } from './appPrefs'
import { TrayController } from './tray'
import { downloadModelFile, looksLikeGlb, modelFileName, modelsDir, parseManifest, userAssetPath } from './modelFiles'

// Кого запускаем: --persona=aria, переменная NEKO_PERSONA или имя exe (собранный `npm run build:aria` даёт ARIA.exe)
const persona: 'neko' | 'aria' =
  (process.argv.find((a) => a.startsWith('--persona='))?.split('=')[1] ||
    process.env.NEKO_PERSONA ||
    (/^aria/i.test(path.basename(process.execPath)) ? 'aria' : 'neko')) === 'aria'
    ? 'aria'
    : 'neko'

// «Разработка» = Vite на :5173. Лаунчер (NEKO.bat / ARIA.bat) запускает собранную версию из dist/ с флагом --prod
const isDev = !app.isPackaged && !process.argv.includes('--prod')
const DEV_ORIGIN = 'http://localhost:5173'
const PROD_ORIGIN = 'app://bundle'

app.setAppUserModelId(persona === 'aria' ? 'com.neko.aria' : 'com.neko.neko')

// Схемы должны быть зарегистрированы ДО app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'neko-diary', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// В упакованном виде запускаем только один экземпляр (иначе два планировщика дневника пишут дубли)
const gotLock = isDev || app.requestSingleInstanceLock()
if (!gotLock) app.quit()

/* ───────────────────────── URL и безопасность ───────────────────────── */

function pageURL(win: 'neko' | 'aria', params = ''): string {
  const q = params ? `?${params}` : ''
  return `${isDev ? DEV_ORIGIN : PROD_ORIGIN}/src/${win}/index.html${q}`
}

const isOwnUrl = (url: string) => url.startsWith(DEV_ORIGIN) || url.startsWith(PROD_ORIGIN)

const isHttp = (url: string) => /^https?:\/\//i.test(url)

/** IPC принимаем только от наших страниц */
function handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (e, ...args) => {
    const url = e.senderFrame?.url ?? e.sender.getURL()
    if (!isOwnUrl(url)) throw new Error(`IPC ${channel}: недоверенный источник`)
    return fn(e, ...args)
  })
}

function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) {
      event.preventDefault()
      if (isHttp(url)) shell.openExternal(url)
    }
  })
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
  // озвучка стартует после ответа, а не по клику — разрешаем воспроизведение без жеста
  autoplayPolicy: 'no-user-gesture-required' as const,
  // окно чата может оказаться под другими окнами, пока NEKO говорит: без этого таймеры замедляются до 1 Гц,
  // и рот аватара (кадры липсинка идут по таймеру) замирает
  backgroundThrottling: false,
}

/* ───────────────────────── Запоминание позиции окон ───────────────────────── */

type SavedBounds = Partial<Rectangle>
const statePath = () => path.join(app.getPath('userData'), 'window-state.json')

function readState(): Record<string, SavedBounds> {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) } catch { return {} }
}

function writeState(name: string, bounds: Rectangle) {
  try {
    const all = readState()
    all[name] = bounds
    fs.writeFileSync(statePath(), JSON.stringify(all))
  } catch { /* не критично */ }
}

function restoreBounds(name: string, defaults: Rectangle): Partial<Rectangle> {
  const saved = readState()[name]
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every((n) => typeof n === 'number')) return {}
  const rect = saved as Rectangle
  // позицию восстанавливаем, только если окно попадает на какой-либо из мониторов (монитор мог быть отключён)
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return rect.x < a.x + a.width - 40 && rect.x + rect.width > a.x + 40 && rect.y < a.y + a.height - 40 && rect.y + 40 > a.y
  })
  if (!visible) return {}
  return { x: rect.x, y: rect.y, width: rect.width || defaults.width, height: rect.height || defaults.height }
}

function trackBounds(win: BrowserWindow, name: string) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) writeState(name, win.getBounds())
    }, 400)
  }
  win.on('move', save)
  win.on('resize', save)
}

/* ───────────────────────── Окна ───────────────────────── */

let mainWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let diaryWindow: BrowserWindow | null = null
let reminderWindow: BrowserWindow | null = null

// Трей и «закрывать в трей»: пока значок жив, закрытие окна прячет приложение, а не завершает (напоминания и дневник продолжают работать)
let prefs: AppPrefs = { trayEnabled: true, closeToTray: true }
let tray: TrayController | null = null
let isQuitting = false
let trayHintShown = false
const prefsPath = () => path.join(app.getPath('userData'), 'app-prefs.json')
const ICON_DIRS = () => [path.join(__dirname, '../public/icons'), path.join(__dirname, '../dist/icons')]
/** Значок окон: public/icons/<persona>.png (при запуске из исходников) или dist/icons (в установленном приложении). Нет файла — значок по умолчанию */
const windowIcon = (): string | undefined => ICON_DIRS().map((d) => path.join(d, `${persona}.png`)).find((f) => fs.existsSync(f))
const hidesToTray = () => shouldHideOnClose(prefs, !!tray?.alive, isQuitting)

function createWindow(
  name: string,
  opts: BrowserWindowConstructorOptions,
  url: string,
  remember = true,
  /** Показать, не забирая фокус (напоминание не должно перехватывать ввод) */
  inactive = false
): BrowserWindow {
  const defaults = { x: 0, y: 0, width: opts.width ?? 400, height: opts.height ?? 560 }
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    icon: windowIcon(), // значок в панели задач: без него при запуске через NEKO.bat там был бы значок Electron
    ...opts,
    ...(remember ? restoreBounds(name, defaults) : {}),
    webPreferences,
  })
  hardenWindow(win)
  win.once('ready-to-show', () => (inactive ? win.showInactive() : win.show()))
  if (remember) trackBounds(win, name)
  win.loadURL(url)
  return win
}

function createMainWindow() {
  const isAria = persona === 'aria'
  mainWindow = createWindow(
    'main-' + persona,
    {
      width: isAria ? 900 : 240,
      height: isAria ? 640 : 400,
      minWidth: isAria ? 600 : 200,
      minHeight: isAria ? 400 : 320,
      maxWidth: isAria ? 1600 : 500,
      maxHeight: isAria ? 1000 : 900,
      resizable: true,
      maximizable: isAria,
      alwaysOnTop: !isAria,
    },
    pageURL(persona)
  )
  mainWindow.on('closed', () => { mainWindow = null })
  // ✕ / Alt+F4 при включённом трее прячут приложение; настоящий выход — «Выход» в меню значка
  mainWindow.on('close', (e) => {
    if (hidesToTray()) { e.preventDefault(); hideToTray() }
  })
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Прячет все окна, кроме окна-напоминания: оно должно оставаться видимым */
function hideToTray() {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== reminderWindow) w.hide()
  if (!trayHintShown) {
    trayHintShown = true
    tray?.hint(persona === 'aria' ? 'ARIA' : 'NEKO', 'Приложение работает в трее. Значок → «Выход», чтобы закрыть совсем.')
  }
}

function quitApp() {
  isQuitting = true
  app.quit()
}

function ensureTray() {
  if (tray?.alive) return
  tray = new TrayController(
    persona,
    { openMain: showMain, openChat: () => createChatWindow(), openDiary: () => createDiaryWindow(), openSettings: () => createSettingsWindow(), quit: quitApp },
    () => { if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) hideToTray(); else showMain() },
    ICON_DIRS()
  )
  if (!tray.create()) tray = null // значок не получился — приложение работает как раньше, закрытие = выход
}

function applyPrefs(next: AppPrefs) {
  savePrefs(prefsPath(), next, prefs)
  prefs = next
  if (prefs.trayEnabled) ensureTray()
  else if (tray) {
    tray.destroy()
    tray = null
    showMain() // без значка спрятанное приложение было бы не вернуть
  }
}

/** Окно-напоминание: внизу справа, поверх всех, без кражи фокуса. Список сработавших берёт само через IPC */
function showReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) { reminderWindow.showInactive(); return }
  const wa = screen.getPrimaryDisplay().workArea
  const width = 340
  const height = 270
  reminderWindow = createWindow(
    'reminder',
    {
      width, height, minWidth: 300, minHeight: 160,
      x: wa.x + wa.width - width - 16, y: wa.y + wa.height - height - 16,
      resizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: true,
    },
    pageURL('neko', `window=reminder&persona=${persona}`),
    false,
    true
  )
  reminderWindow.on('closed', () => { reminderWindow = null })
}

function openSingleton(
  current: BrowserWindow | null,
  make: () => BrowserWindow
): BrowserWindow {
  if (current && !current.isDestroyed()) {
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
    return current
  }
  return make()
}

function createChatWindow() {
  chatWindow = openSingleton(chatWindow, () => {
    const w = createWindow(
      'chat',
      { width: 360, height: 560, minWidth: 280, minHeight: 400, resizable: true, maximizable: false, alwaysOnTop: true },
      pageURL('neko', 'window=chat')
    )
    w.on('closed', () => { chatWindow = null })
    return w
  })
}

/** Страницы окна настроек, которые можно открыть сразу (список — в src/shared/components/settings/pages.ts) */
const SETTINGS_PAGE_IDS = new Set(['movement', 'voice', 'diary', 'images', 'internet', 'ui', 'system', 'setup'])

function createSettingsWindow(page?: string) {
  const goto = page && SETTINGS_PAGE_IDS.has(page) ? page : undefined
  const existing = settingsWindow && !settingsWindow.isDestroyed()
  if (existing && goto) settingsWindow!.webContents.send('settings:goto', goto)
  settingsWindow = openSingleton(settingsWindow, () => {
    const w = createWindow(
      'settings',
      { width: 400, height: 560, minWidth: 340, minHeight: 420, resizable: true, maximizable: false, alwaysOnTop: true },
      pageURL('neko', `window=settings&persona=${persona}${goto ? `&page=${goto}` : ''}`)
    )
    w.on('closed', () => { settingsWindow = null })
    return w
  })
}

function createDiaryWindow() {
  diaryWindow = openSingleton(diaryWindow, () => {
    const w = createWindow(
      'diary',
      { width: 1000, height: 700, minWidth: 760, minHeight: 520, resizable: true, maximizable: true, alwaysOnTop: false },
      pageURL('neko', 'window=diary')
    )
    w.on('closed', () => { diaryWindow = null })
    return w
  })
}

/** Рассылка события во все окна */
function broadcast(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/* ───────────────────────── Модели аватара ───────────────────────── */

let modelDownloading = false

/** Образец VRM из scripts/models.json → в папку моделей. Ответ — всегда обычный объект (ошибки не бросаем: окно покажет текст) */
async function downloadSampleModel(sender: IpcMainInvokeEvent['sender'], urlPath: unknown) {
  const name = modelFileName(urlPath)
  if (!name) return { ok: false, error: 'Путь модели в настройках нестандартный — положи файл вручную (см. SETUP.md).' }
  if (modelDownloading) return { ok: false, error: 'Скачивание уже идёт.' }
  let model
  try {
    model = parseManifest(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'scripts', 'models.json'), 'utf8')))[0]
  } catch { /* нет манифеста — ниже понятная ошибка */ }
  if (!model) return { ok: false, error: 'Не найден список моделей (scripts/models.json). Положи .vrm вручную.' }

  const dir = modelsDir(isDev, app.getAppPath(), app.getPath('userData'))
  const dest = path.join(dir, name)
  const info = { license: model.license, licenseUrl: model.licenseUrl, verified: model.verified, dir }
  if (fs.existsSync(dest) && looksLikeGlb(dest)) return { ok: false, error: `Модель уже есть: ${dest}`, ...info }

  modelDownloading = true
  let lastSent = 0
  try {
    const r = await downloadModelFile(model.url, dest, {
      fetchFn: (u, init) => net.fetch(u, init) as never,
      expectSha256: model.sha256,
      onProgress: (received, total) => {
        const now = Date.now()
        if (now - lastSent < 250 || sender.isDestroyed()) return
        lastSent = now
        sender.send('models:progress', { received, total })
      },
    })
    broadcast('models:changed') // окна с аватаром перечитают модель сами
    return { ok: true, bytes: r.bytes, path: dest, ...info }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ...info }
  } finally {
    modelDownloading = false
  }
}

/* ───────────────────────── Сеть ───────────────────────── */

/** CORS-заплатка для локальных сервисов и известных облачных API (список хостов — в ./cors) */
let cors: CorsPolicy

/**
 * Хосты, с которых главный процесс согласен забирать текст по просьбе страницы.
 * Новости — Google News (RSS); плагин «Интернет» — Википедия (официальный API) и DuckDuckGo (HTML-выдача).
 */
const FETCH_TEXT_HOSTS = new Set(['news.google.com', 'ru.wikipedia.org', 'en.wikipedia.org', 'html.duckduckgo.com'])

/** Википедия просит представляться осмысленным User-Agent; DuckDuckGo отдаёт выдачу только «браузеру» */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const userAgentFor = (host: string) =>
  host.endsWith('wikipedia.org')
    ? 'NEKO-desktop-companion/2.4 (personal desktop assistant; Electron)'
    : host === 'html.duckduckgo.com'
      ? BROWSER_UA
      : 'Mozilla/5.0 (NEKO desktop companion)'

async function fetchText(rawUrl: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  let url: URL
  try { url = new URL(rawUrl) } catch { return { ok: false, error: 'bad url' } }
  if (url.protocol !== 'https:' || !FETCH_TEXT_HOSTS.has(url.hostname)) return { ok: false, error: 'host not allowed' }
  try {
    const res = await net.fetch(url.toString(), {
      headers: { 'User-Agent': userAgentFor(url.hostname), 'Accept-Language': 'ru,en;q=0.7' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const text = await res.text()
    return { ok: true, text: text.slice(0, 2_000_000) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* ───────────────────────── Хранилища ───────────────────────── */

let memory: MemoryService
let diary: DiaryStore
let reminders: ReminderService
let diaryStatus: { state: string; message?: string } = { state: 'idle' }

/* ───────────────────────── Запуск ───────────────────────── */

app.whenReady().then(() => {
  // второй экземпляр уже завершается: ему нельзя ни открывать окна, ни читать напоминания (они сработали бы дважды)
  if (!gotLock) return
  const userData = app.getPath('userData')
  memory = new MemoryService(path.join(userData, 'memory', persona))
  diary = new DiaryStore(path.join(userData, 'diary'))
  prefs = loadPrefs(prefsPath())
  reminders = new ReminderService(path.join(userData, 'reminders.json'), {
    onFire: () => showReminderWindow(),
    onChange: () => broadcast('reminders:changed'),
  })

  // app://bundle/<путь> → dist/<путь>; модели и анимации пользователя (userData/models, userData/animations) — раньше встроенных
  protocol.handle('app', (request) => {
    const root = path.join(__dirname, '../dist')
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
    const own = userAssetPath(app.getPath('userData'), rel)
    if (own && fs.existsSync(own)) return net.fetch(pathToFileURL(own).toString())
    const file = path.normalize(path.join(root, rel))
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // neko-diary://img/<файл> → userData/diary/images/<файл>
  protocol.handle('neko-diary', (request) => {
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname))
    const file = diary.imagePath(name)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  cors = installCorsFix(session.defaultSession)
  registerIpc()
  if (prefs.trayEnabled) ensureTray()
  createMainWindow()
  reminders.load() // просроченные и не закрытые в прошлый раз напоминания показываются сразу
})

app.on('second-instance', () => showMain())

app.on('before-quit', () => {
  isQuitting = true
  reminders?.dispose()
  // дописываем в файлы всё, что ещё в очереди
  void memory?.flush()
  void diary?.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !hidesToTray()) app.quit()
})

/* ───────────────────────── IPC ───────────────────────── */

function registerIpc() {
  // окна
  handle('close-app', () => { if (hidesToTray()) hideToTray(); else quitApp() })
  handle('close-self', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  handle('minimize-app', () => mainWindow?.minimize())
  handle('maximize-app', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  handle('open-chat-window', () => createChatWindow())
  handle('open-settings-window', (_e, page?: unknown) => createSettingsWindow(typeof page === 'string' ? page : undefined))
  handle('open-diary-window', () => createDiaryWindow())

  // автозапуск
  // Из исходников (лаунчер) Windows должен запускать «electron.exe <папка проекта> --prod …», иначе откроется пустой Electron.
  // Читать состояние нужно с теми же path/args, с которыми оно записано, иначе Windows отвечает «выключено».
  const loginItem = () => ({
    path: process.execPath,
    args: app.isPackaged ? [`--persona=${persona}`] : [app.getAppPath(), '--prod', `--persona=${persona}`],
  })
  handle('settings:setAutoStart', (_e, enable: boolean) => app.setLoginItemSettings({ openAtLogin: !!enable, ...loginItem() }))
  handle('settings:getAutoStart', () => app.getLoginItemSettings(loginItem()).openAtLogin)

  // история чата
  handle('memory:addMessage', (_e, message) => memory.addMessage(message))
  handle('memory:getRecent', (_e, limit?: number) => memory.getRecent(clampInt(limit, 1, 500, 40)))
  handle('memory:getRange', (_e, from: number, to: number) => memory.getRange(Number(from) || 0, Number(to) || Date.now()))
  handle('memory:reset', () => memory.reset())
  handle('memory:getAll', () => memory.getAll())
  handle('memory:search', (_e, query: string, limit?: number) => memory.search(String(query ?? ''), clampInt(limit, 1, 100, 20)))
  handle('memory:incrementAccess', (_e, id: string) => memory.incrementAccess(String(id)))
  handle('memory:clear', () => memory.clear())
  handle('memory:lastMessageTime', () => memory.lastMessageTime())

  // дневник
  handle('diary:list', () => diary.list())
  handle('diary:get', (_e, id: string) => diary.get(String(id)))
  handle('diary:lastCoveredTime', () => diary.lastCoveredTime())
  handle('diary:save', async (_e, entry) => {
    const saved = await diary.save(entry)
    if (saved) broadcast('diary:changed', { id: saved.id })
    return saved
  })
  handle('diary:delete', async (_e, id: string) => {
    const ok = await diary.remove(String(id))
    if (ok) broadcast('diary:changed', { id })
    return ok
  })
  // экспорт в Markdown/PDF: диалог «Сохранить как» открывается над окном дневника
  handle('diary:export', (e, req) => exportDiary(diary, req, BrowserWindow.fromWebContents(e.sender)))
  // модели аватара: скачать образец VRM / открыть папку, куда можно положить свою
  handle('models:download', (e, urlPath: unknown) => downloadSampleModel(e.sender, urlPath))
  handle('models:open-folder', async () => {
    const dir = modelsDir(isDev, app.getAppPath(), app.getPath('userData'))
    fs.mkdirSync(dir, { recursive: true })
    const err = await shell.openPath(dir)
    return { ok: !err, dir, error: err || undefined }
  })
  handle('diary:addImage', (_e, dataUrl: string) => diary.addImage(String(dataUrl)))
  handle('diary:removeImage', (_e, file: string) => diary.removeImage(String(file)))
  // окно дневника просит «Написать запись сейчас»; писать умеет только главное окно (у него есть аватар для селфи)
  handle('diary:requestWrite', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    mainWindow.webContents.send('diary:write-request')
    return true
  })

  // статус дневника («пишет…», «рисует…») — виден в окне дневника
  handle('diary:setStatus', (_e, status: { state: string; message?: string }) => {
    diaryStatus = { state: String(status?.state ?? 'idle'), message: status?.message ? String(status.message).slice(0, 300) : undefined }
    broadcast('diary:status', diaryStatus)
  })
  handle('diary:getStatus', () => diaryStatus)

  // эмоции: окно чата → все окна (аватар меняет выражение лица)
  handle('emotion:broadcast', (_e, tag) => {
    broadcast('emotion:changed', tag)
  })

  // липсинк: окно, где звучит голос → окно аватара. Кадр — 5 весов гласных 0..1 либо null (рот закрыт).
  // Шлём всем окнам, кроме отправителя; кадры приходят до ~30 раз в секунду, поэтому без логов и лишней работы.
  handle('lipsync:frame', (e, frame) => {
    const out = sanitizeMouthFrame(frame)
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('lipsync:frame', out)
    }
  })

  // напоминания
  handle('reminders:add', (_e, text, at) => reminders.add(text, at))
  handle('reminders:list', () => reminders.list())
  handle('reminders:cancel', (_e, id) => reminders.cancel(id))
  handle('reminders:clear', () => reminders.clear())
  handle('reminders:fired', () => reminders.fired())
  handle('reminders:dismiss', (_e, id) => reminders.dismiss(id))
  handle('reminders:dismiss-all', () => reminders.dismissAll())
  handle('reminders:snooze', (_e, id, minutes) => reminders.snooze(id, minutes))

  // трей: главное окно присылает значения из настроек при запуске и при изменении
  handle('app:prefs-set', (_e, raw) => {
    applyPrefs(sanitizePrefs(raw, prefs))
    return { tray: !!tray?.alive }
  })

  // сеть
  handle('net:fetchText', (_e, url: string) => fetchText(String(url)))
  // адрес «своего» OpenAI-совместимого сервера, введённый пользователем: разрешаем к нему CORS
  handle('net:allow-host', (_e, url: string) => cors.allowHost(String(url)))
}

/** 5 конечных чисел 0..1 или null. Та же проверка есть в shared/services/lipSync.ts (sanitizeFrame) — main не импортирует код рендерера */
function sanitizeMouthFrame(f: unknown): number[] | null {
  if (!Array.isArray(f) || f.length !== 5) return null
  return f.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0))
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}
