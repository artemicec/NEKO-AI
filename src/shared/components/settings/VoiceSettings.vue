<template>
  <div class="s-page">
    <div class="s-section">Голосовой ввод</div>
    <div class="s-row">
      <span>Микрофон в чате</span>
      <label class="switch"><input v-model="st.settings.enableVoiceInput" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div class="s-row">
      <span>Движок ввода</span>
      <select v-model="st.settings.sttEngine">
        <option value="browser">Браузер (в Electron обычно не работает)</option>
        <option value="whisper">Whisper (локальный сервер)</option>
      </select>
    </div>

    <template v-if="st.settings.sttEngine === 'whisper'">
      <div class="s-row">
        <span>Адрес сервера</span>
        <input v-model.trim="st.settings.whisperEndpoint" type="text" />
      </div>
      <div class="s-row">
        <span>Модель</span>
        <input v-model.trim="st.settings.whisperModel" type="text" />
      </div>
      <div class="s-row">
        <span>Язык</span>
        <select v-model="st.settings.whisperLanguage">
          <option value="ru">Русский</option>
          <option value="en">English</option>
          <option value="auto">Определять сам</option>
        </select>
      </div>
      <div class="s-row">
        <span>Пауза = конец фразы ({{ (st.settings.whisperSilenceMs / 1000).toFixed(1) }} с)</span>
        <input v-model.number="st.settings.whisperSilenceMs" type="range" min="500" max="3000" step="100" />
      </div>
      <button class="s-btn" :disabled="checkingStt" @click="checkWhisper">{{ checkingStt ? 'Проверяю…' : '🎙️ Проверить Whisper' }}</button>
      <span v-if="sttStatus" class="s-status" :class="sttStatus.ok ? 'ok' : 'bad'">{{ sttStatus.text }}</span>
      <p class="s-hint">
        Нужен запущенный сервер Whisper с OpenAI-совместимым API (запрос <code>POST …/audio/transcriptions</code>):
        например speaches (faster-whisper-server), whisper.cpp server или LocalAI. Адрес — до <code>/v1</code>; если у
        сервера метод называется иначе (у whisper.cpp — <code>/inference</code>), впиши полный адрес. «Модель» —
        имя модели на сервере (whisper.cpp её игнорирует). Запись сама заканчивается после паузы; нажми на микрофон ещё раз,
        чтобы закончить раньше.
      </p>
    </template>
    <p v-else-if="!inputSupported" class="s-hint">В этой сборке Electron браузерное распознавание речи недоступно — выбери Whisper.</p>
    <p v-else class="s-hint">
      Браузерное распознавание идёт через облако Google и в Electron чаще всего отвечает «network». Если так — переключись на Whisper.
    </p>

    <div class="s-section">Озвучка ответов</div>
    <div class="s-row">
      <span>Озвучивать ответы</span>
      <label class="switch"><input v-model="st.settings.enableVoiceOutput" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div class="s-row">
      <span>Движок</span>
      <select v-model="st.settings.ttsEngine">
        <option value="browser">Системный голос</option>
        <option value="chatterbox">Chatterbox (нейро-голос, локально)</option>
        <option value="elevenlabs">ElevenLabs (облако, платно)</option>
        <option value="cartesia">Cartesia (облако, платно)</option>
      </select>
    </div>
    <div class="s-row">
      <span>Липсинк (рот в такт речи)</span>
      <label class="switch"><input v-model="st.settings.lipSync" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div v-if="st.settings.lipSync" class="s-row">
      <span>Размах рта ({{ Math.round(st.settings.lipSyncGain * 100) }}%)</span>
      <input v-model.number="st.settings.lipSyncGain" type="range" min="0.3" max="1.5" step="0.05" />
    </div>
    <p v-if="st.settings.lipSync" class="s-hint">
      С Chatterbox, ElevenLabs и Cartesia рот следует за самим звуком (громкость и «яркость»), с системным голосом — за текстом и темпом речи.
      Это приближение, а не точное распознавание звуков: ритм и открытие рта совпадают, форма гласных — примерно.
      Если рот у твоей модели открывается слишком широко, уменьши размах.
    </p>

    <div class="s-section">Голос {{ name }}</div>
    <div class="s-presets">
      <button v-for="p in VOICE_PRESETS" :key="p.id" class="s-btn" :title="p.hint" @click="applyPreset(p)">{{ p.label }}</button>
    </div>
    <p class="s-hint">Пресет меняет скорость, тон и выразительность. У NEKO и ARIA голоса настраиваются отдельно.</p>

    <template v-if="st.settings.ttsEngine === 'browser'">
      <div class="s-row">
        <span>Голос</span>
        <select v-model="v.voiceName">
          <option value="">Авто (русский женский)</option>
          <option v-for="vo in voices" :key="vo.name" :value="vo.name">{{ vo.name }} ({{ vo.lang }})</option>
        </select>
      </div>
      <div class="s-row">
        <span>Скорость ({{ v.rate.toFixed(2) }})</span>
        <input v-model.number="v.rate" type="range" min="0.6" max="1.6" step="0.02" />
      </div>
      <div class="s-row">
        <span>Тон ({{ v.pitch.toFixed(2) }})</span>
        <input v-model.number="v.pitch" type="range" min="0.5" max="1.8" step="0.02" />
      </div>
      <p class="s-hint">
        Системные голоса Windows звучат «роботно»; тон выше 1.2 даёт более «аниме»-подачу. Для настоящего аниме-голоса
        используй Chatterbox с образцом голоса.
      </p>
    </template>

    <!-- ElevenLabs / Cartesia -->
    <template v-else-if="cloudEngine">
      <div class="s-row">
        <span>API-ключ {{ cloudLabel }}</span>
        <input v-model.trim="apiKey" :type="showKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" placeholder="ключ" />
      </div>
      <div class="s-row">
        <span>Показать ключ</span>
        <label class="switch"><input v-model="showKey" type="checkbox" /><span class="slider"></span></label>
      </div>
      <p class="s-hint">
        Где взять ключ:
        <a :href="cloudKeyUrl" target="_blank" rel="noopener noreferrer">{{ cloudKeyUrl }}</a>
      </p>
      <div class="s-row">
        <span>Модель</span>
        <input v-model.trim="model" type="text" list="neko-tts-models" />
        <datalist id="neko-tts-models"><option v-for="m in modelHints" :key="m" :value="m" /></datalist>
      </div>
      <div class="s-row">
        <span>Язык озвучки</span>
        <input v-model.trim="st.settings.ttsLanguage" type="text" list="neko-tts-langs" placeholder="ru" />
        <datalist id="neko-tts-langs"><option v-for="l in ['ru', 'en', 'ja', 'ko', 'zh', 'de', 'fr', 'es', 'it', 'pt']" :key="l" :value="l" /></datalist>
      </div>
      <div class="s-row">
        <span>ID голоса {{ name }}</span>
        <input v-model.trim="voiceId" type="text" spellcheck="false" placeholder="вставь ID или загрузи список" />
      </div>
      <button class="s-btn" :disabled="loadingVoices" @click="loadCloudVoices">
        {{ loadingVoices ? 'Загружаю…' : '🔄 Загрузить голоса' }}
      </button>
      <div v-if="cloudVoices.length" class="s-row">
        <span>Выбрать из списка</span>
        <select :value="voiceId" @change="voiceId = ($event.target as HTMLSelectElement).value">
          <option value="" disabled>— выбери голос —</option>
          <option v-for="vo in cloudVoices" :key="vo.id" :value="vo.id">{{ vo.name }}{{ vo.language ? ` (${vo.language})` : '' }}</option>
        </select>
      </div>
      <span v-if="voicesError" class="s-status bad">{{ voicesError }}</span>
      <div class="s-row">
        <span>Скорость ({{ v.rate.toFixed(2) }})</span>
        <input v-model.number="v.rate" type="range" min="0.7" max="1.2" step="0.02" />
      </div>
      <p class="s-hint">
        Облачная озвучка платная (по символам), а текст ответов уходит на серверы {{ cloudLabel }}. Ключ хранится только на этом
        компьютере (без шифрования). Голос у NEKO и ARIA свой — у каждой окно настроек со своим ID. Если облако недоступно
        или ключ не подошёл, озвучка автоматически переходит на системный голос.
      </p>
    </template>

    <template v-else>
      <div class="s-row">
        <span>Адрес сервера</span>
        <input v-model.trim="st.settings.chatterboxEndpoint" type="text" />
      </div>
      <div class="s-row">
        <span>Образец голоса</span>
        <input v-model.trim="v.chatterboxVoice" type="text" />
      </div>
      <div class="s-row">
        <span>Эмоциональность ({{ v.exaggeration.toFixed(2) }})</span>
        <input v-model.number="v.exaggeration" type="range" min="0.25" max="1.5" step="0.05" />
      </div>
      <div class="s-row">
        <span>Темп ({{ v.cfgWeight.toFixed(2) }})</span>
        <input v-model.number="v.cfgWeight" type="range" min="0.1" max="1" step="0.05" />
      </div>
      <div class="s-row">
        <span>Живость интонации ({{ v.temperature.toFixed(2) }})</span>
        <input v-model.number="v.temperature" type="range" min="0.1" max="1.2" step="0.05" />
      </div>
      <p class="s-hint">
        Сам тембр задаёт образец: загрузи в библиотеку голосов своего Chatterbox-сервера 10–20 секунд чистой речи
        нужного голоса (свою запись или голос, который ты вправе использовать) под именем, например, «{{ name.toLowerCase() }}»,
        и впиши это имя выше. «Темп» ниже — быстрее и живее речь; «Эмоциональность» выше — театральнее интонации.
      </p>
      <p class="s-hint">
        Если Chatterbox недоступен, озвучка автоматически переходит на системный голос и минуту не пытается достучаться до сервера.
      </p>
    </template>

    <button class="s-btn" @click="test">🔊 Проверить голос</button>
    <p v-if="note" class="s-hint">{{ note }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { speechOutput } from '@shared/services/speechOutput'
import { describeTtsError, listCloudVoices, type CloudVoice } from '@shared/services/cloudTts'
import { speechInputSupported } from '@shared/services/speechInput'
import { describeWhisperError, whisperAvailable } from '@shared/services/whisper'
import { useSettingsForm } from './useSettingsForm'
import { currentPersona, personaTitle } from '@shared/persona'
import { VOICE_PRESETS, type VoicePreset } from '@shared/services/voicePresets'

const { st } = useSettingsForm()
const persona = currentPersona()
const name = personaTitle(persona)
/** Профиль голоса того, чьё это окно: NEKO или ARIA */
const v = computed(() => st.settings.voices[persona])

/** Пресет задаёт скорость, тон и выразительность; выбранный голос и образец Chatterbox остаются как есть */
const applyPreset = (p: VoicePreset) => {
  const { rate, pitch, exaggeration, cfgWeight, temperature } = p.profile
  Object.assign(st.settings.voices[persona], { rate, pitch, exaggeration, cfgWeight, temperature })
}
/* ── ElevenLabs / Cartesia ── */
const cloudEngine = computed(() => (st.settings.ttsEngine === 'elevenlabs' || st.settings.ttsEngine === 'cartesia' ? st.settings.ttsEngine : null))
const cloudLabel = computed(() => (cloudEngine.value === 'elevenlabs' ? 'ElevenLabs' : 'Cartesia'))
const cloudKeyUrl = computed(() => (cloudEngine.value === 'elevenlabs' ? 'https://elevenlabs.io/app/settings/api-keys' : 'https://play.cartesia.ai/keys'))
const modelHints = computed(() =>
  cloudEngine.value === 'elevenlabs'
    ? ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3']
    : ['sonic-3.6', 'sonic-3.5', 'sonic-3', 'sonic-latest']
)
const showKey = ref(false)
const cloudVoices = ref<CloudVoice[]>([])
const loadingVoices = ref(false)
const voicesError = ref('')

/** Поля зависят от выбранного движка: ключ и модель общие, ID голоса — свой у каждой персоны */
const apiKey = computed({
  get: () => (cloudEngine.value === 'elevenlabs' ? st.settings.elevenlabsApiKey : st.settings.cartesiaApiKey),
  set: (x: string) => { if (cloudEngine.value === 'elevenlabs') st.settings.elevenlabsApiKey = x; else st.settings.cartesiaApiKey = x },
})
const model = computed({
  get: () => (cloudEngine.value === 'elevenlabs' ? st.settings.elevenlabsModel : st.settings.cartesiaModel),
  set: (x: string) => { if (cloudEngine.value === 'elevenlabs') st.settings.elevenlabsModel = x; else st.settings.cartesiaModel = x },
})
const voiceId = computed({
  get: () => (cloudEngine.value === 'elevenlabs' ? v.value.elevenlabsVoiceId : v.value.cartesiaVoiceId),
  set: (x: string) => { if (cloudEngine.value === 'elevenlabs') v.value.elevenlabsVoiceId = x; else v.value.cartesiaVoiceId = x },
})

const loadCloudVoices = async () => {
  const engine = cloudEngine.value
  if (!engine) return
  loadingVoices.value = true
  voicesError.value = ''
  try {
    cloudVoices.value = await listCloudVoices(engine, { apiKey: apiKey.value, endpoint: engine === 'elevenlabs' ? st.settings.elevenlabsEndpoint : undefined })
    if (!cloudVoices.value.length) voicesError.value = 'Список голосов пуст — вставь ID голоса вручную.'
  } catch (e) {
    cloudVoices.value = []
    voicesError.value = describeTtsError(e, engine) || 'Не удалось получить список голосов.'
  } finally {
    loadingVoices.value = false
  }
}

const inputSupported = speechInputSupported()
const voices = ref<SpeechSynthesisVoice[]>([])
const note = ref('')
const checkingStt = ref(false)
const sttStatus = ref<{ ok: boolean; text: string } | null>(null)

const checkWhisper = async () => {
  checkingStt.value = true
  sttStatus.value = null
  const s = st.settings
  try {
    await whisperAvailable({ endpoint: s.whisperEndpoint, model: s.whisperModel, language: s.whisperLanguage })
    sttStatus.value = { ok: true, text: '✓ Сервер Whisper отвечает' }
  } catch (e) {
    sttStatus.value = { ok: false, text: '✗ ' + describeWhisperError(e, s.whisperEndpoint) }
  }
  checkingStt.value = false
}

const loadVoices = () => {
  const list = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []
  // русские голоса — наверх
  voices.value = [...list].sort((a, b) => Number(b.lang.startsWith('ru')) - Number(a.lang.startsWith('ru')))
}

onMounted(() => {
  loadVoices()
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener('voiceschanged', loadVoices)
})
onBeforeUnmount(() => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener('voiceschanged', loadVoices)
})

const test = async () => {
  if (!st.settings.enableVoiceOutput) {
    note.value = 'Озвучка выключена — включи переключатель выше.'
    return
  }
  note.value = ''
  const error = await speechOutput.test(persona === 'aria' ? 'Голосовой модуль на связи. Это ARIA. Чем могу помочь?' : 'Привет! Это я, Неко. Ну и как тебе мой голос? Мяу~')
  if (error) note.value = `${error} Пока играет системный голос.`
}
</script>
