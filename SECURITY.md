# Безопасность / Security

## Русский

Если нашёл уязвимость, **не создавай публичный issue**. Используй приватное сообщение через GitHub: вкладка **Security → Report a vulnerability**
(GitHub Security Advisories) в этом репозитории. Опиши, что происходит и как воспроизвести — без реальных ключей и личных данных.

Поддерживается последняя версия (0.1.x).

Важно знать пользователям:

- **API-ключи** (облачные нейросети, ElevenLabs, Cartesia) хранятся на твоём компьютере, в данных приложения (localStorage), **без шифрования**.
  Не публикуй и не присылай папку данных приложения (`%APPDATA%\NEKO`, `%APPDATA%\ARIA`, `%APPDATA%\neko-aria-suite`).
- Если ключ мог утечь — отзови его в кабинете провайдера и создай новый.
- Приложение не запускает чужой код: окна работают в песочнице Electron (`sandbox`, `contextIsolation`), внешние ссылки открываются в браузере.

## English

Please do **not** open a public issue for security problems. Use **Security → Report a vulnerability** (GitHub Security Advisories) in this repository.
The latest release (0.1.x) is supported.

Users should know: API keys are stored unencrypted in the app's local data (localStorage). Never publish or share the app data folder.
If a key may have leaked, revoke it at the provider and create a new one.
