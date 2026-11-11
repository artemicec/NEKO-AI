<template>
  <div class="s-page">
    <div class="s-row">
      <span>Нейросеть</span>
      <select v-model="st.settings.provider" @change="onProviderChange">
        <optgroup label="Локально">
          <option value="ollama">Ollama (локально)</option>
        </optgroup>
        <optgroup label="В облаке (по ключу)">
          <option v-for="p in cloudList" :key="p.id" :value="p.id">{{ p.label }}</option>
        </optgroup>
      </select>
    </div>

    <!-- Ollama -->
    <template v-if="st.settings.provider === 'ollama'">
      <div class="s-row">
        <span>Адрес Ollama</span>
        <input v-model.trim="st.settings.ollamaEndpoint" type="text" />
      </div>
      <div class="s-row">
        <span>Модель</span>
        <input v-model.trim="st.settings.ollamaModel" type="text" list="neko-models" />
        <datalist id="neko-models"><option v-for="m in models" :key="m" :value="m" /></datalist>
      </div>
      <button class="s-btn" @click="refreshModels">🔄 Показать установленные модели ({{ models.length }})</button>

      <div class="s-section">Скорость ответа</div>
      <div class="s-row">
        <span>Держать модель в памяти</span>
        <input v-model.trim="st.settings.ollamaKeepAlive" type="text" placeholder="30m" />
      </div>
      <div class="s-row">
        <span>Контекст (токены)</span>
        <select v-model.number="st.settings.numCtx">
          <option v-for="n in ctxSizes" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="s-row">
        <span>Режим «размышлений»</span>
        <label class="switch"><input v-model="st.settings.ollamaThink" type="checkbox" /><span class="slider"></span></label>
      </div>
      <p class="s-hint">
        «Держать в памяти»: <code>30m</code>, <code>2h</code> или <code>-1</code> (всегда) — без этого Ollama выгружает модель
        через 5 минут и первый ответ грузится долго. Размер контекста лучше не менять часто: при смене Ollama перезагружает модель.
        «Размышления» у qwen/gemma-thinking сильно замедляют ответ — для болтовни держи выключенными.
      </p>
    </template>

    <!-- Облачные провайдеры -->
    <template v-else-if="cfg && preset">
      <div class="s-row">
        <span>API-ключ<template v-if="!preset.keyRequired"> (если нужен)</template></span>
        <input v-model.trim="cfg.apiKey" :type="showKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" placeholder="ключ" />
      </div>
      <div class="s-row">
        <span>Показать ключ</span>
        <label class="switch"><input v-model="showKey" type="checkbox" /><span class="slider"></span></label>
      </div>
      <p v-if="preset.keyUrl" class="s-hint">
        Где взять ключ: <a :href="preset.keyUrl" target="_blank" rel="noopener noreferrer">{{ preset.keyUrl }}</a>
      </p>
      <div class="s-row">
        <span>Адрес API</span>
        <input v-model.trim="cfg.endpoint" type="text" />
      </div>
      <button v-if="cfg.endpoint !== preset.endpoint" class="s-btn" @click="cfg.endpoint = preset.endpoint">↩ Адрес по умолчанию</button>
      <div class="s-row">
        <span>Модель</span>
        <input v-model.trim="cfg.model" type="text" list="neko-cloud-models" :placeholder="preset.id === 'custom' ? 'можно оставить пустой' : ''" />
        <datalist id="neko-cloud-models"><option v-for="m in models" :key="m" :value="m" /></datalist>
      </div>
      <button class="s-btn" :disabled="loadingModels" @click="loadCloudModels">
        {{ loadingModels ? 'Загружаю…' : `🔄 Список моделей (${models.length})` }}
      </button>
      <span v-if="modelsError" class="s-status bad">{{ modelsError }}</span>
      <p v-if="preset.hint" class="s-hint">{{ preset.hint }}</p>
      <p class="s-hint">
        Ключ хранится только на этом компьютере (в данных приложения, без шифрования) и уходит только на
        <code>{{ host }}</code>. Не публикуйте папку данных приложения и не присылайте её другим.
        Текст диалога отправляется выбранному провайдеру — для полностью локальной работы выберите Ollama.
      </p>
    </template>

    <div class="s-section">Генерация</div>
    <div class="s-row">
      <span>Макс. длина ответа (токены)</span>
      <input type="number" min="32" max="4096" :value="st.settings.maxTokens" @change="setNum('maxTokens', $event, 32, 4096)" />
    </div>
    <div class="s-row">
      <span>Креативность ({{ st.settings.temperature.toFixed(2) }})</span>
      <input v-model.number="st.settings.temperature" type="range" min="0" max="1.5" step="0.05" />
    </div>
    <div class="s-row">
      <span>Сообщений в памяти диалога</span>
      <input
        type="number"
        min="2"
        max="60"
        :value="st.settings.historyMessages"
        @change="setNum('historyMessages', $event, 2, 60)"
      />
    </div>
    <p class="s-hint">Чем короче ответ и меньше история, тем быстрее приходит ответ. 256 токенов — примерно 3–5 предложений.</p>

    <div class="s-section">Прочее</div>
    <div class="s-row">
      <span>Город по умолчанию (погода)</span>
      <input v-model.trim="st.settings.defaultCity" type="text" />
    </div>

    <button class="s-btn" :disabled="testing" @click="testConnection">{{ testing ? 'Проверяю…' : '🔌 Проверить подключение' }}</button>
    <span v-if="status" class="s-status" :class="status.ok ? 'ok' : 'bad'">{{ status.text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createProvider } from '@shared/services/aiFactory'
import { humanizeError } from '@shared/services/aiTypes'
import { CLOUD_PRESETS, CLOUD_PROVIDER_IDS, activeModel, isCloudProvider } from '@shared/services/providers'
import { useSettingsForm } from './useSettingsForm'

const { st, setNum } = useSettingsForm()
const ctxSizes = [2048, 4096, 8192, 16384, 32768]
const models = ref<string[]>([])
const testing = ref(false)
const loadingModels = ref(false)
const modelsError = ref('')
const showKey = ref(false)

const cloudList = CLOUD_PROVIDER_IDS.map((id) => CLOUD_PRESETS[id])
const cfg = computed(() => (isCloudProvider(st.settings.provider) ? st.settings.cloud[st.settings.provider] : null))
const preset = computed(() => (isCloudProvider(st.settings.provider) ? CLOUD_PRESETS[st.settings.provider] : null))
const host = computed(() => {
  try { return new URL(cfg.value?.endpoint ?? '').hostname } catch { return 'сервер провайдера' }
})

/** У каждого провайдера свой список моделей — при смене провайдера старый список не показываем */
const onProviderChange = () => {
  models.value = []
  modelsError.value = ''
  status.value = null
  if (st.settings.provider === 'ollama') void refreshModels()
}

const loadCloudModels = async () => {
  loadingModels.value = true
  modelsError.value = ''
  try {
    models.value = (await createProvider(st.settings).listModels?.()) ?? []
    if (!models.value.length) modelsError.value = 'Сервер не вернул список моделей — введи название вручную.'
  } catch (e) {
    models.value = []
    modelsError.value = humanizeError(e, { provider: st.settings.provider, ...activeModel(st.settings) }) || 'Не удалось получить список.'
  } finally {
    loadingModels.value = false
  }
}
const status = ref<{ ok: boolean; text: string } | null>(null)

const refreshModels = async () => {
  try {
    models.value = (await createProvider(st.settings).listModels?.()) ?? []
  } catch {
    models.value = []
  }
}

const testConnection = async () => {
  testing.value = true
  status.value = null
  try {
    const provider = createProvider(st.settings)
    const ok = await provider.checkConnection()
    if (ok && st.settings.provider === 'ollama') {
      await refreshModels()
      const has = models.value.includes(st.settings.ollamaModel)
      status.value = has
        ? { ok: true, text: `✓ Подключено, модель «${st.settings.ollamaModel}» найдена` }
        : { ok: false, text: `Ollama отвечает, но модели «${st.settings.ollamaModel}» нет. Выбери одну из установленных.` }
    } else {
      status.value = ok
        ? { ok: true, text: '✓ Подключено' }
        : { ok: false, text: st.settings.provider === 'ollama' ? '✗ Ollama не отвечает. Запущена ли она?' : '✗ Нет ответа. Проверь ключ, адрес и интернет.' }
    }
  } catch {
    status.value = { ok: false, text: '✗ Не удалось подключиться' }
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  if (st.settings.provider === 'ollama') void refreshModels()
})
</script>
