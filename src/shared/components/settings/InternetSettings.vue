<template>
  <div class="s-page">
    <div class="s-row">
      <span>Разрешить доступ в интернет</span>
      <label class="switch"><input v-model="st.settings.webEnabled" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div class="s-row">
      <span>Искать самой, если не хватает знаний</span>
      <label class="switch">
        <input v-model="st.settings.webAuto" type="checkbox" :disabled="!st.settings.webEnabled" /><span class="slider"></span>
      </label>
    </div>
    <div class="s-row">
      <span>Использовать Википедию</span>
      <label class="switch">
        <input v-model="st.settings.webWikipedia" type="checkbox" :disabled="!st.settings.webEnabled" /><span class="slider"></span>
      </label>
    </div>
    <div class="s-row">
      <span>Результатов поиска</span>
      <input
        type="number"
        min="2"
        max="8"
        :value="st.settings.webResults"
        :disabled="!st.settings.webEnabled"
        @change="setNum('webResults', $event, 2, 8)"
      />
    </div>

    <p class="s-hint">
      Как это работает: на вопросы вроде «кто такой…», «когда основан…», «сколько жителей…» и «курс доллара сегодня» поиск
      запускается сам. Если модель не уверена в ответе, она тоже просит поиск сама. А фразы «найди в интернете…»,
      «загугли…», «что в википедии про…» работают всегда, даже при выключенном автоматическом режиме.
    </p>
    <p class="s-hint">
      Что уходит в сеть: только короткая поисковая фраза — в Википедию и DuckDuckGo. Переписка, история и настройки никуда
      не отправляются. Под ответом показываются ссылки на источники.
    </p>

    <button class="s-btn" :disabled="checking || !st.settings.webEnabled" @click="check">
      {{ checking ? 'Проверяю…' : '🌐 Проверить интернет' }}
    </button>
    <div v-if="report.length" class="s-checks">
      <span v-for="r in report" :key="r.name" class="s-status" :class="r.ok ? 'ok' : 'bad'">{{ r.text }}</span>
    </div>
    <p class="s-hint">
      Поиск DuckDuckGo работает без ключей, но это неофициальный канал: при частых запросах он может ненадолго
      отказать — тогда ответ строится по Википедии или честно сообщает, что проверить не удалось.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { webLookup } from '@shared/services/webSearch'
import { useSettingsForm } from './useSettingsForm'

const { st, setNum } = useSettingsForm()
const checking = ref(false)
const report = ref<{ name: string; ok: boolean; text: string }[]>([])

const probe = async (name: string, parts: { wikipedia: boolean; web: boolean }, enabled = true) => {
  if (!enabled) return { name, ok: true, text: `${name}: выключена в настройках` }
  try {
    const r = await webLookup('Земля планета', { ...parts, results: 3, timeoutMs: 8000 })
    return r.results.length
      ? { name, ok: true, text: `✓ ${name}: работает (${r.results.length})` }
      : { name, ok: false, text: `✗ ${name}: ${r.errors[0] ?? 'ничего не нашлось'}` }
  } catch (e) {
    return { name, ok: false, text: `✗ ${name}: ${(e as Error).message}` }
  }
}

const check = async () => {
  checking.value = true
  report.value = []
  report.value = await Promise.all([
    probe('Википедия', { wikipedia: true, web: false }, st.settings.webWikipedia),
    probe('Поиск', { wikipedia: false, web: true }),
  ])
  checking.value = false
}
</script>

<style scoped>
.s-checks { display: flex; flex-direction: column; gap: 4px; }
</style>
