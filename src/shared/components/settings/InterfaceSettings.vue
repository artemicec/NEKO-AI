<template>
  <div class="s-page">
    <div class="s-row">
      <span>Тема</span>
      <select v-model="st.settings.theme">
        <option value="dark">Тёмная</option>
        <option value="light">Светлая</option>
      </select>
    </div>
    <div class="s-row">
      <span>Прозрачность окон ({{ Math.round(st.settings.windowOpacity * 100) }}%)</span>
      <input v-model.number="st.settings.windowOpacity" type="range" min="0.5" max="1" step="0.05" />
    </div>
    <p class="s-hint">Прозрачность применяется к окнам чата, настроек и дневника. Тема меняется сразу во всех окнах.</p>

    <div class="s-section">Система</div>
    <div class="s-row">
      <span>Запускать вместе с Windows</span>
      <label class="switch">
        <input type="checkbox" :checked="autoStart" @change="toggleAutoStart" /><span class="slider"></span>
      </label>
    </div>
    <div class="s-row">
      <span>Значок в трее</span>
      <label class="switch"><input v-model="st.settings.trayEnabled" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div class="s-row">
      <span>Закрытие прячет в трей</span>
      <label class="switch">
        <input v-model="st.settings.closeToTray" type="checkbox" :disabled="!st.settings.trayEnabled" /><span class="slider"></span>
      </label>
    </div>
    <p class="s-hint">
      Пока приложение в трее, оно работает: напоминания сработают, дневник запишется. Совсем закрыть — правой кнопкой по значку → «Выход».
    </p>

    <div class="s-section">Напоминания</div>
    <div class="s-row">
      <span>Команда «напомни мне…»</span>
      <label class="switch"><input v-model="st.settings.remindersEnabled" type="checkbox" /><span class="slider"></span></label>
    </div>
    <p class="s-hint">
      Примеры: «напомни через 10 минут выпить воды», «напомни завтра в 9 утра про встречу», «покажи напоминания», «отмени все напоминания».
      Сработавшее напоминание появляется окошком в правом нижнем углу экрана.
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSettingsForm } from './useSettingsForm'

const { st } = useSettingsForm()

const autoStart = ref(false)
onMounted(async () => {
  autoStart.value = !!(await window.electronAPI?.invoke('settings:getAutoStart'))
})
const toggleAutoStart = async (e: Event) => {
  const enable = (e.target as HTMLInputElement).checked
  autoStart.value = enable
  await window.electronAPI?.invoke('settings:setAutoStart', enable)
}
</script>
