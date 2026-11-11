// src/shared/plugins/translator.ts
// MyMemory (бесплатно, без ключа). Раньше язык источника был 'auto' — такого значения API не знает,
// а «переведи привет на английский» превращалось в перевод всей фразы целиком.

import type { Plugin, PluginContext } from '@shared/types'
import { fetchJson, hasCyrillic, type FetchLike } from './netUtil'

const LANGS: [stem: string, code: string][] = [
  ['русск', 'ru'], ['англ', 'en'], ['немец', 'de'], ['герман', 'de'], ['француз', 'fr'], ['франц', 'fr'],
  ['испанск', 'es'], ['итальян', 'it'], ['японск', 'ja'], ['китайск', 'zh-CN'], ['корейск', 'ko'],
  ['украинск', 'uk'], ['польск', 'pl'], ['турецк', 'tr'], ['португальск', 'pt'], ['арабск', 'ar'],
  ['чешск', 'cs'], ['шведск', 'sv'], ['греческ', 'el'], ['латин', 'la'], ['хинди', 'hi'],
]

const LANG_NAMES: Record<string, string> = {
  ru: 'русский', en: 'английский', de: 'немецкий', fr: 'французский', es: 'испанский', it: 'итальянский',
  ja: 'японский', 'zh-CN': 'китайский', ko: 'корейский', uk: 'украинский', pl: 'польский', tr: 'турецкий',
  pt: 'португальский', ar: 'арабский', cs: 'чешский', sv: 'шведский', el: 'греческий', la: 'латинский', hi: 'хинди',
}

export function langCode(word: string | undefined): string | null {
  if (!word) return null
  const w = word.toLowerCase().replace(/^по-/, '')
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(w)) return w
  for (const [stem, code] of LANGS) if (w.startsWith(stem)) return code
  return null
}

export interface TranslateRequest { text: string; from: string; to: string }

const LW = '[\\p{L}-]+'

/** Разбирает фразу-просьбу о переводе. null — это не просьба о переводе. */
export function parseTranslateRequest(input: string): TranslateRequest | null {
  const s = input.trim().replace(/\s+/g, ' ')
  if (s.length > 600) return null

  let from: string | null = null
  let to: string | null = null
  let text = ''
  let m: RegExpExecArray | null

  // «переведи с английского на русский: hello»
  if ((m = new RegExp(`^переведи(?:те)?\\s+с\\s+(${LW})\\s+на\\s+(${LW})\\s*[:\\-—]?\\s*(.+)$`, 'iu').exec(s))) {
    from = langCode(m[1]); to = langCode(m[2]); text = m[3]
    if (!from || !to) return null
  }
  // «переведи на английский: привет» / «переведи на английский привет как дела»
  else if ((m = new RegExp(`^переведи(?:те)?\\s+на\\s+(${LW})\\s*[:\\-—]?\\s*(.+)$`, 'iu').exec(s)) && langCode(m[1])) {
    to = langCode(m[1]); text = m[2]
  }
  // «переведи привет на английский»
  else if ((m = new RegExp(`^переведи(?:те)?\\s+(.+?)\\s+на\\s+(${LW})$`, 'iu').exec(s)) && langCode(m[2])) {
    text = m[1]; to = langCode(m[2])
  }
  // «как будет привет по-английски» / «как сказать спасибо на японском»
  else if ((m = new RegExp(`^как\\s+(?:будет|сказать|по-?)\\s+(.+?)\\s+(?:по-|на\\s+)(${LW})\\??$`, 'iu').exec(s)) && langCode(m[2])) {
    text = m[1]; to = langCode(m[2])
  }
  // «переведи привет» — без языка
  else if ((m = /^переведи(?:те)?\s*[:\-—]?\s*(.+)$/iu.exec(s))) {
    text = m[1]
  } else return null

  text = text.replace(/^["«“']+|["»”']+$/g, '').trim()
  if (!text) return null

  const cyr = hasCyrillic(text)
  if (!from) from = cyr ? (/[їєіґ]/i.test(text) ? 'uk' : 'ru') : 'en'
  if (!to) to = cyr ? 'en' : 'ru'
  if (from === to) to = from === 'ru' ? 'en' : 'ru'
  return { text, from, to }
}

export class TranslatorPlugin implements Plugin {
  name = 'Переводчик'
  description = 'Перевод текста на разные языки'
  icon = '🌍'

  constructor(private fetchFn?: FetchLike) {}

  matches(input: string): boolean {
    return parseTranslateRequest(input) !== null
  }

  async execute(input: string, ctx?: PluginContext): Promise<string> {
    const req = parseTranslateRequest(input)
    if (!req) return ''
    try {
      const translated = await translateText(req.text, req.from, req.to, ctx?.signal, this.fetchFn)
      return (
        `🌍 **Перевод** (${LANG_NAMES[req.from] ?? req.from} → ${LANG_NAMES[req.to] ?? req.to})\n\n` +
        `> ${req.text}\n\n**${translated}**\n\n*Мяу~ Я знаю много языков!* 🌟`
      )
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      return 'Извини, не смогла перевести сейчас… Попробуй позже! 💙'
    }
  }
}

/** Общая функция перевода (используется и генератором картинок) */
export async function translateText(
  text: string,
  from: string,
  to: string,
  signal?: AbortSignal,
  fetchFn?: FetchLike
): Promise<string> {
  // MyMemory принимает до ~500 байт на запрос
  const q = text.length > 450 ? text.slice(0, 450) : text
  const data = await fetchJson<any>(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(from + '|' + to)}`,
    { signal, fetchFn, timeoutMs: 8000 }
  )
  const status = Number(data?.responseStatus)
  const out: string | undefined = data?.responseData?.translatedText
  if (status !== 200 || !out) throw new Error(data?.responseDetails || 'translate failed')
  return out
}
