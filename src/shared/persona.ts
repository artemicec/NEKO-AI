// src/shared/persona.ts
// Какой ассистент сейчас запущен: NEKO или ARIA. Метка ставится на <html> при старте окна (см. main.ts).

export type Persona = 'neko' | 'aria'

export const currentPersona = (): Persona =>
  typeof document !== 'undefined' && document.documentElement?.dataset?.persona === 'aria' ? 'aria' : 'neko'

export const personaTitle = (p: Persona = currentPersona()) => (p === 'aria' ? 'ARIA' : 'NEKO')
