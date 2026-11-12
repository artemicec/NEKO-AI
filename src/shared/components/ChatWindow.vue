<template>
  <div class="chat-window" :class="{ 'v-console': isConsole }">
    <!-- Шапка -->
    <div v-if="showHead" class="chat-head">
      <div class="head-left">
        <span class="dot" :class="{ live: isListening, busy: chatStore.isProcessing || drawing }"></span>
        <span class="title">{{ assistantName }}</span>
      </div>
      <div class="head-right">
        <button v-if="chatStore.isProcessing || speaking" class="mini-btn stop" title="Остановить" @click="chatStore.stop()">
          ⏹
        </button>
        <button class="mini-btn" title="Очистить чат" @click="chatStore.clearChat()">🧹</button>
      </div>
    </div>

    <!-- Сообщения -->
    <div ref="box" class="messages" @scroll.passive="onScroll">
      <div v-if="chatStore.messages.length === 0" class="empty">
        <slot name="empty">
          <div class="empty-icon">💙</div>
          <p>Скажи что-нибудь {{ assistantName }}…</p>
        </slot>
      </div>

      <MessageBubble
        v-for="message in chatStore.messages"
        :key="message.id"
        :message="message"
        :avatar="avatar"
        :who="message.role === 'user' ? 'Вы' : assistantName"
        :variant="isConsole ? 'console' : 'bubble'"
        @open-image="openImage"
      />

      <div v-if="chatStore.webActivity" class="web-activity">
        <Icon name="globe" :size="14" />
        <span>Ищу в интернете: «{{ chatStore.webActivity }}»</span>
      </div>
      <div v-else-if="chatStore.showTyping && !drawing" class="typing"><span></span><span></span><span></span></div>
      <div v-if="drawing" class="drawing">🎨 Рисую… <small>(нажми 🎨 ещё раз — отмена)</small></div>
    </div>

    <!-- Нижняя зона -->
    <div class="input-zone">
      <slot name="above-input" />
      <div v-if="hint" class="hint">{{ hint }}</div>

      <!-- Голосовой режим -->
      <div v-if="voiceMode && canVoice" class="voice-mode">
        <button
          class="mic-btn"
          :class="{ active: isListening }"
          :title="voiceState === 'transcribing' ? 'Отменить' : isListening ? 'Закончить' : 'Говорить'"
          @click="toggleVoice"
        >
          <Icon v-if="isConsole" :name="isListening ? 'stop' : 'mic'" :size="20" />
          <template v-else>{{ isListening ? '⏹️' : '🎤' }}</template>
        </button>
        <span class="voice-hint">{{ voiceHint }}</span>
        <button class="switch-btn" title="Текстовый режим" @click="voiceMode = false">
          <Icon v-if="isConsole" name="keyboard" />
          <template v-else>⌨️</template>
        </button>
      </div>

      <!-- Текстовый режим -->
      <div v-else class="text-mode">
        <button v-if="canVoice" class="switch-btn" title="Голосовой режим" @click="voiceMode = true">
          <Icon v-if="isConsole" name="mic" />
          <template v-else>🎤</template>
        </button>
        <button class="attach-btn" title="Отправить картинку" @click="fileInput?.click()">
          <Icon v-if="isConsole" name="clip" />
          <template v-else>📎</template>
        </button>
        <input
          ref="textInput"
          v-model="uiStore.inputText"
          class="text-input"
          :placeholder="placeholder"
          maxlength="4000"
          @keydown.enter.exact="onEnter"
        />
        <button class="gen-btn" :class="{ on: drawing }" title="Нарисовать картинку (Stable Diffusion)" @click="drawImage">
          <Icon v-if="isConsole" name="image" />
          <template v-else>🎨</template>
        </button>
        <button
          v-if="chatStore.isProcessing && !uiStore.inputText.trim()"
          class="send-btn"
          title="Остановить"
          @click="chatStore.stop()"
        >
          <Icon v-if="isConsole" name="stop" />
          <template v-else>⏹</template>
        </button>
        <button v-else class="send-btn" :disabled="!uiStore.inputText.trim()" title="Отправить" @click="send">
          <Icon v-if="isConsole" name="send" />
          <template v-else>➤</template>
        </button>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileSelected" />
      </div>
    </div>

    <ImageLightbox v-if="lightbox" :src="lightbox.src" :caption="lightbox.caption" @close="lightbox = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatStore } from '@shared/stores/chatStore'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { useUIStore } from '@shared/stores/uiStore'
