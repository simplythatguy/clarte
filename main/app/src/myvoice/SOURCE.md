# Where the voice code comes from

The person's own voice (NAT-32) is made and spoken by the local voice service in `prototypes/Voice` (PR #9, NAT-14): it picks the clearest speech, makes an ElevenLabs Instant Voice Clone from it, and speaks with it. This folder is the app's side of that service.

| File | From | How |
| -- | -- | -- |
| `recorder.ts` | `prototypes/Voice/src/recorder.ts` at `fbcfe88` | Exact copy. sha256 `c3c00b6db3cbfb89a9020b0697d302fded762752b00ed68cb8da61ce37eafbf5` |
| `prompts.ts` | `prototypes/Voice/src/prompts.ts` at `fbcfe88` | Exact copy. sha256 `d478e4a143aa8f4f296a3ecbf53abf49a6e5f63976e1a7cfab0b2f4099cba0f8` |
| `service.ts` | `prototypes/Voice/src/api.ts` | Adapted: only the calls the app uses, with timeouts. |
| `voices.ts` | `prototypes/UI/v0/s8/src/clonedVoice.ts` and `voiceService.ts` (NAT-27, never merged) | Adapted: speaks with the voice chosen in Menu › My voice instead of the newest one, and keeps the voice list for the menu. |
| `maker.ts` | `prototypes/Voice/src/screens/RecordToday.tsx` and `Upload.tsx` | Rewritten: the recording session without the prototype's screens, which the app draws as cards (`VoiceSetup.tsx`). |
