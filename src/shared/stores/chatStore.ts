// src/shared/stores/chatStore.ts
//
// Главное изменение: ответ модели стримится в сообщение по мере генерации, а озвучка стартует
// на первом же предложении. Плюс: исправлено дублирование последней реплики пользователя в контексте,
// добавлены «Стоп»/перебивание, прогрев модели, сохранение истории на диск и человеческие сообщения об ошибках.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Message, PluginContext, WebSource } from '@shared/types'
import { PluginManager } from '@shared/services/pluginManager'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { memoryAPI } from '@shared/services/memoryClient'
import { createProvider } from '@shared/services/aiFactory'
import { activeModel } from '@shared/services/providers'
import { pickModel } from '@shared/services/ollamaService'
import { buildChatMessages, buildSystemPrompt, webContextBlock, withContextBlocks } from '@shared/services/promptBuilder'
import { recallMemories, type RecallChip } from '@shared/services/memoryRecall'
import { currentPersona } from '@shared/persona'
import { judgeStreamHead } from '@shared/services/webRouter'
import { safeInvoke, toPlain } from '@shared/services/ipcSafe'
import { AIError, errorFixes, humanizeError } from '@shared/services/aiTypes'
import { analyzeEmotion } from '@shared/services/emotion'
import { SentenceSplitter } from '@shared/services/sentenceSplitter'
import { speechOutput } from '@shared/services/speechOutput'
import { cleanForSpeech } from '@shared/services/speechText'

const raf: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(() => cb()) : (cb) => setTimeout(cb, 16)