import { speechOutput } from '@shared/services/speechOutput'
import { SpeechInput, speechInputSupported, type VoiceInput } from '@shared/services/speechInput'
import { WhisperInput, whisperPromptFor } from '@shared/services/whisperInput'
import { recorderSupported } from '@shared/services/voiceRecorder'
import { currentPersona } from '@shared/persona'
import { generateImage } from '@shared/services/imageGenService'
import MessageBubble from './MessageBubble.vue'
import ImageLightbox from './ImageLightbox.vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    assistantName?: string
    /** 'console' — оформление консоли ARIA (без пузырей, векторные значки); по умолчанию — карточка NEKO */
    variant?: 'card' | 'console'
    /** false — шапку рисует родитель (в ARIA она своя) */
    showHead?: boolean
    placeholder?: string
  }>(),
  { assistantName: 'NEKO', variant: 'card', showHead: true, placeholder: 'Напиши сообщение…' }
)
const emit = defineEmits<{ (e: 'listening', value: boolean): void }>()

const isConsole = computed(() => props.variant === 'console')

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()

const avatar = computed(() => (props.assistantName === 'ARIA' ? '◈' : '🐱'))

const box = ref<HTMLDivElement>()
const fileInput = ref<HTMLInputElement>()
const textInput = ref<HTMLInputElement>()
const hint = ref('')
const lightbox = ref<{ src: string; caption?: string } | null>(null)
const speaking = ref(false)

let hintTimer: ReturnType<typeof setTimeout> | null = null
const flashHint = (text: string, ms = 5000) => {
  hint.value = text
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hint.value = '' }, ms)
}

/* ───────────── прокрутка: «липнем» к низу, только пока пользователь сам не листает вверх ───────────── */

