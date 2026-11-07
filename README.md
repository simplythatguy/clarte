# Clarte

Giving back clarity of speech to people with dysarthria and motor disabilities.

## Quickstart

Needs only `git`, a browser and internet; no Python, Node, compiler, ffmpeg or Git LFS.

```sh
git clone https://github.com/simplythatguy/clarte.git
cd clarte
cp .env.example .env      # Windows: copy .env.example .env; fill in ELEVENLABS_API_KEY for Voice
./clarte ui               # Windows: clarte ui
```

`clarte <app>` sets up what the app needs, starts it, opens it in the browser and prints its
URLs; Ctrl+C stops everything it started. The apps are `ui` (the S0–S5 switcher with the
prediction engine), `predict`, `autocomplete`, `voice` and `eyes`; `clarte` alone lists them,
and `clarte check` starts and smoke-tests every app without a browser (this is what CI runs).

The first run downloads about FIRST_RUN_SIZE into the git-ignored `.tools/` folder and the
prototypes' own `.venv`/`node_modules` folders (pinned uv, Python, Node, the models and
dependencies) and takes about FIRST_RUN_TIME on a fast connection; later runs start in seconds.
Every step is resumable, so an interrupted first run continues where it stopped. Each
prototype's README keeps the manual setup as a fallback.

[Development tooling and setup](docs/dependencies.md)
