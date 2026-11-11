// src/shared/components/settings/pages.ts
// Единый список страниц настроек: им пользуются и отдельное окно настроек, и модальное окно.

import type { Component } from 'vue'
import MovementSettings from './MovementSettings.vue'
import VoiceSettings from './VoiceSettings.vue'
import InterfaceSettings from './InterfaceSettings.vue'
import DiarySettings from './DiarySettings.vue'
import ImageSettings from './ImageSettings.vue'
import InternetSettings from './InternetSettings.vue'
import SystemSettings from './SystemSettings.vue'
import SetupSettings from './SetupSettings.vue'
import { currentPersona, type Persona } from '@shared/persona'

export interface SettingsPage {
  id: string
  icon: string
  label: string
  component: Component
  /** Для каких ассистентов страница имеет смысл; не указано — для обоих */
  only?: Persona
}

export const SETTINGS_PAGES: SettingsPage[] = [
  { id: 'movement', icon: '🎭', label: 'Аватар и движение', component: MovementSettings },
  { id: 'voice', icon: '🎤', label: 'Голос и звук', component: VoiceSettings },
  { id: 'diary', icon: '📔', label: 'Дневник', component: DiarySettings, only: 'neko' },
  { id: 'images', icon: '🖼️', label: 'Картинки', component: ImageSettings },
  { id: 'internet', icon: '🌐', label: 'Интернет', component: InternetSettings },
  { id: 'ui', icon: '🎨', label: 'Интерфейс', component: InterfaceSettings },
  { id: 'system', icon: '⚙️', label: 'Нейросеть и система', component: SystemSettings },
  { id: 'setup', icon: '🧭', label: 'Проверка и установка', component: SetupSettings },
]

/** Страницы, которые нужны текущему ассистенту (у ARIA нет аватара и дневника) */
export const pagesFor = (persona: Persona = currentPersona()): SettingsPage[] =>
  SETTINGS_PAGES.filter((p) => !p.only || p.only === persona)
