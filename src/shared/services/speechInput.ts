// src/shared/services/speechInput.ts
// Голосовой ввод (Web Speech API). Заменяет прежний SpeechService, который смешивал ввод и вывод
// (озвучка теперь целиком в speechOutput.ts).
//
// ВАЖНО: в Electron SpeechRecognition часто «есть», но при старте отвечает ошибкой network —
// движок использует облако Google, для которого у Electron нет ключей. Поэтому ошибки переводим
// на человеческий язык, а UI прячет микрофон, если API вообще отсутствует.

export type SpeechInputErrorKind = 'denied' | 'network' | 'no-speech' | 'other'

export interface SpeechInputHandlers {
  /** Для Whisper: «слушаю» → «распознаю»; браузерный движок состояний не сообщает */
  onState?: (state: 'listening' | 'transcribing') => void
  onInterim?: (text: string) => void
  onFinal: (text: string) => void
  onError?: (kind: SpeechInputErrorKind, message: string) => void
  onEnd?: () => void
}

const getCtor = (): (new () => any) | undefined =>
  typeof window === 'undefined' ? undefined : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

/** Общий вид источника голосового ввода: браузерный SpeechRecognition или Whisper */
export interface VoiceInput {
  readonly listening: boolean
  /** true — запись пошла; false — недоступно или не удалось стартовать */
  start(h: SpeechInputHandlers): boolean
  /** Закончить запись; то, что уже сказано, будет распознано */
  stop(): void
  /** Отменить всё, ничего не отправлять */
  abort(): void
}

export const speechInputSupported = (): boolean => !!getCtor()

export function describeSpeechError(code: string): { kind: SpeechInputErrorKind; message: string } | null {
  switch (code) {
    case 'aborted':
      return null // пользователь сам остановил — не ошибка
    case 'not-allowed':
    case 'service-not-allowed':
      return { kind: 'denied', message: 'Нет доступа к микрофону. Разреши его в настройках Windows (Конфиденциальность → Микрофон).' }
    case 'network':
      return {
        kind: 'network',
        message:
          'Браузерное распознавание речи в Electron не работает (оно идёт через облако Google). Включи Whisper: настройки → «Голос и звук» → «Движок ввода».',
      }
    case 'no-speech':
      return { kind: 'no-speech', message: 'Ничего не услышала. Попробуй ещё раз.' }
    case 'audio-capture':
      return { kind: 'denied', message: 'Микрофон не найден.' }
    default:
      return { kind: 'other', message: `Ошибка распознавания речи (${code}).` }
  }
}

export class SpeechInput implements VoiceInput {
  private rec: any = null
  private _listening = false

  get listening() { return this._listening }

  /** true — запись пошла; false — API недоступно или не удалось стартовать */
  start(h: SpeechInputHandlers, lang = 'ru-RU'): boolean {
    const Ctor = getCtor()
    if (!Ctor || this._listening) return false

    let finalText = ''
    let failed = false
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (ev: any) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        const t: string = r[0]?.transcript ?? ''
        if (r.isFinal) finalText += t
        else interim += t
      }
      if (interim) h.onInterim?.(interim)
    }
    rec.onerror = (ev: any) => {
      failed = true
      const d = describeSpeechError(String(ev?.error ?? 'unknown'))
      if (d) h.onError?.(d.kind, d.message)
    }
    rec.onend = () => {
      this._listening = false
      this.rec = null
      if (!failed && finalText.trim()) h.onFinal(finalText.trim())
      h.onEnd?.()
    }

    try {
      rec.start()
    } catch {
      return false
    }
    this.rec = rec
    this._listening = true
    return true
  }

  stop() {
    try { this.rec?.stop() } catch { /* уже остановлено */ }
  }

  abort() {
    try { this.rec?.abort() } catch { /* уже остановлено */ }
  }
}
