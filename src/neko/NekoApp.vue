<template>
  <div class="neko-root">
    <div class="neko-drag-handle"><span class="neko-drag-grip"></span></div>

    <Transition name="pill">
      <div v-if="pill" class="neko-pill">{{ pill }}</div>
    </Transition>

    <div class="neko-avatar">
      <NekoAvatar ref="avatarRef" />
    </div>

    <div class="neko-buttons">
      <button class="neko-btn" title="Настройки" @click="openSettings">⚙️</button>
      <button class="neko-btn" title="Чат" @click="openChat">💬</button>
      <button class="neko-btn" :class="{ busy: diaryBusy }" title="Дневник NEKO" @click="openDiary">
        📔<span v-if="hasNewEntry" class="badge"></span>
      </button>
      <button class="neko-btn close" title="Закрыть" @click="closeApp">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NekoAvatar from './components/NekoAvatar.vue'
import { useChatStore } from '@shared/stores/chatStore'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { runFirstRunSetup } from '@shared/services/setupChecks'
import { useAppPrefsSync } from '@shared/composables/useAppPrefsSync'
import { NEKO_PROMPT } from '@neko/prompt/nekoPrompt'
import { startDiaryScheduler } from '@neko/services/diaryScheduler'
import { diaryAPI } from '@neko/services/diaryClient'
import type { DiaryStatus } from '@neko/services/diaryService'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
useAppPrefsSync() // трей / «закрывать в трей» — решает главный процесс
const api = window.electronAPI

const avatarRef = ref<InstanceType<typeof NekoAvatar> | null>(null)
const status = ref<DiaryStatus>({ state: 'idle' })
const hasNewEntry = ref(false)

const diaryBusy = computed(() => status.value.state === 'writing' || status.value.state === 'drawing')
const pill = computed(() =>
  status.value.state === 'writing' ? '✍️ Пишу в дневник…' : status.value.state === 'drawing' ? '🎨 Рисую для дневника…' : ''
)

const cleanups: (() => void)[] = []

onMounted(() => {
  chatStore.setSystemPrompt(NEKO_PROMPT)
  void chatStore.warmup() // загрузить модель в память заранее — первый ответ не ждёт загрузки

  // Планировщик дневника живёт только здесь: у этого окна есть аватар для «селфи»
  cleanups.push(startDiaryScheduler(() => avatarRef.value))

  let wasBusy = false
  cleanups.push(
    diaryAPI.onStatus((s) => {
      status.value = s
      const busy = s.state === 'writing' || s.state === 'drawing'
      if (wasBusy && s.state === 'idle') hasNewEntry.value = true // запись дописана — подсветим кнопку
      wasBusy = busy
    })
  )
  void diaryAPI.getStatus().then((s) => { status.value = s })

  // первый запуск: через секунду (когда аватар уже на экране) открываем «Проверка и установка»
  const t = setTimeout(() => runFirstRunSetup(settingsStore.settings, (page) => api?.invoke('open-settings-window', page)), 1200)
  cleanups.push(() => clearTimeout(t))
})

onBeforeUnmount(() => cleanups.forEach((fn) => fn()))

const openSettings = () => api?.invoke('open-settings-window')
const openChat = () => api?.invoke('open-chat-window')
const openDiary = () => {
  hasNewEntry.value = false
  void api?.invoke('open-diary-window')
}
const closeApp = () => api?.invoke('close-app')
</script>
