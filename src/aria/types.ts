// src/aria/types.ts

/** Что сейчас делает ARIA — от этого зависит объектив, подпись и цвет акцента */
export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'offline'

/** Состояние модели ARIA: грузится / готова / файла нет (тогда показывается «объектив») */
export type AvatarStatus = 'loading' | 'ready' | 'missing'
