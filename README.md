# Clarté

Giving back clarity of speech to people with dysarthria and motor disabilities.

## Video demo

https://github.com/user-attachments/assets/e22974f3-46f4-4d25-9882-0f3b3130ddf4

78 seconds. Eye calibration, then "I want to walk", typed by looking at
letter groups and confirming each with a sound, the word picked from Options, and the sentence spoken aloud.

## Quickstart

Needs only `git`, a browser and internet; no Python, Node, compiler, ffmpeg or Git LFS.

```sh
git clone https://github.com/simplythatguy/clarte.git
cd clarte
cp .env.example .env      # Windows: copy .env.example .env; then put the team's ElevenLabs key in it
./clarte ui               # Windows: clarte ui
```

Making a voice (Menu › My voice) needs `ELEVENLABS_API_KEY` in `.env`. `.env` is not in git, so each
computer needs its own copy; without it the app says so and speaks with the browser's voice.

`clarte <app>` sets up what the app needs, starts it, opens it in the browser and prints its
URLs; Ctrl+C stops everything it started, except that on macOS and Linux `clarte ui` keeps the prediction
engine running so the next start skips its 30 to 80 second load (it is restarted by itself when the engine code
changes, and `clarte stop` ends it; `CLARTE_KEEP_ENGINE=0` turns this off). The apps are `ui` (Clarté itself, from [`main/`](main/README.md):
the conversation screen with eye calibration and the prediction engine), `ui-v0` (the UI v0 S0–S6 switcher),
`predict` (the prediction engine and its test page), `voice` and `eyes`; `clarte` alone lists them,
and `clarte check` starts and smoke-tests every app without a browser (this is what CI runs).

[`main/`](main/README.md) holds the app as it stands: `main/app` and the prediction engine in `main/engine`.
`prototypes/` keeps the explorations it was put together from.

The first run downloads about 1.6 GB (pinned uv, Python, Node, the 880 MB of models and the
dependencies) into the git-ignored `.tools/` folder and the prototypes' own `.venv` and
`node_modules` folders, about 6 GB on disk; measured on an Apple silicon Mac with a fast
connection, the first `clarte ui` was up in about 3 minutes and `clarte check` took 6 minutes
(Linux fetches a larger CPU-only torch wheel). Later runs skip all of that: the prediction engine
takes 40 to 80 seconds to load its models, the other apps a few seconds. Every step is
resumable, so an interrupted first run continues where it stopped. Each prototype's README
keeps the manual setup as a fallback.

`prototypes/Gaze Lab` is a measurement harness for the eye tracker, not a `clarte` app; its README
has the npm commands.

[Development tooling and setup](docs/dependencies.md)
