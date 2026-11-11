# Как помочь проекту / Contributing

[Русский](#русский) · [English](#english)

---

## Русский

Спасибо, что хочешь помочь! Проект личный и растёт постепенно, поэтому несколько простых правил.

### Запуск и проверка

```bash
npm install
npm run dev:neko        # или npm run dev:aria
npm run typecheck       # vue-tsc, должно проходить без ошибок
npm run build:electron  # сборка главного процесса (tsc)
```

Эти же команды выполняет CI при каждом пуше и pull request. Перед PR запусти их локально.

### Pull request

- Присылай PR **с описанием**: что изменено, зачем, как проверено (шаблон подставится сам).
- Один PR — одна задача. Большие изменения лучше сначала обсудить в issue.
- Стиль: TypeScript `strict`, `<script setup lang="ts">` в компонентах, комментарии объясняют «почему», а не «что».
  Тексты интерфейса и комментарии — по-русски (английский для документации и коммитов тоже подходит).
- Не добавляй зависимости без необходимости: приложению важны скорость и маленький размер.

### ⚠️ Данные пользователя: не менять формат без обсуждения

**Не меняй формат файлов `memory/*.jsonl` и `diary/*` без обсуждения в issue.** Это личные данные пользователей: история переписки и дневник.
Сломанный формат = потерянные воспоминания. Если формат всё-таки нужно изменить, миграция должна быть обратно-совместимой
(старые записи читаются как раньше) и покрыта тестом на старых данных.

То же относится к настройкам (`sanitizeSettings` в `settingsStore.ts`): новые поля добавляются с безопасными значениями по умолчанию,
старые — переносятся (см. миграцию `deepseek*` → `cloud.deepseek`).

### Как добавить…

- **Плагин** («погода», «калькулятор», «напомни…»): по образцу файлов в `src/shared/plugins/` — объект `Plugin` с `matches()` и `execute()`;
  зарегистрируй в `src/shared/services/pluginManager.ts`.
- **Облачного провайдера нейросети**: если он говорит на OpenAI-совместимом `/chat/completions`, достаточно пресета в
  `src/shared/services/providers.ts` (адрес, модель по умолчанию, ссылка на ключ) и значения в типе `CloudProviderId`.
  Если протокол свой — отдельный сервис по образцу `anthropicService.ts` и ветка в `aiFactory.ts`.
- **Движок озвучки**: по образцу `cloudTts.ts` + подключение в `speechOutput.ts` (возвращай `AudioBuffer` — тогда липсинк заработает сам).

### Чего НЕ коммитить

API-ключи, файлы из папки данных приложения (`userData`), `.vrm`/`.vrma` (лицензии моделей), скриншоты с личной перепиской или ключами в кадре.
Перед PR можно запустить `npm run check:publish` — скрипт ищет типичные утечки.

### Уязвимости

О найденной уязвимости сообщай **приватно** (см. [SECURITY.md](SECURITY.md)), а не в публичном issue.

---

## English

Thanks for helping out! A few simple rules.

### Run and check

```bash
npm install
npm run dev:neko        # or npm run dev:aria
npm run typecheck       # vue-tsc, must pass
npm run build:electron  # compiles the Electron main process (tsc)
```

CI runs the same commands on every push and pull request.

### Pull requests

- Send PRs **with a description**: what changed, why, how you tested it (the template fills in automatically).
- One PR — one topic. Discuss big changes in an issue first.
- Style: TypeScript `strict`, `<script setup lang="ts">`, comments explain *why*. UI strings are in Russian.
- Avoid new dependencies unless really needed.

### ⚠️ User data: do not change formats without discussion

**Do not change the format of `memory/*.jsonl` or `diary/*` without discussing it in an issue first.** These files hold users' chat history and diary;
a broken format means lost memories. If a change is unavoidable, the migration must be backwards compatible and covered by a test on old data.
The same goes for settings (`sanitizeSettings` in `settingsStore.ts`): new fields need safe defaults and old ones must be migrated.

### How to add…

- **A plugin**: follow `src/shared/plugins/*` (a `Plugin` object with `matches()`/`execute()`), register it in `pluginManager.ts`.
- **A cloud LLM provider**: if it speaks OpenAI-compatible `/chat/completions`, add a preset to `src/shared/services/providers.ts` and the id to `CloudProviderId`.
  Otherwise write a service like `anthropicService.ts` and branch in `aiFactory.ts`.
- **A TTS engine**: see `cloudTts.ts` and `speechOutput.ts` (return an `AudioBuffer` and lip-sync works automatically).

### Never commit

API keys, anything from the app's `userData` folder, `.vrm`/`.vrma` files (model licenses), screenshots showing private chats or keys.
`npm run check:publish` scans for common leaks.

### Security issues

Report vulnerabilities **privately** — see [SECURITY.md](SECURITY.md).
