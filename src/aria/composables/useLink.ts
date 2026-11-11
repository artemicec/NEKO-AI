// src/aria/composables/useLink.ts
// Живое состояние связи с нейросетью для телеметрии ARIA.
// Ollama — локальный сервер, его проверяем лёгким запросом /api/tags раз в 20 секунд (и сразу после каждого ответа).
// DeepSeek — облако: проверять его ключ пустым запросом незачем, ошибку покажет сам чат.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createProvider } from '@shared/services/aiFactory'
import { useSettingsStore } from '@shared/stores/settingsStore'

export type LinkStatus = 'checking' | 'online' | 'offline'

const POLL_MS = 20_000

export function useLink() {
  const settingsStore = useSettingsStore()
  const status = ref<LinkStatus>('checking')
  const installed = ref<string[]>([])

  let timer: ReturnType<typeof setInterval> | null = null
  let inflight = false

  const check = async () => {
    const s = settingsStore.settings
    if (s.provider !== 'ollama') {
      status.value = 'online'
      installed.value = []
      return
    }
    if (inflight) return
    inflight = true
    try {
      const models = (await createProvider(s).listModels?.()) ?? []
      installed.value = models
      // listModels глотает сетевые ошибки и возвращает [] — пустой список считаем «нет связи»
      status.value = models.length ? 'online' : 'offline'
    } catch {
      status.value = 'offline'
    } finally {
      inflight = false
    }
  }

  /** Нужной модели нет среди установленных в Ollama */
  const modelMissing = computed(() => {
    const s = settingsStore.settings
    return s.provider === 'ollama' && status.value === 'online' && installed.value.length > 0 && !installed.value.includes(s.ollamaModel)
  })

  onMounted(() => {
    void check()
    timer = setInterval(() => { if (!document.hidden) void check() }, POLL_MS)
  })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })

  return { status, installed, modelMissing, check }
}
