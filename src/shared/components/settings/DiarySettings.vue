<template>
  <div class="s-page">
    <div class="s-row">
      <span>Вести дневник</span>
      <label class="switch"><input v-model="st.settings.diaryEnabled" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div class="s-row">
      <span>Писать сама, когда мы замолчали</span>
      <label class="switch">
        <input v-model="st.settings.diaryAuto" type="checkbox" :disabled="!st.settings.diaryEnabled" /><span class="slider"></span>
      </label>
    </div>
    <div class="s-row">
      <span>Минимум сообщений для записи</span>
      <input
        type="number"
        min="2"
        max="200"
        :value="st.settings.diaryMinMessages"
        :disabled="!st.settings.diaryEnabled"
        @change="setNum('diaryMinMessages', $event, 2, 200)"
      />
    </div>
    <div class="s-row">
      <span>Пауза до записи (мин)</span>
      <input
        type="number"
        min="1"
        max="240"
        :value="st.settings.diaryIdleMinutes"
        :disabled="!st.settings.diaryEnabled"
        @change="setNum('diaryIdleMinutes', $event, 1, 240)"
      />
    </div>

    <div class="s-section">Воспоминания</div>
    <div class="s-row">
      <span>Вспоминать по дневнику</span>
      <label class="switch"><input v-model="st.settings.memoryEnabled" type="checkbox" /><span class="slider"></span></label>
    </div>
    <p class="s-hint">
      Когда спрашиваешь о прошлом — «помнишь, что мы делали в прошлый вторник?», «о чём мы говорили вчера?», «помнишь, как я рассказывал про кота?» —
      NEKO ищет в дневнике и в прошлой переписке и отвечает по найденному. Если ничего не нашла, так и скажет, а не выдумает.
      Поиск идёт по словам и датам (вчера, во вторник, 3 дня назад, 28 октября), не по смыслу. «Прошлый вторник» — вторник прошлой
      недели, а просто «во вторник» — ближайший прошедший; под ответом видно, какие дни она вспомнила. Работает только у NEKO.
    </p>

    <div class="s-section">Фотографии</div>
    <div class="s-row">
      <span>Селфи (снимок аватара)</span>
      <label class="switch">
        <input v-model="st.settings.diarySelfie" type="checkbox" :disabled="!st.settings.diaryEnabled" /><span class="slider"></span>
      </label>
    </div>
    <div class="s-row">
      <span>Рисовать иллюстрацию (SD)</span>
      <label class="switch">
        <input v-model="st.settings.diaryGenerateImage" type="checkbox" :disabled="!st.settings.diaryEnabled" /><span class="slider"></span>
      </label>
    </div>
    <p class="s-hint">
      Селфи делается с 3D-модели с выражением лица под настроение записи. Иллюстрацию рисует Stable Diffusion
      (адрес — в разделе «Картинки»); если он не запущен, запись просто остаётся без неё.
    </p>

    <button class="s-btn" @click="openDiary">📔 Открыть дневник</button>
  </div>
</template>

<script setup lang="ts">
import { useSettingsForm } from './useSettingsForm'
const { st, setNum } = useSettingsForm()
const openDiary = () => window.electronAPI?.invoke('open-diary-window')
</script>
