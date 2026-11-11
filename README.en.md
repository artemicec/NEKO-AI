# NEKO · ARIA — a desktop AI companion

[Русский](README.md) · [Setup](SETUP.en.md) · [Privacy](PRIVACY.md) · [Contributing](CONTRIBUTING.md)

Two assistants in one project. They run on your computer; the LLM can be local (Ollama) or a cloud provider — your choice.

- **NEKO** — an anime-style companion with a 3D (VRM) avatar on your desktop: chats, changes emotions, lip-syncs to speech, keeps a personal **diary** and remembers past conversations.
- **ARIA** — a Jarvis-style voice assistant: a compact window with an animated "lens" (or an avatar if you add `aria.vrm`) and a status panel — link, model, time to first token, context usage. The numbers are computed locally and never sent anywhere.

> **Version 0.1 — early.** A personal project that keeps evolving; things may break, please open an issue. What was and was not verified is stated honestly in [SETUP.en.md](SETUP.en.md).

| NEKO | ARIA |
| --- | --- |
| ![NEKO](docs/screenshots/neko.png) | ![ARIA](docs/screenshots/aria.png) |
| ![Chat](docs/screenshots/chat.png) | ![Settings](docs/screenshots/settings.png) |
| ![Diary](docs/screenshots/diary.png) | ![Diary PDF export](docs/screenshots/diary-pdf.png) |

## Features

**LLMs** — local **Ollama** (nothing leaves your PC) or cloud (key required): DeepSeek, OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, Together, xAI and any OpenAI-compatible server. Streaming replies, per-day conversation memory, recall of past chats.

**Voice** — input: local **Whisper** (OpenAI-compatible server) or built-in recognition. Output: built-in voice, **Chatterbox** (local), **ElevenLabs** and **Cartesia** (cloud). Separate voices for NEKO and ARIA. Lip-sync.

**Avatar (NEKO)** — VRM model in a transparent always-on-top window, emotions, blinking, gaze. `.vrma` animations: after each one the avatar returns to a neutral pose and rests for a configurable time.

**Diary (NEKO)** — entries, mood, emotion statistics, pictures; **search by emotion** ("when was I sad", in Russian) and **export** to Markdown and PDF.

**Chat commands** — reminders (popup; the parser understands Russian only), calculator, weather, translation, news, facts, web search and Wikipedia (can be switched off), image generation via Stable Diffusion.

**Convenience** — double-click `NEKO.bat` / `ARIA.bat` (Windows), desktop shortcuts via `npm run shortcuts`, tray icon (closing the window does not quit the app, configurable), a first-run "Check and install" wizard, optional autostart with Windows.

## Quick start

You need [Node.js](https://nodejs.org) 18+ and some LLM.

```bash
git clone <repository URL>
cd <project folder>
```

1. Install [Ollama](https://ollama.com/download) and pull a model (`ollama pull gemma4:e4b`) — or get a cloud provider key.
2. Put a VRM model at `public/models/default.vrm` (see [public/models/README.md](public/models/README.md)).
3. Windows: double-click `NEKO.bat` or `ARIA.bat`. Other systems: `npm install`, then `npm run start:neko` / `npm run start:aria`.

Details, including voice and images: **[SETUP.en.md](SETUP.en.md)**.

## For developers

Electron 29 · Vue 3.5 · Pinia · Vite 5 · TypeScript · three.js + `@pixiv/three-vrm`.

```bash
npm run dev:neko        # development (or dev:aria)
npm run typecheck
npm run build:electron
npm run build:neko      # Windows installer in release/
npm run check:publish   # pre-publish scan: keys, personal data, stray files
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull requests and [SECURITY.md](SECURITY.md) for vulnerabilities.

## Privacy

No telemetry. Data stays in the app folder on your computer; only what you enable (cloud LLM, cloud TTS) or request (weather, translation, news, search) goes over the network. **API keys are stored unencrypted** — never publish the data folder or screenshots of the settings. Full list: [PRIVACY.md](PRIVACY.md).

## License

Code: [MIT](LICENSE). VRM models, animations and voices are not part of the repository and have their own licenses.
