# Standalone import

Imported into `prototypes/Eye Tracking` from the corrected parent prototype source pin:

```text
88545f48e22aaa59b66d987d0923c3cb708344148a37c10113c8dac8c0d3402d
```

The parent's 715-file manifest covered scratch source, models and build outputs. Its SHA-256 is `79e38b330fc3c3044a1317a4956c8f484e4d0f9b5724caa643865c5f6f0bef96`. It is an origin receipt, not the fingerprint of this differently packaged folder. [IMPORT-SOURCE.json](IMPORT-SOURCE.json) lists the original path, byte count and SHA-256 for every imported file, with an explicit list of packaging adaptations. `npm run check:import` verifies every unchanged copy without needing the original workspace.

Application logic, tests, vendor/public assets, Vite/TypeScript config and LICENSE are exact copies. `src/styles.css` and the HTML theme-color metadata implement the latest user request for light mode. This includes the parent's fixed App and eight regression cases for saved-choice/model reset, interrupted restore completion, and interrupted completed-free-flow promotion. No tracking, calibration, navigation or persistence logic, models, worker or third-party source was changed for the import.

Packaging adaptations and the requested light-mode styling:

- `.gitignore`: Ignore dependencies, builds, local test evidence, reports, environment files and logs.
- `README.md`: Standalone nested-path setup, current flow, privacy, license, verification commands and acceptance limits.
- `package.json`: Add exact existing Playwright 1.64.1 dev dependency, compatible Node engine and import-integrity command.
- `package-lock.json`: Lock Playwright and its dev-only dependencies; preserve all original package versions.
- `scripts/runtime-browser-check.mjs`: Resolve Playwright from this package instead of a machine-specific npm cache.
- `scripts/check-fixture-camera.mjs`: Resolve Playwright from this package instead of a machine-specific npm cache.
- `scripts/check-server.mjs`: Accept an explicit loopback origin/output, keep receipts ignored, compare app asset bytes and verify HEAD/POST behavior.
- `scripts/fingerprint.mjs`: Fingerprint committed source/model/assets/docs without requiring excluded dist or old scratch receipts.
- `docs/MINIMAL-FLOW.md`: Keep current behavior and parent lifecycle fixes; remove scratch-only paths and prior verification claims.

- `src/styles.css`: requested light palette, visible blue reference circles, contrasting target borders, selection/focus states and amber diagnostics.
- `index.html`: white browser theme-color metadata.

Added import metadata/integrity checking and concise source/license documentation. The locked production dependencies and all previously locked dependency versions are preserved. Playwright is development-only. The retained production license inventory therefore remains unchanged.

Excluded: `node_modules`, `dist`, local test captures/logs, personal attachments, calibration/camera data and historical scratch verification reports. The checked upstream source snapshots, models, WASM, patches, source maps and license notices remain so their audits work in a fresh clone. `docs/PROVENANCE.md` replaces old phase-specific reports as the current source/license guide. Clarte's existing root files and `sources.lock.json` continue to describe its skills and are unchanged.

[WEBEYETRACK-SOURCE-FINGERPRINT.json](WEBEYETRACK-SOURCE-FINGERPRINT.json) is this import's **source/model/asset** manifest. It excludes itself, `dist`, dependencies and evidence. Verify it before building or after reproducible checks with `node scripts/fingerprint.mjs --verify`; regenerate only after reviewing intentional source changes. `public/vendor/webeyetrack/BUILD.json` separately pins the generated worker/dependency inputs. The browser report separately pins tested HTML/JS/CSS build bytes, and the HTTP audit compares the served build/model/license assets to local hashes.

Fresh checks and runtime commands are in the [README](../README.md). Historical source tests do not imply that the inactive WebGazer runtime is used. Fake cameras, synthetic workers and tensor fixtures do not establish physical gaze or blink accuracy. Browser screenshots are test fixtures; no externally recorded or T3 demo is included by this import worker. The parent owns final independent review, media inspection and publication.
