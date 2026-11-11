<template>
  <dl class="aria-telemetry">
    <div class="tm-row">
      <dt>Связь</dt>
      <dd :class="linkClass">{{ linkText }}</dd>
    </div>
    <div class="tm-row">
      <dt>Модель</dt>
      <dd :class="{ warn: modelMissing }" :title="modelMissing ? 'Этой модели нет среди установленных в Ollama' : model">
        {{ model }}
      </dd>
    </div>
    <div class="tm-row">
      <dt>Первый токен</dt>
      <dd>
        <span class="tm-num">{{ formatLatency(firstTokenMs) }}</span>
        <span v-if="bars.length > 1" class="tm-spark" title="Последние ответы: чем ниже столбик, тем быстрее">
          <i v-for="(h, i) in bars" :key="i" :style="{ height: h + '%' }"></i>
        </span>
      </dd>
    </div>
    <div class="tm-row">
      <dt>Контекст</dt>
      <dd><span class="tm-num">{{ contextUsed }}</span> из {{ contextLimit }}</dd>
    </div>
    <div class="tm-row">
      <dt>Озвучка</dt>
      <dd>{{ voice ? 'включена' : 'выключена' }}</dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ProviderId } from '@shared/types'
import { providerLabel } from '@shared/services/providers'
import type { LinkStatus } from '../composables/useLink'
import { formatLatency } from '../format'

const props = defineProps<{
  link: LinkStatus
  provider: ProviderId
  model: string
  modelMissing: boolean
  firstTokenMs: number | null
  history: number[]
  contextUsed: number
  contextLimit: number
  voice: boolean
}>()

const providerName = computed(() => providerLabel(props.provider))

const linkText = computed(() => {
  if (props.provider !== 'ollama') return `${providerName.value}, облако`
  if (props.link === 'checking') return 'проверяю…'
  return props.link === 'online' ? `${providerName.value} на связи` : `${providerName.value} не отвечает`
})
const linkClass = computed(() => ({ ok: props.link === 'online', bad: props.link === 'offline' }))

/** Высота столбиков — относительно самого медленного из последних ответов (не ниже 12%, чтобы был виден) */
const bars = computed(() => {
  const h = props.history
  const max = Math.max(...h, 1)
  return h.map((v) => Math.max(12, Math.round((v / max) * 100)))
})
</script>
