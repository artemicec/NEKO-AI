<template>
  <div class="aria-root" :class="{ max: maximized }" :data-state="state">
    <header class="aria-header">
      <div class="aria-brand">
        <span v-if="avatarReady" class="aria-logo"><AriaCore :state="state" :label="word" /></span>
        <span class="aria-wordmark">ARIA</span>
        <span class="aria-status" :title="stateHint">{{ word }}</span>
      </div>
      <div class="aria-win">
        <button v-if="busy" class="aria-win-btn stop" title="Остановить" @click="chatStore.stop()"><Icon name="stop" :size="16" /></button>
        <button class="aria-win-btn" title="Очистить диалог" :disabled="chatStore.messages.length === 0" @click="chatStore.clearChat()">
          <Icon name="clear" :size="16" />
        </button>
        <span class="aria-win-sep"></span>
        <button class="aria-win-btn" title="Настройки" @click="openSettings"><Icon name="sliders" :size="16" /></button>
        <button class="aria-win-btn" title="Свернуть" @click="minimize"><Icon name="minimize" :size="16" /></button>
        <button class="aria-win-btn" :title="maximized ? 'Восстановить' : 'Развернуть'" @click="maximize">
          <Icon :name="maximized ? 'restore' : 'maximize'" :size="16" />
        </button>
        <button class="aria-win-btn close" title="Закрыть" @click="closeApp"><Icon name="close" :size="16" /></button>
      </div>
    </header>

    <main class="aria-main">
      <section class="aria-stage">
        <AriaAvatar :class="{ ready: avatarReady }" @status="avatarStatus = $event" />

        <!-- Модели нет (или ещё грузится) — вместо неё большой объектив -->
        <div v-if="!avatarReady" class="aria-orb">
          <AriaCore :state="state" :label="word" />
          <p v-if="avatarStatus === 'missing'" class="aria-note">
            Модель не найдена. Положите файл <b>aria.vrm</b> в <b>public/models</b> или укажите путь в настройках
            (раздел «Аватар и движение»).
          </p>
        </div>

        <div class="aria-foot">
          <div v-if="detailsOpen" class="aria-details">
            <AriaTelemetry
              :link="link.status.value"
              :provider="settings.provider"
              :model="modelName"
              :model-missing="link.modelMissing.value"
              :first-token-ms="chatStore.metrics.firstTokenMs"
              :history="chatStore.metrics.history"
              :context-used="contextUsed"
              :context-limit="settings.historyMessages"
              :voice="settings.enableVoiceOutput"
            />
          </div>
          <button class="aria-meta" :aria-expanded="detailsOpen" title="Подробности" @click="detailsOpen = !detailsOpen">
            <span class="aria-dot" :class="dotClass"></span>
            <span class="aria-meta-model">{{ metaText }}</span>
            <span class="aria-meta-latency">{{ formatLatency(chatStore.metrics.firstTokenMs) }}</span>
          </button>
        </div>
      </section>

      <section class="aria-console">
        <ChatWindow
          ref="chat"
          assistant-name="ARIA"
          variant="console"
          :show-head="false"
          placeholder="Напишите ARIA"
          @listening="listening = $event"
        >
          <template #empty>
            <div class="aria-empty">
              <div class="aria-empty-title">Чем помочь?</div>
              <p>Напишите вопрос или нажмите на микрофон.</p>
            </div>
          </template>
          <template #above-input>
            <div v-if="showChips" class="aria-chips">
              <button v-for="c in CHIPS" :key="c.label" class="aria-chip" @click="runChip(c)">{{ c.label }}</button>
            </div>
          </template>
        </ChatWindow>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChatWindow from '@shared/components/ChatWindow.vue'
import Icon from '@shared/components/Icon.vue'
import { useChatStore } from '@shared/stores/chatStore'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { useUIStore } from '@shared/stores/uiStore'
import { speechOutput } from '@shared/services/speechOutput'
import { activeModel } from '@shared/services/providers'
import { runFirstRunSetup } from '@shared/services/setupChecks'
import { useAppPrefsSync } from '@shared/composables/useAppPrefsSync'
import { ARIA_PROMPT } from '@aria/prompt/ariaPrompt'
import AriaCore from './components/AriaCore.vue'
import AriaTelemetry from './components/AriaTelemetry.vue'
import AriaAvatar from './components/AriaAvatar.vue'
import { useLink } from './composables/useLink'
import { formatLatency } from './format'
import type { AvatarStatus, CoreState } from './types'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
useAppPrefsSync() // трей / «закрывать в трей» — решает главный процесс
const uiStore = useUIStore()
const settings = computed(() => settingsStore.settings)
const api = window.electronAPI
const link = useLink()

const chat = ref<{ focus: () => void } | null>(null)

