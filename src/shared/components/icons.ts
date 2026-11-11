// src/shared/components/icons.ts
// Векторные значки интерфейса (собственные фигуры, без внешних библиотек). Рисуются в Icon.vue.

export type IconName =
  | 'mic'
  | 'stop'
  | 'send'
  | 'clip'
  | 'image'
  | 'keyboard'
  | 'clear'
  | 'sliders'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'globe'

export const ICON_PATHS: Record<IconName, string> = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  clip: '<path d="M19.5 11.5 12 19a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.1-2.1l7-7"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="m4.5 17 4.5-4 3.5 3 3-2.5 4 3.5"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  clear: '<path d="M5 7h14M10 7V5h4v2M7.5 7l.8 12h7.4l.8-12"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  minimize: '<path d="M6 12h12"/>',
  maximize: '<rect x="6.5" y="6.5" width="11" height="11" rx="1"/>',
  restore: '<path d="M9 6.5h8.5V15M6.5 9H15v8.5H6.5z"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
}
