<template>
  <div class="s-page">
    <div class="s-section">Модель</div>
    <div class="s-row">
      <span>Файл .vrm</span>
      <input v-model.trim="st.settings[pathKey]" type="text" />
    </div>
    <p class="s-hint">
      Положи файл модели в папку <code>public/models</code> проекта и укажи путь, например <code>{{ example }}</code>.
      Новая модель подхватывается сразу, перезапуск не нужен.
      <template v-if="isAria">У ARIA своя модель, отличная от NEKO. Если файла нет, вместо неё показывается «объектив».</template>
    </p>

    <div class="s-section">Движение</div>
    <div class="s-row">
      <span>Авто-анимации</span>
      <label class="switch"><input v-model="st.settings.autoAnimate" type="checkbox" /><span class="slider"></span></label>
    </div>
    <div class="s-row">
      <span>Пауза между анимациями (сек)</span>
      <input
        type="number"
        min="5"
        max="300"
        :value="st.settings.animationPause"
        :disabled="!st.settings.autoAnimate"
        @change="setNum('animationPause', $event, 5, 300)"
      />
    </div>
    <p class="s-hint">
      После каждой анимации аватар возвращается в обычную позу и стоит в ней примерно столько секунд (с небольшим
      случайным разбросом), потом показывает следующую. Больше число — анимации реже. Пока аватар говорит, анимации не
      запускаются.
    </p>

    <div class="s-section">Производительность</div>
    <div class="s-row">
      <span>Лимит кадров (FPS)</span>
      <select v-model.number="st.settings.maxFps">
        <option :value="15">15 — экономия</option>
        <option :value="24">24</option>
        <option :value="30">30 — по умолчанию</option>
        <option :value="45">45</option>
        <option :value="60">60 — плавно</option>
      </select>
    </div>
    <p v-if="isAria" class="s-hint">
      Окно ARIA — обычное, поэтому можно ставить 45–60 кадров, если видеокарта справляется. Когда окно свёрнуто,
      отрисовка останавливается сама.
    </p>
    <p v-else class="s-hint">
      NEKO всегда лежит поверх окон, поэтому 60 кадров в секунду там почти не нужны — 30 заметно разгружают видеокарту.
      Когда окно свёрнуто, отрисовка останавливается сама.
    </p>
  </div>
</template>

<script setup lang="ts">
import { useSettingsForm } from './useSettingsForm'
import { currentPersona } from '@shared/persona'

const { st, setNum } = useSettingsForm()
const isAria = currentPersona() === 'aria'
/** У NEKO и ARIA модели разные */
const pathKey: 'ariaVrmModelPath' | 'vrmModelPath' = isAria ? 'ariaVrmModelPath' : 'vrmModelPath'
const example = isAria ? '/models/aria.vrm' : '/models/default.vrm'
</script>
