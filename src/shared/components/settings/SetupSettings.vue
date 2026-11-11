<template>
  <div class="s-page">
    <p class="s-hint">
      Проверяю, что уже запущено на этом компьютере. Обязательна только нейросеть — остальное добавляет голос, картинки и аватар.
    </p>

    <div class="sum" :class="summary.ready ? 'ready' : 'wait'">
      <template v-if="checking && !items.length">Проверяю…</template>
      <template v-else-if="summary.ready">
        ✅ Всё нужное работает<span v-if="summary.optionalMissing"> · необязательного не хватает: {{ summary.optionalMissing }}</span>
      </template>
      <template v-else>⛔ Не хватает обязательного: {{ summary.blockers }}</template>
    </div>

    <ul class="items">
      <li v-for="i in items" :key="i.id" class="item" :class="i.level">
        <div class="head">
          <span class="ico">{{ levelIcon(i.level) }}</span>
          <span class="ttl">{{ i.title }}</span>
          <span v-if="i.required" class="req">нужно</span>
        </div>
        <div class="det">{{ i.detail }}</div>
        <div v-if="i.command || i.help" class="act">
          <button v-if="i.command" class="s-btn" @click="copy(i.command ?? '')">{{ copied === i.command ? 'Скопировано ✓' : `Копировать: ${i.command}` }}</button>
          <a v-if="i.help" :href="i.help.url" target="_blank" rel="noopener noreferrer">{{ i.help.label }} ↗</a>
        </div>
      </li>
    </ul>

    <div class="s-row">
      <button class="s-btn" :disabled="checking" @click="refresh">{{ checking ? 'Проверяю…' : '🔄 Проверить снова' }}</button>
      <button class="s-btn" @click="done">Готово</button>
    </div>
    <p class="s-hint">
      Подробные инструкции по установке — в файле <code>SETUP.md</code> проекта. Эту страницу можно открыть снова: «Настройки → Проверка и установка».
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { currentPersona } from '@shared/persona'
import { levelIcon, runSetupChecks, summarizeSetup, type SetupItem } from '@shared/services/setupChecks'

const st = useSettingsStore()
const items = ref<SetupItem[]>([])
const checking = ref(false)
const copied = ref('')
const summary = computed(() => summarizeSetup(items.value))

async function refresh() {
  if (checking.value) return
  checking.value = true
  try {
    // plain-копия: store — реактивный Proxy, а проверкам нужны только значения
    items.value = await runSetupChecks(JSON.parse(JSON.stringify(st.settings)), currentPersona())
  } finally {
    checking.value = false
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => { if (copied.value === text) copied.value = '' }, 1800)
  } catch { /* буфер недоступен — команда видна на кнопке, можно набрать руками */ }
}

const done = () => { st.settings.setupCompleted = true; void window.electronAPI?.invoke('close-self') }

onMounted(refresh)
</script>

<style scoped>
.sum { padding: 9px 12px; border-radius: 10px; font-size: 13px; background: var(--hover-bg); margin-bottom: 10px; }
.sum.ready { color: #5fd38d; }
.sum.wait { color: var(--danger); }
.items { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.item { padding: 10px 12px; border: 1px solid var(--panel-border); border-radius: 10px; }
.item.fail { border-color: var(--danger); }
.head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.ttl { flex: 1; }
.req { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 8px; background: var(--hover-bg); color: var(--text-muted); }
.det { margin-top: 4px; font-size: 12px; line-height: 1.45; color: var(--text-muted); }
.act { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12px; }
.act a { color: inherit; text-decoration: underline; }
</style>
