# Voice

Clarte speaks in a voice made from the person's own recordings: old ones from before their speech changed, or about a minute recorded today. Clarte picks the clearest speech on this computer. [ElevenLabs Instant Voice Cloning](https://elevenlabs.io/docs/product-guides/voices/voice-cloning/instant-voice-cloning) makes the voice from that selection, and ElevenLabs text-to-speech speaks with it. Why ElevenLabs, how the speech is chosen and what has been measured: [docs/RESEARCH.md](docs/RESEARCH.md).

This folder is the voice service (Python). The app's **Menu › My voice** pages (`app/src/myvoice/`) record, upload and speak through it.

## Run

From the repository root, put the key in `.env` (`cp .env.example .env`, then fill in `ELEVENLABS_API_KEY`) and run `./clarte ui` (Windows: `clarte ui`). The launcher installs the service's environment once a key is set and starts the service next to the app. See the root README.

Manually, from this folder:

```sh
# once: Python 3.11 env for the service (about 1 GB, mostly CPU PyTorch for the speaker check)
uv venv --python 3.11 .venv
VIRTUAL_ENV=.venv uv pip install -r requirements.txt --overrides overrides.txt

ELEVENLABS_API_KEY=sk_… CLARTE_VOICE_PORT=4322 .venv/bin/python -m clarte_voice   # http://127.0.0.1:4322
```

Requirements: Python 3.11 with [uv](https://docs.astral.sh/uv/) and an ElevenLabs API key. `overrides.txt` swaps resemblyzer's `webrtcvad` (source only, needs a C compiler) for the prebuilt `webrtcvad-wheels`. Recordings are decoded with ffmpeg from `PATH` when there is one, otherwise with the static build in the `imageio-ffmpeg` wheel.

**API key.** Create a restricted key with **Text to Speech: Access** and **Voices: Write**, and nothing else. Set a credit limit and an expiry date, and turn on auto-disable if leaked. Pass it as `ELEVENLABS_API_KEY`, or put it in a file outside the repository and pass the path as `ELEVENLABS_API_KEY_FILE`. Never commit it.

The service binds to 127.0.0.1, and CORS only lets the app on port 5200 call it. Settings:

- `CLARTE_VOICE_DIR`: where recordings and voice records are kept (default `~/.clarte/voices`).
- `CLARTE_ELEVENLABS_MODEL`: the speaking model (default `eleven_multilingual_v2`, which scored best on speaker similarity among the ElevenLabs models). `eleven_flash_v2_5` is faster and uses half the credits.
- `CLARTE_VOICE_ORIGINS`: which page origins may call the service.

Team voices live in [`voices/`](voices/README.md).

## How a voice is made

- *Recordings from before*: audio or video files whose speaker has been confirmed. The service cuts them into short speech pieces and scores each one. It flags pieces that sound like someone else and keeps up to about 90 s of the clearest speech. Then it deletes the uploaded files and sends that selection to ElevenLabs, with background-noise removal on.
- *How I speak today*: a held "ah", the six CAPE-V sentences, part of the Rainbow Passage and a few words of the person's own, about a minute in all. Echo cancellation, noise suppression and gain control are off, so the voice isn't reshaped before it's cloned.
- **Pacing** has two settings. *Like my recordings* uses the settings from Bottalico et al. 2026 (stability 0.5, similarity 1.0, style 0.5, speaker boost on). *Steadier* uses higher stability and no style exaggeration, which gives calmer, more fluent delivery.
- Choosing which pieces a voice learns from and saving makes a new clone and deletes the old one.

Every phrase is cached per voice, model and pacing setting. Saying it again plays instantly and uses no credits. Deleting a voice deletes the clone on ElevenLabs and the local folder.

## Privacy

- **Sent to ElevenLabs:** the selected speech, once per clone, and the text the voice is asked to say.
- **Stays on this computer:** the uploaded files themselves, which are deleted after analysis; speech judged to be someone else; the speech segments; and the cached phrases.
- **Consent:** each voice stores the consent statement confirmed when it was made. That statement includes sending speech to ElevenLabs.
- **Clinical use:** HIPAA terms with ElevenLabs need an Enterprise agreement.

## Test

```sh
.venv/bin/python -m pytest -q tests       # curation, API and ElevenLabs client (mocked; no credits used)
.venv/bin/python scripts/evaluate.py --reference ref.wav --text "…" out.mp3   # speaker similarity and rate
```

## Files

- `clarte_voice/curate.py`: segmenting, scoring, speaker check and reference assembly.
- `clarte_voice/speaker.py`: local speaker embeddings (Resemblyzer) for the speaker check.
- `clarte_voice/engine.py`: the ElevenLabs client (create and delete clones, text-to-speech, and plain-language errors).
- `clarte_voice/app.py`: the HTTP API (`/voices`, `/voices/{id}/speak`, …) and the phrase cache.
