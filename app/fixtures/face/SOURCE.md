# Face fixture source

`gautam_biswas.jpg` is a profile photo from the WebEyeTrack documentation site (`docs/public/profiles/`), upstream
[RedForestAI/WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) at revision `75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c`.
Licence: MIT, copied in [`LICENSE`](LICENSE). The file is unchanged.

`node scripts/make-fixture.mjs` turns it into `fixtures/face.y4m` (git-ignored), the fake camera for `scripts/e2e-first-run.mjs`.
A photo cannot move its eyes, so nothing measured on it says anything about gaze accuracy.
