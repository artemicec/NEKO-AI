# Модели VRM / VRM models

Сюда кладётся аватар при запуске из исходников (`npm run dev:*`). Файлы `.vrm` **не входят в репозиторий** (они в `.gitignore`): у каждой модели свой автор и своя лицензия, многие запрещают перераспространение.

> В установленном приложении и при запуске через `NEKO.bat` модели берутся из папки данных: `%APPDATA%\neko-aria-suite\models\` (установщики — `%APPDATA%\NEKO\models\`, `%APPDATA%\ARIA\models\`). Проще всего открыть её кнопкой **«📁 Папка моделей»** в «Настройки → Проверка и установка»; там же кнопка **«⬇️ Скачать образец VRM»**.

| Файл | Для кого |
| --- | --- |
| `default.vrm` | NEKO (обязательно для аватара) |
| `aria.vrm` | ARIA (необязательно; без файла показывается «объектив») |

Формат — VRM 0.x или 1.0. Где взять: [VRoid Hub](https://hub.vroid.com), [Booth](https://booth.pm) или собственная модель из VRoid Studio.
**Всегда проверяй условия использования модели**, особенно если собираешься показывать её в видео, на стриме или публиковать сборку.

Скачать образец для проверки (адрес в `scripts/models.json` автором вживую не проверялся — если не скачалось, возьми модель вручную):

```bash
npm run models:download
npm run models:download -- --url https://адрес/model.vrm --target public/models/aria.vrm
```

Скрипт убеждается, что скачан именно VRM, и не перезаписывает существующий файл без `--force`. Страница «Настройки → Проверка и установка» покажет, увидело ли приложение модель.

---

Put your avatar here: `default.vrm` for NEKO, `aria.vrm` for ARIA (optional). VRM 0.x/1.0. These files are git-ignored on purpose — **check each model's license** before sharing or streaming.
Sample download: `npm run models:download` (the URL in `scripts/models.json` is unverified; if it fails, add a model manually).
