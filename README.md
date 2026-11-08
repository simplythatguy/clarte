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
URLs; Ctrl+C stops everything it started. The apps are `ui` (the S0–S6 switcher with the
prediction engine), `predict` (the prediction engine and its test page), `voice` and `eyes`; `clarte` alone lists them,
and `clarte check` starts and smoke-tests every app without a browser (this is what CI runs).

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
