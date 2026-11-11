// electron/trayMenu.ts
// Меню значка в трее: чистая функция (без Electron), чтобы порядок и подписи проверялись тестом.

export interface TrayMenuItem {
  label?: string
  type?: 'separator'
  click?: () => void
}

export interface TrayActions {
  openMain: () => void
  openChat: () => void
  openDiary: () => void
  openSettings: () => void
  quit: () => void
}

/** NEKO: Открыть NEKO · Чат · Дневник · Настройки · Выход. ARIA: Открыть ARIA · Настройки · Выход */
export function buildTrayMenu(persona: 'neko' | 'aria', a: TrayActions): TrayMenuItem[] {
  const name = persona === 'aria' ? 'ARIA' : 'NEKO'
  const items: TrayMenuItem[] = [{ label: `Открыть ${name}`, click: a.openMain }]
  if (persona === 'neko') {
    items.push({ label: 'Чат', click: a.openChat }, { label: 'Дневник', click: a.openDiary })
  }
  items.push({ label: 'Настройки', click: a.openSettings }, { type: 'separator' }, { label: 'Выход', click: a.quit })
  return items
}
