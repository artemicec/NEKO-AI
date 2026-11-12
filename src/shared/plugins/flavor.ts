// src/shared/plugins/flavor.ts
//
// Приписки плагинов зависят от того, кто отвечает. У NEKO в конце ответа — «Ня~», у ARIA характер другой: спокойный, без кошачьих повадок.
// Раньше «Ня~» и «Мяу~» были вшиты в сами плагины, и ARIA тоже мурлыкала после каждого ответа.

import { currentPersona, type Persona } from '@shared/persona'

/** Фирменная приписка NEKO (с отступом от ответа). У ARIA ничего не дописывается */
export const nekoSignoff = (text: string, persona: Persona = currentPersona()): string => (persona === 'neko' ? `\n\n${text}` : '')

/** Фраза по персонажу: первая — для NEKO, вторая — для ARIA */
export const byPersona = (neko: string, aria: string, persona: Persona = currentPersona()): string => (persona === 'aria' ? aria : neko)