/* ───────────── что сейчас делает ARIA ───────────── */

const listening = ref(false)
const speaking = ref(false)

const state = computed<CoreState>(() => {
  if (listening.value) return 'listening'
  if (speaking.value) return 'speaking'
  if (chatStore.isProcessing) return chatStore.showTyping ? 'thinking' : 'speaking'
  if (link.status.value === 'offline') return 'offline'
  return 'idle'
})

const WORDS: Record<CoreState, string> = {
  idle: 'На связи',
  listening: 'Слушаю',
  thinking: 'Думаю',
  speaking: 'Отвечаю',
  offline: 'Нет связи',
}
// пока идёт поиск, вместо «Думаю» — «Ищу в сети»
const word = computed(() => (state.value === 'thinking' && chatStore.webActivity ? 'Ищу в сети' : WORDS[state.value]))

const modelName = computed(() => activeModel(settings.value).model)

/** Подсказка к слову состояния (всплывает при наведении) */
const stateHint = computed(() => {
  switch (state.value) {
    case 'listening': return 'Говорите, я слушаю'
    case 'thinking': return chatStore.webActivity ? `Ищу в интернете: ${chatStore.webActivity}` : `${modelName.value} разбирает запрос`
    case 'speaking': return speaking.value ? 'Озвучиваю ответ' : 'Печатаю ответ'
    case 'offline': return 'Запустите Ollama или выберите DeepSeek в настройках'
    default: return 'Готова выполнить команду'
  }
})

const busy = computed(() => chatStore.isProcessing || speaking.value)

/* ───────────── модель и нижняя строка ───────────── */

const avatarStatus = ref<AvatarStatus>('loading')
const avatarReady = computed(() => avatarStatus.value === 'ready')
const detailsOpen = ref(false)

const dotClass = computed(() => ({
  ok: link.status.value === 'online',
  bad: link.status.value === 'offline',
}))
/** В нижней строке — модель; если связи нет, то причина (она важнее) */
const metaText = computed(() =>
  settings.value.provider === 'ollama' && link.status.value === 'offline' ? 'Ollama не отвечает' : modelName.value
)

/** Сколько реплик реально уходит в контекст модели (не больше лимита из настроек) */
const contextUsed = computed(() => Math.min(chatStore.messages.length, settings.value.historyMessages))

// Ответ закончился (успешно или нет) — сразу перепроверяем связь, не дожидаясь таймера
watch(() => chatStore.isProcessing, (now, was) => { if (was && !now) void link.check() })

/* ───────────── быстрые команды ───────────── */

interface Chip { label: string; send?: string; fill?: string }

// Фразы подобраны под то, что реально распознают плагины (погода, новости, факт, перевод, рисование)
const CHIPS: Chip[] = [
  { label: 'Погода', send: 'Погода' },
  { label: 'Новости', send: 'Новости' },
  { label: 'Факт дня', send: 'Расскажи факт' },
  { label: 'Перевести…', fill: 'Переведи ' },
  { label: 'Нарисовать…', fill: 'Нарисуй ' },
]

/** Быстрые команды видны, только пока поле пустое и ARIA ничем не занята */
const showChips = computed(() => !uiStore.inputText.trim() && !chatStore.isProcessing)

const runChip = (c: Chip) => {
  if (c.send) {
    void chatStore.sendMessage(c.send)
  } else if (c.fill) {
    uiStore.inputText = c.fill
    chat.value?.focus()
  }
}

/* ───────────── окно: развёрнутость и кнопки ───────────── */

const maximized = ref(false)
const syncMaximized = () => {
  // у безрамочного окна нет события «развёрнуто»: сравниваем размер окна с рабочей областью экрана
  maximized.value = window.outerWidth >= screen.availWidth - 1 && window.outerHeight >= screen.availHeight - 1
}

let offSpeaking: (() => void) | null = null
let firstRunTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  chatStore.setSystemPrompt(ARIA_PROMPT)
  void chatStore.warmup() // модель грузится в память, пока пользователь ещё набирает первое сообщение
  offSpeaking = speechOutput.onSpeakingChange((v) => { speaking.value = v })
  window.addEventListener('resize', syncMaximized)
  syncMaximized()
  // первый запуск: открываем «Проверка и установка»
  firstRunTimer = setTimeout(() => runFirstRunSetup(settingsStore.settings, (page) => api?.invoke('open-settings-window', page)), 1200)
})
onBeforeUnmount(() => {
  clearTimeout(firstRunTimer)
  offSpeaking?.()
  window.removeEventListener('resize', syncMaximized)
})

const openSettings = () => api?.invoke('open-settings-window')
const minimize = () => api?.invoke('minimize-app')
const maximize = () => api?.invoke('maximize-app')
const closeApp = () => api?.invoke('close-app')
</script>
