// src/shared/composables/useAppPrefsSync.ts
//
// Трей и «закрывать в трей» решает главный процесс, ему эти два значения нужны ещё до запуска окон.
// Главное окно (аватар NEKO / окно ARIA) присылает их при запуске и при каждом изменении в настройках
// (окно настроек меняет localStorage → главное окно подхватывает изменение → отправляет сюда).

import { onMounted, watch } from 'vue'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { safeInvoke } from '@shared/services/ipcSafe'

export const prefsFromSettings = (s: { trayEnabled: boolean; closeToTray: boolean }) => ({
  trayEnabled: !!s.trayEnabled,
  closeToTray: !!s.closeToTray,
})

export function useAppPrefsSync(): void {
  const st = useSettingsStore()
  const push = () => { void safeInvoke('app:prefs-set', prefsFromSettings(st.settings)).catch(() => {}) }
  onMounted(push)
  // геттер читает st.settings заново: при синхронизации между окнами объект настроек заменяется целиком
  watch(() => [st.settings.trayEnabled, st.settings.closeToTray], push)
}
