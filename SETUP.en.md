# Setup and first run

[Русский](SETUP.md)

Tested on **Windows 10/11**. Running from source on macOS/Linux should probably work but has not been tested.

To get going you only need two things: **Node.js** and **some language model** (local Ollama or a cloud provider key). Voice, images and the avatar can wait — add them later, in any order, whenever you feel like it.

## 1. Running the app

Install [Node.js](https://nodejs.org) 18 or newer (LTS is fine).

```bash
git clone <this repository's URL>
cd <project folder>
```

**Easiest on Windows:** double-click `NEKO.bat` (anime companion) or `ARIA.bat` (Jarvis-style assistant).
The first run installs dependencies and builds the app (a few minutes, internet required); later runs start in seconds and rebuild automatically after code updates.

Desktop shortcuts: `npm run shortcuts`.

| Command | What it does |
| --- | --- |
| `npm run start:neko` / `npm run start:aria` | same as the `.bat` files, from a terminal (also macOS/Linux) |
| `npm run dev:neko` / `npm run dev:aria` | development mode: Vite server + hot reload |
| `npm run build:neko` / `npm run build:aria` | Windows installer in `release/` |

> **About settings.** The built version (`NEKO.bat`, installer) and dev mode (`npm run dev:*`) keep window settings separately (different page origin). If you used `dev:*` before,
> re-enter settings and keys after switching. Chat history and the diary live in the app data folder and are **kept**.

> **Ready-made installers.** If the repository on GitHub has a **Releases** section, you'll find `NEKO-Setup-….exe` and `ARIA-Setup-….exe` there. No Node.js needed — just run the file.
> They aren't code-signed, so Windows SmartScreen may complain. Click "More info", then "Run anyway". If you want to be sure the file wasn't tampered with, compare it with `SHA256SUMS.txt` next to it.
> `.vrm` files aren't included (model licenses), but adding an avatar takes a couple of clicks — see step 3.

## 2. LLM (required)

Pick one in *Settings → Neural network and system*.

**Option A — Ollama (local, free, nothing leaves your PC).** Install from <https://ollama.com/download>, then `ollama pull gemma4:e4b` (the default in settings).
If that model name does not exist in the Ollama catalog, pick another one: the "Model list" button shows what is installed. Default address: `http://localhost:11434`.

**Option B — a cloud provider (needs a key).** DeepSeek, OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, Together, xAI, or a custom OpenAI-compatible server (LM Studio, vLLM…).
Paste the key (the "where to get a key" link is under the field), press "Model list" and choose a model.

> ⚠️ API keys are stored on your computer **unencrypted**. Never share the app data folder or screenshots of the settings with a key. See [PRIVACY.md](PRIVACY.md).

## 3. Avatar (VRM model)

**Easiest, for every kind of install:** *Settings → Check and install* → **"Download sample VRM"** fetches a test model, **"Models folder"** opens the folder for your own `.vrm`. The avatar appears at once, no restart.

| For | File name |
| --- | --- |
| NEKO | `default.vrm` |
| ARIA (optional; without it a "lens" is shown) | `aria.vrm` |

Models folder: `%APPDATA%\neko-aria-suite\models\` (launcher; or `public/models/` in the project), `%APPDATA%\NEKO\models\` / `%APPDATA%\ARIA\models\` (installers), `public/models/` (`npm run dev:*`). Animations `.vrma` go to a sibling `animations` folder.

Get models from [VRoid Hub](https://hub.vroid.com), [Booth](https://booth.pm) or make your own in VRoid Studio. **Check the model's license** — that's why `.vrm` files are git-ignored.
The same from a terminal (writes to the project's `public/models/`): `npm run models:download` (the URL in `scripts/models.json` is marked `"verified": false`: the author has not verified it live; the script checks that the download really is a VRM).
Animations (optional): `public/animations/VRMA_01.vrma … VRMA_07.vrma`, see [public/animations/README.md](public/animations/README.md).

## 4. Voice input: Whisper (optional)

Run an OpenAI-compatible speech-to-text server (tested against [speaches](https://github.com/speaches-ai/speaches), formerly faster-whisper-server; follow its current README, commands change).
In *Voice and sound → Speech recognition* choose "Whisper". Defaults: `http://localhost:8000/v1`, model `Systran/faster-whisper-small`.

## 5. Voice output (optional)

| Engine | Needs | Notes |
| --- | --- | --- |
| Built-in | nothing | simple system voice |
| Chatterbox | local server, default `http://localhost:4123` | natural, voice cloning, needs a GPU |
| ElevenLabs | [API key](https://elevenlabs.io/app/settings/api-keys) | cloud |
| Cartesia | [API key](https://play.cartesia.ai/keys) | cloud, fast |

For Chatterbox the app posts to `<address>/audio/speech` (OpenAI-style), e.g. [chatterbox-tts-api](https://github.com/travisvn/chatterbox-tts-api). Cloud engines send the reply text to the provider.

## 6. Images: Stable Diffusion (optional)

Used for "draw …" and for selfies/illustrations in the diary. Install [AUTOMATIC1111 WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) and start it with `--api` (default address `http://127.0.0.1:7860`).

## 7. The "Check and install" wizard

On the very first launch a settings window opens on **"Check and install"**: it checks the LLM, avatar, animations, Whisper, Chatterbox and Stable Diffusion in a couple of seconds, with ✅/⚠️/➖/⛔, hints and install links. Reopen any time from *Settings → Check and install*.

## 8. Handy

- **Tray.** While "Closing hides to tray" is on (default), the window's ✕ does not quit: reminders still fire and the diary still gets written. Quit via the tray icon → "Exit".
- **Reminders.** "remind me in 10 minutes to drink water" (in Russian: «напомни через 10 минут выпить воды»), «покажи напоминания», «отмени все напоминания».
  The reminder parser understands **Russian only**; a popup appears at the bottom-right of the screen.
- **Diary export** (Markdown or PDF) and search by emotion ("когда мне было грустно").

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing script: "…"` | outdated `package.json`; update the project |
| `Electron failed to install correctly` | delete `node_modules`, run `npm install` again |
| No avatar | model file missing — the wizard shows which one and has a "Download sample VRM" button |
| "Ollama is not responding" | is Ollama running (tray icon)? `ollama list` should answer |
| Cloud 400/404 | wrong model name — press "Model list"; check the key |
| Voice silent | "Test voice" in *Voice and sound* shows the reason |
| SmartScreen warns about the installer | it is not code-signed; "More info → Run anyway" or build from source |

If nothing helps, open an issue with the error text (**no keys or personal data**).
