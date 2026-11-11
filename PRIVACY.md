# Приватность / Privacy

[Русский](#русский) · [English](#english)

---

## Русский

**Коротко:** приложение работает на твоём компьютере. В нём нет телеметрии, аналитики, отчётов об ошибках и автообновления.
Данные уходят в интернет только туда, куда ты сам их направил настройками (облачная нейросеть, облачная озвучка) или командами (погода, перевод, новости, поиск).

### Где лежат твои данные

Всё — в папке данных приложения (в проекте их нет, поэтому репозиторий не содержит личного):

| Как запущено | Папка (Windows) |
| --- | --- |
| `NEKO.bat` / `ARIA.bat` / `npm run dev:*` | `%APPDATA%\neko-aria-suite` |
| установщик NEKO | `%APPDATA%\NEKO` |
| установщик ARIA | `%APPDATA%\ARIA` |

Что внутри:

| Что | Где | Заметки |
| --- | --- | --- |
| История чата | `memory\neko\ГГГГ-ММ-ДД.jsonl`, `memory\aria\…` | по файлу на день, обычный текст |
| Дневник NEKO | `diary\diary.json` (+ `.bak`) | мысли, настроение, статистика эмоций |
| Картинки дневника | `diary\images\` | селфи, иллюстрации и твои фото |
| **Настройки и API-ключи** | `Local Storage\` (хранилище браузерного движка внутри папки данных) | ⚠️ **ключи лежат в открытом виде**, без шифрования |
| Напоминания | `reminders.json` | ожидающие и не закрытые |
| Позиции окон | `window-state.json` | |
| Трей | `app-prefs.json` | два переключателя |
| Кэш движка | `Cache\`, `GPUCache\`, … | служебное |

Временный файл при экспорте дневника в PDF создаётся в системной папке `Temp` и удаляется сразу после сохранения.
Экспортированные тобой `.md`/`.pdf` лежат там, куда ты их сохранил, — вместе с текстом переписки и твоими картинками.

**Удалить всё:** закрой приложение (значок в трее → «Выход») и удали папку данных. Удалить только историю — папку `memory`.
Кнопка 🧹 «Очистить чат» убирает переписку лишь из контекста нейросети, а файлы на диске **остаются** (из них пишется дневник). Отдельные записи и фото дневника удаляются в самом дневнике кнопкой «🗑».
Отдельной кнопки «стереть всё» в приложении нет.

### Что уходит в сеть и куда

| Функция | Куда | Что отправляется |
| --- | --- | --- |
| Нейросеть: Ollama | твой компьютер (`localhost`) | ничего наружу |
| Нейросеть: облако (DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, Together, xAI, «свой сервер») | выбранный провайдер | твоё сообщение, недавняя переписка в рамках лимита контекста, системные подсказки персонажа, при вопросах о прошлом — найденные куски дневника и истории; при поиске в интернете — найденные отрывки |
| Озвучка: встроенная, Chatterbox | локально | ничего наружу |
| Озвучка: ElevenLabs / Cartesia | `api.elevenlabs.io` / `api.cartesia.ai` | **текст ответа** и ключ |
| Распознавание речи: Whisper | адрес из настроек (по умолчанию `localhost`) | запись голоса |
| Картинки: Stable Diffusion | адрес из настроек (по умолчанию `127.0.0.1`) | текст запроса |
| Погода | `geocoding-api.open-meteo.com`, `api.open-meteo.com` | название города (ключ не нужен) |
| Перевод | `api.mymemory.translated.net` | переводимый текст |
| Новости | `news.google.com` (RSS) | запрос на ленту новостей |
| «Интернет» (Википедия, поиск) | `ru.wikipedia.org`, `en.wikipedia.org`, `html.duckduckgo.com` | поисковые слова из твоего вопроса; выключатель — «Настройки → Интернет → Разрешить доступ в интернет» (поиск идёт по просьбе или сам, если включено «Искать самой») |
| Напоминания, калькулятор, факты, дневник, воспоминания | — | ничего: всё считается на компьютере |

Дополнительно:

- Погода, перевод и новости работают, только когда ты их просишь, и выключателем «Интернет» не отключаются.
- Любой адрес, который ты сам введёшь в настройках («свой сервер», Whisper, Chatterbox, Stable Diffusion), получает те данные, которые перечислены выше для этой функции.
- Облачные провайдеры и сервисы ведут свои политики хранения и обучения на данных — читай их условия.
- Если выбрать распознавание речи «встроенное», движок браузера внутри Electron может попытаться использовать облачный сервис распознавания; на практике в Electron это обычно не работает. Для приватного голосового ввода выбирай локальный Whisper.
- Из приложения открываются только внешние ссылки `http(s)` — и только в твоём браузере.

### Что нельзя публиковать на GitHub

API-ключи, всё содержимое папки данных (особенно `memory\`, `diary\`, `Local Storage\`), `.env`, файлы `.jsonl`, `.vrm`/`.vrma` (чужие лицензии), скриншоты, на которых видны ключи или личная переписка.
Перед публикацией запусти `npm run check:publish`: он ищет ключи, личные пути и почту, запрещённые файлы. Подробности — в [CONTRIBUTING.md](CONTRIBUTING.md) и [SECURITY.md](SECURITY.md).

---

## English

**In short:** the app runs on your computer. It contains no telemetry, analytics, crash reporting or auto-update.
Data leaves your machine only where you point it (a cloud LLM, cloud TTS) or when you ask for it (weather, translation, news, web search).

### Where your data lives

All of it is in the app's data folder, never in the project: `%APPDATA%\neko-aria-suite` (launcher / dev), `%APPDATA%\NEKO` or `%APPDATA%\ARIA` (installers).

| What | Where |
| --- | --- |
| Chat history | `memory\<neko|aria>\YYYY-MM-DD.jsonl` (plain text) |
| Diary | `diary\diary.json` (+ `.bak`), pictures in `diary\images\` |
| **Settings and API keys** | `Local Storage\` — ⚠️ **keys are stored unencrypted** |
| Reminders / window positions / tray prefs | `reminders.json`, `window-state.json`, `app-prefs.json` |

PDF export writes a temporary file to the system `Temp` folder and deletes it right after saving. Files you export stay wherever you save them, with your chat text and pictures inside.
**To delete everything:** quit (tray icon → "Exit") and delete the data folder (only the history: the `memory` folder). The 🧹 "Clear chat" button only removes the conversation from the model's context — files on disk stay. Diary entries and photos can be deleted inside the diary. There is no "erase all" button.

### What goes over the network

| Feature | Destination | Sent |
| --- | --- | --- |
| Ollama, built-in TTS, Chatterbox | localhost | nothing leaves your PC |
| Cloud LLM (DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, Together, xAI, custom) | the chosen provider | your message, recent conversation (within the context limit), the persona's system prompt, recalled diary/history snippets, web snippets |
| ElevenLabs / Cartesia TTS | `api.elevenlabs.io` / `api.cartesia.ai` | **reply text** and the key |
| Whisper / Stable Diffusion | the address in settings (default localhost) | voice recording / prompt |
| Weather | Open-Meteo | city name |
| Translation | MyMemory | the text to translate |
| News | Google News RSS | a feed request |
| Web ("Internet" plugin) | Wikipedia, DuckDuckGo HTML | search words from your question (switch: Settings → Internet; weather, translation and news are on-request and not covered by that switch) |
| Reminders, calculator, facts, diary, recall | — | nothing |

Any custom address you type in settings receives the data listed for that feature. Cloud providers apply their own retention and training policies. For private voice input choose local Whisper.

### Never publish

API keys, anything from the data folder (`memory\`, `diary\`, `Local Storage\`), `.env`, `.jsonl`, `.vrm`/`.vrma`, screenshots showing keys or private chats.
Run `npm run check:publish` before publishing — it scans for keys, personal paths, e-mail addresses and forbidden files.
