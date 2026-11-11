// electron/tray.ts
// Значок приложения в системном трее (меню — в ./trayMenu). Если значок создать не удалось, приложение продолжает работать
// без него, а «закрывать в трей» автоматически не включается (см. alive).

import { Menu, Tray, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import { buildTrayMenu, type TrayActions } from './trayMenu'
import { PERSONA_COLOR, fallbackIconPng } from './trayIcon'

export class TrayController {
  private tray: Tray | null = null

  constructor(
    private readonly persona: 'neko' | 'aria',
    private readonly actions: TrayActions,
    /** Клик по значку: показать/спрятать главное окно */
    private readonly onToggle: () => void,
    /** Где искать public/icons (разные у dev и у упакованного приложения) */
    private readonly iconDirs: string[]
  ) {}

  /** true — значок есть и «закрытие в трей» безопасно: из трея всегда можно вернуться */
  get alive(): boolean {
    return !!this.tray && !this.tray.isDestroyed()
  }

  create(): boolean {
    if (this.alive) return true
    try {
      this.tray = new Tray(this.icon())
      this.tray.setToolTip(this.persona === 'aria' ? 'ARIA' : 'NEKO')
      this.tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(this.persona, this.actions)))
      this.tray.on('click', this.onToggle)
      return true
    } catch (e) {
      console.warn('Трей: не удалось создать значок', e)
      this.tray = null
      return false
    }
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy()
    this.tray = null
  }

  /** Всплывающая подсказка у значка (Windows); на других системах молча ничего не делает */
  hint(title: string, content: string): void {
    try {
      this.tray?.displayBalloon({ title, content, iconType: 'info' })
    } catch { /* не критично */ }
  }

  private icon() {
    for (const dir of this.iconDirs) {
      const file = path.join(dir, `${this.persona}.png`)
      if (fs.existsSync(file)) {
        const img = nativeImage.createFromPath(file)
        if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
      }
    }
    return nativeImage.createFromBuffer(fallbackIconPng(PERSONA_COLOR[this.persona]))
  }
}
