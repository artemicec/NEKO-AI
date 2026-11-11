<template>
  <div class="s-page">
    <div class="s-row">
      <span>Адрес Stable Diffusion</span>
      <input v-model.trim="st.settings.sdEndpoint" type="text" />
    </div>
    <div class="s-row">
      <span>Шагов</span>
      <input type="number" min="5" max="60" :value="st.settings.sdSteps" @change="setNum('sdSteps', $event, 5, 60)" />
    </div>
    <div class="s-row">
      <span>Ширина</span>
      <select v-model.number="st.settings.sdWidth">
        <option v-for="n in sizes" :key="n" :value="n">{{ n }}</option>
      </select>
    </div>
    <div class="s-row">
      <span>Высота</span>
      <select v-model.number="st.settings.sdHeight">
        <option v-for="n in sizes" :key="n" :value="n">{{ n }}</option>
      </select>
    </div>

    <div class="s-col">
      <span>Стиль (добавляется к каждому запросу)</span>
      <textarea v-model="st.settings.sdStylePrompt" class="s-textarea" rows="2"></textarea>
    </div>
    <div class="s-col">
      <span>Негативный промпт</span>
      <textarea v-model="st.settings.sdNegativePrompt" class="s-textarea" rows="3"></textarea>
    </div>

    <button class="s-btn" :disabled="checking" @click="check">{{ checking ? 'Проверяю…' : '🔌 Проверить подключение' }}</button>
    <span v-if="status" class="s-status" :class="status.ok ? 'ok' : 'bad'">{{ status.text }}</span>
    <p class="s-hint">
      Запусти Automatic1111 с параметрами <code>--api --cors-allow-origins=*</code>. Русские запросы автоматически
      переводятся на английский — Stable Diffusion их плохо понимает.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { sdAvailable } from '@shared/services/imageGenService'
import { useSettingsForm } from './useSettingsForm'

const { st, setNum } = useSettingsForm()
const sizes = [256, 320, 384, 448, 512, 576, 640, 704, 768, 896, 1024]
const checking = ref(false)
const status = ref<{ ok: boolean; text: string } | null>(null)

const check = async () => {
  checking.value = true
  status.value = null
  const ok = await sdAvailable(st.settings.sdEndpoint)
  status.value = ok
    ? { ok, text: '✓ Stable Diffusion отвечает' }
    : { ok, text: '✗ Не отвечает. Запущен ли A1111 с --api и верен ли адрес?' }
  checking.value = false
}
</script>
