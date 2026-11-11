// src/shared/services/whisperInput.ts
// Голосовой ввод через Whisper с тем же интерфейсом, что у браузерного SpeechInput:
// нажал → говоришь → пауза → текст сам уходит в чат.

import type { SpeechInputHandlers, VoiceInput } from './speechInput'
import { VoiceRecorder, RecorderError, recorderSupported, type RecordedSpeech, type RecorderHooks } from './voiceRecorder'
import { describeWhisperError, transcribe, WhisperError, type WhisperConfig } from './whisper'
import type { VadOptions } from './whisper'

export interface WhisperInputConfig {
  whisper: WhisperConfig
  silenceMs: number
}

/** Что умеет запись (в тестах подменяется) */
export interface RecorderLike {
  readonly active: boolean
  record(vad: VadOptions, hooks?: RecorderHooks): Promise<RecordedSpeech | null>
  stop(): void
}

export interface WhisperInputDeps {
  recorder?: RecorderLike
  supported?: () => boolean
  transcribe?: typeof transcribe
}

/** Короче этого — случайный звук, а не фраза */
const MIN_SECONDS = 0.35

/** Имена помогают Whisper не превращать «Неко» в «нет ко» */
export const whisperPromptFor = (persona: 'neko' | 'aria'): string => (persona === 'aria' ? 'Ария, ARIA.' : 'Неко, NEKO.')

export class WhisperInput implements VoiceInput {
  private recorder: RecorderLike
  private supported: () => boolean
  private doTranscribe: typeof transcribe
  private ctl: AbortController | null = null
  private _active = false

  constructor(private getCfg: () => WhisperInputConfig, deps: WhisperInputDeps = {}) {
    this.recorder = deps.recorder ?? new VoiceRecorder()
    this.supported = deps.supported ?? recorderSupported
    this.doTranscribe = deps.transcribe ?? transcribe
  }

  get listening() { return this._active }

  start(h: SpeechInputHandlers): boolean {
    if (this._active || !this.supported()) return false
    this._active = true
    void this.run(h)
    return true
  }

  stop() {
    if (this.recorder.active) this.recorder.stop() // пока идёт запись — заканчиваем её и распознаём
    else this.abort()                              // уже распознаётся — отменяем
  }

  abort() {
    this.ctl?.abort()
    if (this.recorder.active) this.recorder.stop()
  }

  private async run(h: SpeechInputHandlers) {
    const cfg = this.getCfg()
    const ctl = new AbortController()
    this.ctl = ctl
    try {
      h.onState?.('listening')
      const speech = await this.recorder.record({ silenceMs: cfg.silenceMs })
      if (ctl.signal.aborted) return
      if (!speech || speech.seconds < MIN_SECONDS) {
        h.onError?.('no-speech', 'Ничего не услышала. Попробуй ещё раз.')
        return
      }
      h.onState?.('transcribing')
      const text = await this.doTranscribe(speech.wav, cfg.whisper, { signal: ctl.signal })
      if (ctl.signal.aborted) return
      if (!text) {
        h.onError?.('no-speech', 'Не разобрала, что было сказано. Попробуй ещё раз.')
        return
      }
      h.onFinal(text)
    } catch (e) {
      if (ctl.signal.aborted) return
      if (e instanceof RecorderError) h.onError?.(e.kind === 'denied' ? 'denied' : 'other', e.message)
      else h.onError?.(e instanceof WhisperError && e.kind !== 'empty' ? 'network' : 'other', describeWhisperError(e, cfg.whisper.endpoint))
    } finally {
      this._active = false
      this.ctl = null
      h.onEnd?.()
    }
  }
}
