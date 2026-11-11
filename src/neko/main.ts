import { createApp, type Component } from 'vue'
import { createPinia } from 'pinia'
import '@shared/styles/base.css'
import '@shared/components/settings/_settings.css'
import './styles/neko.css'

// Главное окно — аватар и планировщик дневника; остальные окна (чат, настройки, дневник)
// подгружаются лениво — главному окну не нужно тянуть их код при старте.
const views: Record<string, () => Promise<{ default: Component }>> = {
  chat: () => import('./NekoChatApp.vue'),
  settings: () => import('./NekoSettingsApp.vue'),
  diary: () => import('./NekoDiaryApp.vue'),
  reminder: () => import('./NekoReminderApp.vue'),
}

const query = new URLSearchParams(window.location.search)
// Окна настроек/чата открываются из пакета NEKO, но могут принадлежать ARIA — тогда они одеваются в её цвета
if (query.get('persona') === 'aria') document.documentElement.dataset.persona = 'aria'

const win = query.get('window') || 'main'
const load = views[win] ?? (() => import('./NekoApp.vue'))

load().then(({ default: Root }) => {
  const app = createApp(Root)
  app.use(createPinia())
  app.mount('#app')
})