const newId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`

type NewMessage = Omit<Message, 'id' | 'timestamp'> & Partial<Pick<Message, 'id' | 'timestamp'>>

/** Данные из интернета для одного ответа */
interface WebAnswer { query: string; context: string; sources: WebSource[] }

/** Воспоминания для одного ответа (блок для модели и подписи под ответом) */
interface RecallAnswer { block: string; chips: RecallChip[] }

interface ReplyOptions {
  /** Воспоминания из дневника и прошлой переписки (вопрос о прошлом) */
  recall?: RecallAnswer
  /** Модель может ответить служебной строкой [[WEB: запрос]] — «не знаю, поищи» (первый проход) */
  allowWebRequest?: boolean
  /** Данные, по которым надо ответить (ответ после поиска) */
  web?: WebAnswer
}

/** Если модель попросила поиск, ответа ещё нет: вызывающий ищет и просит ответить заново */
type ReplyOutcome = { webQuery: string } | null

const WEB_OFF_TEXT = '🌐 Интернет выключен в настройках. Включи «Интернет → Разрешить доступ в интернет» — и я поищу.'
const WEB_AGAIN_TEXT = 'Не получилось ответить по найденным данным. Попробуй переформулировать вопрос.'

export const useChatStore = defineStore('chat', () => {
  const messages = ref<Message[]>([])
  const isProcessing = ref(false)
  const systemPrompt = ref<string>('') // устанавливается снаружи (NEKO_PROMPT / ARIA_PROMPT)
  const historyLoaded = ref(false)
  const pluginManager = new PluginManager()

  /** Реальные замеры последних ответов — их показывает телеметрия ARIA */
  const metrics = ref<{ firstTokenMs: number | null; totalMs: number | null; history: number[] }>({
    firstTokenMs: null,
    totalMs: null,
    history: [],
  })
  const HISTORY_KEEP = 16

  /** Идёт поиск в интернете: запрос для строки «Ищу в интернете…» (пусто — не ищем) */
  const webActivity = ref('')
  let activityRun = 0

  let abort: AbortController | null = null
  let runId = 0

  const settings = () => useSettingsStore().settings

  /** «Печатает…» показываем, только пока нет ни одной буквы ответа */
  const showTyping = computed(() => {
    if (!isProcessing.value) return false
    const last = messages.value[messages.value.length - 1]
    return !(last && last.role === 'assistant' && last.content)
  })

  const setSystemPrompt = (prompt: string) => { systemPrompt.value = prompt }

  /** Системный промпт; правило «проси поиск строкой [[WEB: …]]» нужно только там, где модель вправе его использовать */
  const promptFor = (withWebRule: boolean) => buildSystemPrompt(systemPrompt.value, true, { web: withWebRule, persona: currentPersona() })

  /* ───────────── сохранение на диск ───────────── */

  /** Сохранение на диск — «по возможности»: сбой записи не должен превращать удачный ответ в ошибку */
  const persistMessage = (m: Message) => {
    try {
      const rec: Message = toPlain({ ...m }) // m — Proxy из store: в IPC уходит только чистая копия
      delete rec.streaming
      delete rec.error
      // base64-картинки в историю не пишем — они раздули бы файл на мегабайты
      if (rec.imageUrl?.startsWith('data:')) {
        delete rec.imageUrl
        rec.imageAlt = rec.imageAlt ?? '[картинка]'
      }
      memoryAPI.addMessage(rec)?.catch(() => {})
    } catch (e) {
      console.warn('Не удалось сохранить сообщение в историю:', e)
    }
  }

  const push = (msg: NewMessage, persist = true): Message => {
    const m: Message = { ...msg, id: msg.id ?? newId(), timestamp: msg.timestamp ?? Date.now() }
    messages.value.push(m)
    if (persist && !m.error) persistMessage(m)
    // возвращаем элемент массива (реактивный прокси), а не исходный объект
    return messages.value[messages.value.length - 1]
  }

  const addMessage = (message: NewMessage) => push(message)

  const removeMessage = (id: string) => {
    const i = messages.value.findIndex((m) => m.id === id)
    if (i >= 0) messages.value.splice(i, 1)
  }

  const broadcastEmotion = (tag: unknown) => {
    safeInvoke('emotion:broadcast', tag).catch(() => {}) // вне Electron — тихо ничего не делает
  }

  /* ───────────── история и прогрев ───────────── */

  /** Подтягивает последние сообщения с диска (чат-окно — отдельный процесс и каждый раз стартует пустым) */
  const loadHistory = async (limit = 40) => {
    if (historyLoaded.value) return
    historyLoaded.value = true
    try {
      const rows = await memoryAPI.getRecent(limit)
      if (Array.isArray(rows) && messages.value.length === 0) {
        messages.value = rows.filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      }
    } catch { /* история — приятный бонус, не критично */ }
  }

  /** Загружает модель и системный промпт в память заранее — первый ответ приходит заметно быстрее */
  const warmup = async () => {
    const s = settings()
    if (s.provider !== 'ollama') return
    try {
      const models = (await createProvider(s).listModels?.()) ?? []
      if (models.length) {
        const pick = pickModel(s.ollamaModel, models)
        if (pick !== s.ollamaModel) {
          console.warn(`Модель «${s.ollamaModel}» не установлена в Ollama, использую «${pick}»`)
          s.ollamaModel = pick
        }
      }
      // тот же текст, что уйдёт в первом запросе: иначе Ollama не узнает общую часть и перечитает промпт заново
      await createProvider(settings()).warmup?.(promptFor(pluginManager.internet.canModelRequest(settings())))
    } catch { /* Ollama может быть не запущена — это не повод падать */ }
  }

  /* ───────────── ответ модели ───────────── */

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

  const streamReply = async (
    userText: string,
    ctrl: AbortController,
    startedAt = now(),
    opts: ReplyOptions = {}
  ): Promise<ReplyOutcome> => {
    const s = settings()
    const provider = createProvider(s)
    let chatMessages = buildChatMessages(promptFor(!!opts.allowWebRequest), messages.value, {
      maxMessages: s.historyMessages,
      maxChars: s.historyChars,
    })
    const blocks: string[] = []
    if (opts.recall) blocks.push(opts.recall.block)
    if (opts.web) blocks.push(webContextBlock(opts.web.query, opts.web.context))
    if (blocks.length) chatMessages = withContextBlocks(chatMessages, blocks)

    const placeholder = push(
      {
        role: 'assistant',
        content: '',
        streaming: true,
        ...(opts.web?.sources.length ? { plugin: 'Интернет', sources: opts.web.sources } : {}),
        ...(opts.recall?.chips.length ? { recall: opts.recall.chips.map((c) => ({ ...c })) } : {}),
      },
      false
    )
    const id = placeholder.id
    const speak = s.enableVoiceOutput
    const splitter = new SentenceSplitter()

    let acc = ''
    let scheduled = false
    let finished = false
    let gotFirstToken = false
    const flush = () => {
      scheduled = false
      if (!finished) placeholder.content = acc
    }

    // Начало ответа придерживается, пока неясно, не служебная ли это строка [[WEB: …]]: ни на экран, ни в озвучку она не попадёт.
    // Обычный ответ начинается не с «[», поэтому задержки нет вообще.
    const watchWeb = !!opts.allowWebRequest || !!opts.web
    const gate = { open: !watchWeb, held: '', query: null as string | null }

    // модель останавливаем своим сигналом: по служебной строке читать дальше незачем
    const inner = new AbortController()
    const relayAbort = () => inner.abort()
    if (ctrl.signal.aborted) inner.abort()
    else ctrl.signal.addEventListener('abort', relayAbort, { once: true })

    const emit = (delta: string) => {
      if (!gotFirstToken && delta) {
        gotFirstToken = true
        const ms = Math.round(now() - startedAt)
        const m = metrics.value
        m.firstTokenMs = ms
        m.history = [...m.history, ms].slice(-HISTORY_KEEP)
      }
      acc += delta
      if (!scheduled) { scheduled = true; raf(flush) } // не чаще одного обновления DOM на кадр
      if (speak) for (const sentence of splitter.push(delta)) speechOutput.enqueue(sentence)
    }

    const onToken = (delta: string) => {
      if (gate.open) { emit(delta); return }
      if (gate.query) return
      gate.held += delta
      const verdict = judgeStreamHead(gate.held)
      if (verdict === 'wait') return
      if (verdict === 'text') {
        gate.open = true
        const h = gate.held
        gate.held = ''
        emit(h)
        return
      }
      gate.query = verdict.query
      inner.abort()
    }

    const finalize = (text: string) => {
      finished = true
      placeholder.content = text
      placeholder.streaming = false
      placeholder.emotion = analyzeEmotion(userText, text)
      persistMessage(placeholder)
      broadcastEmotion(placeholder.emotion)
    }

    const giveUpToWeb = (): ReplyOutcome => {
      finished = true
      removeMessage(id)
      return { webQuery: gate.query! }
    }

    try {
      const full = await provider.chat(chatMessages, { signal: inner.signal, onToken })
      if (!gate.open && !gate.query) {
        // поток закончился, а решение не принято: «[[WEB: курс» без закрывающих скобок или короткий ответ в скобках
        const verdict = judgeStreamHead(gate.held, true)
        if (typeof verdict === 'object') gate.query = verdict.query
        else { gate.open = true; const h = gate.held; gate.held = ''; if (h) emit(h) }
      }
      if (gate.query) return giveUpToWeb()
      const text = full.trim()
      if (!text) {
        finished = true
        removeMessage(id)
        push({ role: 'assistant', content: 'Модель вернула пустой ответ. Попробуй переформулировать или выбери другую модель в настройках.', error: true }, false)
        return null
      }
      metrics.value.totalMs = Math.round(now() - startedAt)
      finalize(text)
      if (speak) for (const sentence of splitter.flush()) speechOutput.enqueue(sentence)
    } catch (e) {
      if (gate.query && !ctrl.signal.aborted) return giveUpToWeb() // это мы сами оборвали поток
      const aborted = e instanceof AIError ? e.kind === 'aborted' : ctrl.signal.aborted
      if (aborted) {
        // «Стоп»: оставляем то, что успела сказать, а если ничего — убираем пустой пузырь
        if (acc.trim()) finalize(acc.trim())
        else { finished = true; removeMessage(id) }
        return null
      }
      finished = true
      const human =
        humanizeError(e, {
          provider: s.provider,
          ...activeModel(s),
        }) || 'Произошла ошибка. Попробуй ещё раз.'
      const fix = errorFixes(e, { provider: s.provider })
      console.error('AI error:', e)
      if (acc.trim()) {
        // уже что-то пришло — не теряем, просто дописываем пометку
        placeholder.content = acc.trim()
        placeholder.streaming = false
        persistMessage(placeholder)
        push({ role: 'assistant', content: human, error: true, ...(fix.length ? { fix } : {}) }, false)
      } else {
        placeholder.content = human
        placeholder.streaming = false
        placeholder.error = true
        if (fix.length) placeholder.fix = fix
      }
    } finally {
      ctrl.signal.removeEventListener('abort', relayAbort)
    }
    return null
  }

  /**
   * Идёт в интернет: Википедия и/или поиск. Любой сбой — не ошибка чата: модели просто сообщают, что поиск ничего не дал,
   * и она отвечает честно. Отмена («Стоп») пробрасывается наверх.
   */
  const lookupWeb = async (
    query: string,
    parts: { wiki: boolean; web: boolean },
    ctrl: AbortController,
    myRun: number
  ): Promise<WebAnswer> => {
    activityRun = myRun
    webActivity.value = query
    try {
      const r = await pluginManager.internet.search(query, { signal: ctrl.signal, settings: settings() }, parts)
      if (r.errors.length) console.warn('Интернет:', r.errors.join('; '))
      return { query: r.query || query, context: r.context, sources: r.sources }
    } catch (e) {
      if (ctrl.signal.aborted) throw e
      console.warn('Интернет: поиск не удался', e)
      return { query, context: '', sources: [] }
    } finally {
      if (activityRun === myRun) webActivity.value = ''
    }
  }

  /**
   * «Воспоминания» — только у NEKO (дневник её) и только если не выключены. Любой сбой — не ошибка чата: отвечаем как обычно.
   * Чтение памяти ограничено по времени, поэтому на скорость ответа почти не влияет.
   */
  const recallFor = async (text: string, ctrl: AbortController): Promise<RecallAnswer | undefined> => {
    if (!settings().memoryEnabled || currentPersona() !== 'neko') return undefined
    try {
      const r = await recallMemories(text, {
        signal: ctrl.signal,
        excludeIds: new Set(messages.value.map((m) => m.id)), // они и так в контексте
      })
      if (r) return { block: r.result.block, chips: r.result.chips }
    } catch (e) {
      console.warn('Воспоминания: не удалось прочитать память', e)
    }
    return undefined
  }

  const sendMessage = async (content: string) => {
    const text = content.trim()
    if (!text) return

    // Новое сообщение перебивает текущую генерацию и озвучку (barge-in)
    if (isProcessing.value) stop()

    const myRun = ++runId
    const ctrl = new AbortController()
    abort = ctrl
    isProcessing.value = true
    speechOutput.stop()

    const startedAt = now()
    push({ role: 'user', content: text })

    try {
      const s = settings()
      const ctx: PluginContext = { signal: ctrl.signal, settings: s }
      const hit = await pluginManager.processInput(text, ctx)
      if (hit) {
        push({ role: 'assistant', content: hit.result.text, imageUrl: hit.result.imageUrl, plugin: hit.plugin })
        // Короткие ответы плагинов (калькулятор, перевод, факт) озвучиваем; новости/погоду — нет
        if (s.enableVoiceOutput && !hit.result.imageUrl) {
          const spoken = cleanForSpeech(hit.result.text)
          if (spoken.length > 0 && spoken.length <= 260) speechOutput.enqueue(spoken)
        }
        return
      }

      // «Воспоминания»: вопрос о прошлом («помнишь, что мы делали во вторник?») — сначала ищем в дневнике и переписке
      const recall = await recallFor(text, ctrl)

      // «Интернет»: по просьбе или по виду вопроса — ищем до ответа; иначе модель сама может попросить поиск.
      // Вопрос о прошлом — это не вопрос к Википедии: автопоиск и просьбу модели «поискать» отключаем (явное «найди в интернете» остаётся)
      const net = pluginManager.internet
      const found = net.route(text, s)
      const decision = found && recall && found.mode === 'auto' ? null : found
      if (decision?.disabled) {
        push({ role: 'assistant', content: WEB_OFF_TEXT, plugin: 'Интернет' }, false)
        return
      }
      if (decision) {
        const web = await lookupWeb(decision.query, decision, ctrl, myRun)
        await streamReply(text, ctrl, startedAt, { web, recall })
        return
      }

      const first = await streamReply(text, ctrl, startedAt, { allowWebRequest: net.canModelRequest(s) && !recall, recall })
      if (first && !ctrl.signal.aborted) {
        const web = await lookupWeb(first.webQuery, { wiki: true, web: true }, ctrl, myRun)
        const again = await streamReply(text, ctrl, startedAt, { web, recall })
        if (again) push({ role: 'assistant', content: WEB_AGAIN_TEXT, error: true }, false)
      }
    } catch (error) {
      if (ctrl.signal.aborted) return // пользователь нажал «Стоп» во время работы плагина или поиска
      console.error('Error processing message:', error)
      push({ role: 'assistant', content: 'Произошла ошибка. Попробуй ещё раз.', error: true }, false)
    } finally {
      if (runId === myRun) {
        isProcessing.value = false
        abort = null
        webActivity.value = ''
      }
    }
  }

  /** Остановить генерацию и озвучку */
  const stop = () => {
    abort?.abort()
    speechOutput.stop()
  }

  /** «Очистить чат»: контекст модели обнуляется, а история на диске остаётся для дневника */
  const clearChat = () => {
    stop()
    messages.value = []
    memoryAPI.reset()?.catch(() => {})
  }

  return {
    messages,
    isProcessing,
    showTyping,
    webActivity,
    metrics,
    systemPrompt,
    setSystemPrompt,
    addMessage,
    sendMessage,
    stop,
    clearChat,
    loadHistory,
    warmup,
  }
})