const stick = ref(true)
const onScroll = () => {
  const el = box.value
  if (!el) return
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
const scrollDown = (force = false) =>
  nextTick(() => {
    const el = box.value
    if (el && (force || stick.value)) el.scrollTop = el.scrollHeight
  })

watch(
  () => chatStore.messages.length,
  () => scrollDown(chatStore.messages[chatStore.messages.length - 1]?.role === 'user')
)
// стриминг: ответ растёт внутри последнего сообщения
watch(() => chatStore.messages[chatStore.messages.length - 1]?.content, () => scrollDown())
watch(() => chatStore.webActivity, () => scrollDown())

/* ───────────── жизненный цикл ───────────── */

let offSpeaking: (() => void) | null = null
onMounted(async () => {
  offSpeaking = speechOutput.onSpeakingChange((v) => { speaking.value = v })
  await chatStore.loadHistory() // чат-окно — отдельный процесс: подтягиваем недавнюю переписку с диска
  scrollDown(true)
})
onBeforeUnmount(() => {
  offSpeaking?.()
  browserIn.abort()
  whisperIn.abort()
  drawAbort?.abort()
  if (hintTimer) clearTimeout(hintTimer)
})

/* ───────────── голос ───────────── */

const browserIn = new SpeechInput()
const whisperIn = new WhisperInput(() => {
  const s = settingsStore.settings
  return {
    whisper: { endpoint: s.whisperEndpoint, model: s.whisperModel, language: s.whisperLanguage, prompt: whisperPromptFor(currentPersona()) },
    silenceMs: s.whisperSilenceMs,
  }
})
let activeVoice: VoiceInput | null = null
const voiceMode = ref(false)
const isListening = ref(false)
/** «Слушаю» — идёт запись, «Распознаю» — запись закончена, ждём текст от Whisper */
const voiceState = ref<'idle' | 'listening' | 'transcribing'>('idle')
const interim = ref('')
const canVoice = computed(() => {
  const s = settingsStore.settings
  return s.enableVoiceInput && (s.sttEngine === 'whisper' ? recorderSupported() : speechInputSupported())
})
const voiceHint = computed(() =>
  voiceState.value === 'transcribing' ? 'Распознаю…' : isListening.value ? interim.value || 'Слушаю…' : 'Нажми и говори'
)
watch(canVoice, (v) => { if (!v) voiceMode.value = false })
watch(voiceState, (v) => emit('listening', v === 'listening'))

/** Родитель (быстрые команды ARIA) может вернуть фокус в поле ввода */
const focus = () => nextTick(() => textInput.value?.focus())
defineExpose({ focus })

const toggleVoice = () => {
  if (isListening.value) {
    activeVoice?.stop() // пока говорим — «хватит, распознавай»; пока распознаётся — отмена
    return
  }
  speechOutput.stop() // чтобы микрофон не слышал саму NEKO
  interim.value = ''
  const input: VoiceInput = settingsStore.settings.sttEngine === 'whisper' ? whisperIn : browserIn
  activeVoice = input
  voiceState.value = 'listening'
  const ok = input.start({
    onState: (st) => { voiceState.value = st },
    onInterim: (t) => { interim.value = t },
    onFinal: (t) => {
      stick.value = true
      void chatStore.sendMessage(t)
    },
    onError: (_kind, message) => flashHint(message, 8000),
    onEnd: () => {
      isListening.value = false
      voiceState.value = 'idle'
      interim.value = ''
      activeVoice = null
    },
  })
  isListening.value = ok
  if (!ok) {
    voiceState.value = 'idle'
    activeVoice = null
    flashHint('Не удалось включить микрофон. Пиши текстом.')
  }
}

/* ───────────── отправка текста ───────────── */

const send = async () => {
  const text = uiStore.inputText.trim()
  if (!text) return
  uiStore.inputText = ''
  stick.value = true
  await chatStore.sendMessage(text)
}

const onEnter = (e: KeyboardEvent) => {
  if (e.isComposing) return // не отправляем, пока набирается слово через IME
  e.preventDefault()
  void send()
}

/* ───────────── картинка от пользователя ───────────── */

const MAX_IMAGE_MB = 8

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) return flashHint(`Файл слишком большой (максимум ${MAX_IMAGE_MB} МБ).`)

  const reader = new FileReader()
  reader.onload = () => {
    chatStore.addMessage({ role: 'user', content: '', imageUrl: reader.result as string, imageAlt: file.name })
    stick.value = true
  }
  reader.onerror = () => flashHint('Не удалось прочитать файл.')
  reader.readAsDataURL(file)
}

/* ───────────── генерация картинки (Stable Diffusion) ───────────── */

const drawing = ref(false)
let drawAbort: AbortController | null = null

