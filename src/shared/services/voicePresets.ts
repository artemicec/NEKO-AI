// src/shared/services/voicePresets.ts
// Готовые профили голоса. У NEKO и ARIA голоса разные: NEKO — звонкая и быстрая «аниме-кошка»,
// ARIA — спокойная ассистентка. Профиль хранится на каждую персону отдельно (см. AppSettings.voices).
//
// Параметры Chatterbox (работают, только если выбран движок Chatterbox):
//   exaggeration — «театральность» интонации (0.5 — обычная речь, 0.8+ — эмоциональная, как в аниме);
//   cfgWeight    — чем ниже, тем быстрее и живее темп (0.3 — подвижная речь, 0.5 — обычная, 1.0 — медленная и ровная);
//   temperature  — разнообразие интонаций (0.8 — стандарт, ниже — монотоннее).
// Параметры системного голоса: rate — скорость, pitch — высота тона.
// ElevenLabs/Cartesia: свой ID голоса на каждую персону (elevenlabsVoiceId / cartesiaVoiceId); rate = скорость речи.

import type { VoiceProfile } from '@shared/types'

export type VoicePersona = 'neko' | 'aria'

export interface VoicePreset {
  id: string
  label: string
  hint: string
  profile: VoiceProfile
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'neko',
    label: 'Аниме-кошка',
    hint: 'Звонкий, быстрый, эмоциональный — голос NEKO',
    profile: { voiceName: '', rate: 1.08, pitch: 1.3, chatterboxVoice: 'alloy', exaggeration: 0.85, cfgWeight: 0.3, temperature: 0.8, elevenlabsVoiceId: '', cartesiaVoiceId: '' },
  },
  {
    id: 'aria',
    label: 'Спокойная ассистентка',
    hint: 'Ровный, чуть холодный, уверенный — голос ARIA',
    profile: { voiceName: '', rate: 0.98, pitch: 1.1, chatterboxVoice: 'alloy', exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.7, elevenlabsVoiceId: '', cartesiaVoiceId: '' },
  },
  {
    id: 'plain',
    label: 'Нейтральный',
    hint: 'Как раньше: ровная речь без выражения',
    profile: { voiceName: '', rate: 1, pitch: 1, chatterboxVoice: 'alloy', exaggeration: 0.25, cfgWeight: 1, temperature: 0.05, elevenlabsVoiceId: '', cartesiaVoiceId: '' },
  },
]

const byId = (id: string) => VOICE_PRESETS.find((p) => p.id === id)!

/** Профиль по умолчанию для персоны (копия — менять можно свободно) */
export const defaultVoice = (persona: VoicePersona): VoiceProfile => ({ ...byId(persona).profile })
