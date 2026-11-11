// src/shared/components/settings/useSettingsForm.ts
// Общая логика страниц настроек: доступ к store и безопасный ввод чисел
// (v-model.number пропускает пустую строку / NaN — из-за этого в запросы к модели улетали бы мусорные значения).

import { useSettingsStore } from '@shared/stores/settingsStore'
import type { AppSettings } from '@shared/types'

type NumKey = { [K in keyof AppSettings]: AppSettings[K] extends number ? K : never }[keyof AppSettings]

export function useSettingsForm() {
  const st = useSettingsStore()

  /** Обработчик @change для <input type="number">: зажимает значение в диапазон, а мусор откатывает */
  const setNum = (key: NumKey, e: Event, min: number, max: number) => {
    const el = e.target as HTMLInputElement
    const v = Number(el.value)
    if (el.value.trim() === '' || !Number.isFinite(v)) {
      el.value = String(st.settings[key])
      return
    }
    const clamped = Math.min(max, Math.max(min, v))
    st.settings[key] = clamped
    el.value = String(clamped)
  }

  return { st, setNum }
}
