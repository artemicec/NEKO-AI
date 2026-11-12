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
        <div v-if="i.command || i.help || (i.action && hasApp)" class="act">
          <button v-if="i.action && hasApp" class="s-btn" :disabled="dl.busy" @click="i.action && downloadVrm(i.action.path)">
            {{ dl.busy ? `Скачиваю… ${dl.mb} МБ` : '⬇️ Скачать образец VRM' }}
          </button>
          <button v-if="i.action && hasApp" class="s-btn" @click="openModels">📁 Папка моделей</button>
          <button v-if="i.command" class="s-btn" @click="copy(i.command ?? '')">{{ copied === i.command ? 'Скопировано ✓' : `Копировать: ${i.command}` }}</button>
          <a v-if="i.help" :href="i.help.url" target="_blank" rel="noopener noreferrer">{{ i.help.label }} ↗</a>
        </div>
        <div v-if="i.action && dl.message" class="dl-msg" :class="dl.ok ? 'ok' : 'bad'">
          {{ dl.message }}
          <a v-if="dl.licenseUrl" :href="dl.licenseUrl" target="_blank" rel="noopener noreferrer">Условия использования ↗</a>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
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

/* ── образец VRM: скачивание выполняет главный процесс (папка моделей — userData/models; при запуске из исходников в dev — public/models) ── */
const hasApp = !!window.electronAPI
const dl = reactive({ busy: false, mb: '0', message: '', ok: false, licenseUrl: '' })
let offProgress: (() => void) | null = null

async function downloadVrm(path: string) {
  if (dl.busy || !window.electronAPI) return
  dl.busy = true; dl.mb = '0'; dl.message = ''; dl.licenseUrl = ''
  try {
    const r = (await window.electronAPI.invoke('models:download', path)) as
      { ok?: boolean; error?: string; bytes?: number; path?: string; license?: string; licenseUrl?: string; verified?: boolean } | undefined
    dl.ok = !!r?.ok
    if (r?.ok) {
      dl.message = `Скачано (${((r.bytes ?? 0) / 1048576).toFixed(1)} МБ): ${r.path ?? ''}. ${r.license ?? ''}`.trim()
      dl.licenseUrl = r.licenseUrl ?? ''
      await refresh()
    } else {
      dl.message = r?.error || 'Не удалось скачать. Положи .vrm в папку моделей вручную.'
    }
  } catch (e) {
    dl.ok = false
    dl.message = `Не удалось скачать: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    dl.busy = false
  }
}

async function openModels() {
  try {
    const r = (await window.electronAPI?.invoke('models:open-folder')) as { ok?: boolean; dir?: string; error?: string } | undefined
    if (r && !r.ok) { dl.ok = false; dl.message = `Не удалось открыть папку: ${r.error ?? ''} (${r.dir ?? ''})` }
  } catch { /* окно не в приложении — кнопки там нет */ }
}

const done = () => { st.settings.setupCompleted = true; void window.electronAPI?.invoke('close-self') }

onMounted(() => {
  offProgress = window.electronAPI?.on('models:progress', (p: { received?: number }) => { dl.mb = ((p?.received ?? 0) / 1048576).toFixed(1) }) ?? null
  void refresh()
})
onBeforeUnmount(() => offProgress?.())
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
.dl-msg { margin-top: 8px; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.dl-msg.ok { color: #5fd38d; }
.dl-msg.bad { color: var(--danger); }
.dl-msg a { color: inherit; text-decoration: underline; margin-left: 6px; }
.det { margin-top: 4px; font-size: 12px; line-height: 1.45; color: var(--text-muted); }
.act { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12px; }
.act a { color: inherit; text-decoration: underline; }
</style>