const drawImage = async () => {
  if (drawing.value) {
    drawAbort?.abort()
    return
  }
  const prompt = uiStore.inputText.trim()
  if (!prompt) return flashHint('Напиши в поле, что нарисовать, и нажми 🎨')

  const s = settingsStore.settings
  uiStore.inputText = ''
  stick.value = true
  chatStore.addMessage({ role: 'user', content: `🎨 ${prompt}` })

  const ctrl = new AbortController()
  drawAbort = ctrl
  drawing.value = true
  try {
    const imageUrl = await generateImage(
      prompt,
      {
        endpoint: s.sdEndpoint,
        steps: s.sdSteps,
        width: s.sdWidth,
        height: s.sdHeight,
        negativePrompt: s.sdNegativePrompt,
        stylePrompt: s.sdStylePrompt,
      },
      { signal: ctrl.signal }
    )
    chatStore.addMessage({
      role: 'assistant',
      content: `Вот что получилось по запросу «${prompt}»`,
      imageUrl,
      imageAlt: prompt,
      plugin: 'Stable Diffusion',
    })
  } catch (e) {
    if (ctrl.signal.aborted) {
      chatStore.addMessage({ role: 'assistant', content: 'Ладно, не рисую.' })
    } else {
      console.error('Ошибка генерации:', e)
      chatStore.addMessage({
        role: 'assistant',
        content: `Не получилось нарисовать. Проверь, что Stable Diffusion (Automatic1111) запущен по адресу ${s.sdEndpoint} с флагами --api --cors-allow-origins=*`,
        error: true,
      })
    }
  } finally {
    drawing.value = false
    drawAbort = null
  }
}

const openImage = (src: string, caption?: string) => {
  lightbox.value = { src, caption }
}
</script>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  flex: 1 1 0; /* занимает остаток высоты/ширины родителя (в консоли ARIA над ним есть своя шапка) */
  height: 100%;
  min-height: 0;
  min-width: 0;
  color: var(--text-primary);
}

/* Шапка */
.chat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}
.head-left { display: flex; align-items: center; gap: 8px; }
.head-right { display: flex; gap: 2px; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-purple);
  transition: all 0.3s;
}
.dot.busy { background: var(--accent-blue); box-shadow: 0 0 8px var(--accent-blue); }
.dot.live {
  background: var(--accent-gold);
  box-shadow: 0 0 10px var(--accent-gold);
  animation: pulse-mic 1.6s infinite;
}
.title { font-size: 14px; font-weight: 600; letter-spacing: 1.2px; }
.mini-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.mini-btn:hover { background: var(--hover-bg); color: var(--text-primary); }
.mini-btn.stop { color: var(--danger); }

/* Сообщения (без smooth-прокрутки: при стриминге она «отставала» от текста) */
.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 13px;
  gap: 8px;
}
.empty-icon { font-size: 32px; opacity: 0.6; animation: float 3s ease-in-out infinite; }
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.typing { display: flex; gap: 5px; padding: 8px 4px; }
.typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-purple);
  animation: typing 1.4s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}
.web-activity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.web-activity :deep(.icon) { color: var(--accent-blue); animation: web-pulse 1.4s ease-in-out infinite; }
@keyframes web-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.drawing { font-size: 12px; color: var(--text-secondary); padding: 6px 4px; }
.drawing small { opacity: 0.7; }

/* Нижняя зона */
.input-zone {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--panel-border);
  flex-shrink: 0;
}
.hint {
  font-size: 11px;
  line-height: 1.4;
  color: var(--accent-gold);
  margin: 0 2px 8px;
}

.voice-mode { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.mic-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-purple-strong));
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--accent-purple) 40%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mic-btn.active {
  background: linear-gradient(135deg, var(--accent-gold), #b8941f);
  animation: pulse-mic 1.6s infinite;
}
.voice-hint {
  flex: 1;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  letter-spacing: 0.4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-mode { display: flex; align-items: center; gap: 6px; }
.text-input {
  flex: 1;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  padding: 10px 14px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
  font-family: inherit;
}
.text-input:focus { border-color: var(--accent-purple); }
.text-input::placeholder { color: var(--text-muted); }

.send-btn,
.attach-btn,
.gen-btn,
.switch-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}
.send-btn:hover,
.attach-btn:hover,
.gen-btn:hover,
.switch-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
  border-color: var(--accent-purple);
}
.gen-btn.on { background: var(--active-bg); border-color: var(--accent-purple); animation: pulse-mic 1.6s infinite; }
.send-btn {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-purple-strong));
  border: none;
  color: #fff;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--accent-purple) 40%, transparent);
}
.send-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
</style>
