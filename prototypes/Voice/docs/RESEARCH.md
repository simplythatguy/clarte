# Voice cloning for Clarte: research and decisions

Linear: NAT-14. Updated 2026-11-07.

## The goal

Many people who use Clarte lost clear speech to a progressive condition such as Parkinson's or ALS. Some have recordings from before (home videos, voicemails, talks). Others only have how they speak today. In both cases, Clarte should speak in a voice that sounds like them.

## Current engine: ElevenLabs

*Decision updated 2026-11-07.* The first version cloned locally with Chatterbox Turbo (described below). In listening tests it sounded poor, so cloning and speech now run on **ElevenLabs**:

- **Cloning:** Instant Voice Cloning (`POST /v1/voices/add`), with background-noise removal for old recordings.
- **Speaking:** text-to-speech with `eleven_multilingual_v2` by default.

Clarte still does the selection on this computer: decoding, scoring, the speaker check (now with [Resemblyzer](https://github.com/resemble-ai/Resemblyzer), Apache-2.0) and assembling the best speech. The reference now aims for 90 s and is capped at 3 minutes, since ElevenLabs recommends one to two minutes of clean speech.

Why ElevenLabs:

- **It's the system the paper evaluated.** The intelligibility benefit below was measured on ElevenLabs Instant Voice Cloning, and "Like my recordings" uses the paper's exact settings.
- **It ranks at or near the top for clone similarity.** In third-party comparisons, Multilingual v2 is within a few points of Fish Audio S2 Pro on Hume's Sept 2026 same-speaker board. Eleven v3 ranked last on that board, which is why it isn't the default.
- **It has a path for patients.** The [Impact Program](https://elevenlabs.io/blog/impact-program-announcement) offers free licences to people losing speech to ALS/MND and, reportedly, other conditions.

Trade-offs:

- **The selected speech and the text to speak leave the computer.** The consent statement says so.
- **Clones stay on ElevenLabs until deleted.** Clarte deletes them with the voice. Third-party reviews say cloning isn't covered by Zero Retention Mode.
- **HIPAA terms are Enterprise-only.**
- **Speech costs credits.** Repeated phrases are cached.

Measured with the same synthetic test material as below. Similarity uses Resemblyzer, so it isn't comparable with the Chatterbox table further down:

| Voice | Pacing | Similarity to clean Daniel | Similarity to bystander | Words/s | Time to audio |
| --- | --- | --- | --- | --- | --- |
| Old video | Like my recordings | 0.843 | 0.49 | 4.61 | 0.96 s |
| Old video | Steadier | 0.845 | 0.47 | 4.09 | 0.43 s |
| Today | Like my recordings | 0.863 | 0.62 | 2.69 | 1.00 s |
| Today | Steadier | 0.849 | 0.59 | 3.85 | 0.46 s |
| *Chatterbox Turbo, same check* | | 0.774–0.847 | 0.52–0.56 | | 2.1–2.6 s |

- **Pacing does what it says.** *Like my recordings* copies the slow pacing of the "today" recording (2.69 words/s), and *Steadier* restores fluent pacing (3.85).
- **Speed:** the whole phrase arrives in about 0.4–1 s, against 4–5 s locally.
- **Cloning time:** creating the voice took 3–6 s.
- **Caveat:** speaker-similarity models capture only part of what listeners hear. The local engine's failure was audible, not measured, and these clips are synthetic voices, not dysarthric speech.

## What the research says

**Cloning from today's speech is a reasonable path, not just a fallback.** Bottalico et al. ([J Voice 2026, doi:10.1016/j.jvoice.2026.04.034](https://doi.org/10.1016/j.jvoice.2026.04.034)) cloned 6 dysphonic and 6 healthy speakers with ElevenLabs Instant Voice Cloning. They used about one minute of speech each: the Rainbow Passage plus the CAPE-V sentences. Listeners could rarely tell the clones from the real voices (43.1% identification accuracy). In noise, though, the cloned dysphonic voices were *more* intelligible than the real ones. For the male dysphonic speakers, intelligibility rose from 35.5% to 66.5%. The authors conclude that cloning "normalize[s] the spectral and temporal distortions that reduce intelligibility," and that this "may be beneficial for assistive communication." For Clarte that is the point: we want the person's timbre, not their impairment. Clarte's "today" recordings use the same Rainbow Passage and CAPE-V material.

The same pattern appears for dysarthria:

- Sanchez et al. ([Interspeech 2025](https://www.isca-archive.org/interspeech_2025/sanchez25_interspeech.pdf)) used Parler-TTS to approximate dysarthric voices. Some of the synthetic samples sounded like the target speaker and were more intelligible than that speaker's own recordings.
- Zero-shot cloning has reproduced TORGO dysarthric speakers from a single utterance of about 7 s ([arXiv 2606.19823](https://arxiv.org/pdf/2606.19823)). The same has been done with a commercial platform ([arXiv 2503.01266](https://arxiv.org/pdf/2503.01266)).

**The known risk is the reverse: carrying the impairment into the clone.** Veaux, Yamagishi & King ([Interspeech 2012](https://www.research.ed.ac.uk/en/publications/using-hmm-based-speech-synthesis-to-reconstruct-the-voice-of-indi/)) built voices for people with degenerative speech disorders. They noted that speaker adaptation clones "not only the vocal identity of the patient but also the symptoms." Their fix, called *voice reconstruction* and later *voice repair*, swaps some model components for an average voice's, while keeping the components that carry identity. Wang et al. ([arXiv 2202.09082](https://arxiv.org/pdf/2202.09082)) and the two-stage conversion work ([arXiv 2106.01415](https://arxiv.org/pdf/2106.01415)) treat identity preservation as the main difficulty in dysarthric speech reconstruction. Clarte's **Steadier** pacing is the same idea applied to a modern zero-shot model (see below).

## Frameworks compared (first round)

| Model | Clones? | Weights licence | Runs where | Notes |
| --- | --- | --- | --- | --- |
| **Chatterbox Turbo** (Resemble AI) | Zero-shot, 5–15 s reference | MIT | Python; CPU, CUDA, Apple MPS | **Chosen.** 350M token model with a 2-step decoder. Watermarks every output with Perth. |
| Chatterbox (original) | Zero-shot | MIT | Python | Has `exaggeration` and `cfg_weight` controls, but a 2.1 GB token model and slower. Next candidate if we want those controls. |
| Qwen3-TTS 0.6B/1.7B Base (Alibaba) | Zero-shot, about 3 s | Apache-2.0 | Python, GPU-oriented | `qwen-tts` pins `transformers==4.57.3`, which conflicts with Chatterbox's 5.2.0, so it needs its own environment. Its VoiceDesign variant builds a voice from a text description, which could help people with no usable audio. |
| F5-TTS | Zero-shot | Code MIT, **weights CC-BY-NC** | Python, GPU | Non-commercial weights rule it out. |
| XTTS v2 | Zero-shot | Coqui Public Model Licence (non-commercial) | Python | Non-commercial; Coqui has wound down. |
| Kokoro 82M (NAT-14's study-site model) | **No**: fixed voice packs only | Apache-2.0 | Browser (kokoro-js, ONNX q8) or Python | Fast and small, but cannot clone. Community add-ons (KokoClone) attach a separate voice converter. A good stock voice for people who don't want a clone. |
| ElevenLabs Instant Voice Cloning | Yes | Commercial API | Cloud | What the paper used. Sends patients' voices to a third party. |

Source lists: [ocdevel TTS comparison 2026](https://ocdevel.com/blog/20250720-tts), [yaps.ai licence check](https://www.yaps.ai/blog/best-local-tts-models), [Qwen3-TTS ONNX port](https://github.com/elbruno/ElBruno.QwenTTS), [KokoClone](https://hnshowcase.com/post/47252271/kokoclone-zero-shot-voice-cloning-using-kokoro-tts).

The screenshot's latency table (Qwen3-TTS at about 97–150 ms to first speech) assumes a datacenter GPU. On the Apple M4 we measured Chatterbox Turbo at about 2 s to first sentence (below), and Qwen3-TTS is described as GPU-first.

### Why Chatterbox Turbo was tried first

1. Its MIT licence covers both code and weights, so we can ship it.
2. It runs locally on an ordinary laptop. Voice recordings are health-adjacent biometric data, and the Clarte prototypes never upload them.
3. Every clip it produces carries an inaudible Perth watermark. A cloned voice of a real person should be identifiable as synthetic if it is ever misused.
4. It separates its conditioning cleanly, which makes the voice-repair idea possible (next section).

## How the first version used it (Chatterbox Turbo, replaced)

**Choosing the reference** (`server/clarte_voice/curate.py`). Zero-shot quality depends almost entirely on the reference clip. Every upload goes through these steps:

1. Decode with ffmpeg. Phone videos, voicemails, MP3s and browser recordings all work.
2. High-pass at 70 Hz and normalize loudness to −23 LUFS. Quiet, hypophonic Parkinson's speech is lifted, not rejected.
3. Cut the audio into 0.8–5 s speech segments.
4. Score each segment on SNR, voicing, pitch steadiness (frame-to-frame semitone jumps, a jitter and tremor proxy), spectral flatness, length and clipping. Recordings made today weight steadiness more heavily.
5. Embed each segment with Chatterbox's own voice encoder and flag segments far from the dominant speaker as *Maybe someone else*. The threshold adapts to the recording: below the median similarity minus 0.12, floored at 0.62.
6. Put the best segments first, up to 15 s. Turbo's decoder reads only the first 10 s of the reference and its token model the first 15 s. The UI's voice strip draws exactly this.

The uploaded files themselves are deleted. Only the speech segments, the assembled reference and the cached conditioning are kept, in `~/.clarte/voices/<id>`.

**Two pacing styles** (`server/clarte_voice/engine.py`):

- *Like my recordings*: everything comes from the person's reference.
- *Steadier*: timbre conditioning still comes from the person. That's the decoder's mel prompt and x-vector, plus the voice-encoder speaker embedding. But the token model is prompted with Chatterbox's built-in fluent reference speech. The token model is where pacing, pausing and rhythm live, so dysarthric timing does not carry over, while the sound of the voice does. This applies Veaux et al.'s average-voice substitution to the component that encodes timing. It is experimental.

## What we measured with Chatterbox Turbo

These tests use macOS system voices (Daniel as the "person", Samantha as a bystander). They are **not** dysarthric speech, so they check the plumbing and the identity metrics, not clinical benefit. The reproducible script is `server/scripts/evaluate.py`.

Test material:

- *Old video*: 40 s AAC with pink noise. Daniel, then Samantha, then Daniel, with no pause before Samantha.
- *Today*: Daniel reading the CAPE-V sentences at 95 wpm with long pauses, 5 Hz vibrato (simulated tremor) and −9 dB level (simulated hypophonia), as Opus/WebM.

Curation: the segment containing Samantha was flagged and left out (similarity 0.73 against 0.95–0.98 for Daniel's segments). The *Today* reference picked the steadiest segments. Both references were 12–15 s.

Output for "I would like a cup of tea, please. Could you open the window a little?":

| Voice | Style | Similarity to clean Daniel | Similarity to Samantha | Words/s | Whisper WER |
| --- | --- | --- | --- | --- | --- |
| Old video | Like my recordings | 0.880, 0.903 | 0.59, 0.60 | 3.62 | 0 |
| Old video | Steadier | 0.843, 0.865 | 0.58, 0.61 | 3.62–3.77 | 0 |
| Today | Like my recordings | 0.913, 0.894 | 0.61, 0.61 | 2.94–3.04 | 0 |
| Today | Steadier | 0.869, 0.867 | 0.59, 0.63 | 3.46–3.85 | 0 |

Reading:

- Every clone stays on the right side of the same-speaker line (> 0.75).
- *Steadier* speaks 15–25% faster when the reference was slow. That is the intended effect: the timing comes from fluent speech.
- *Steadier* costs about 0.03–0.04 in speaker similarity. That trade-off is why it's a choice, not the default.
- Whisper understood every clip, including the degraded "today" input itself (WER 0). Our synthetic impairment is too mild to test intelligibility. That needs real dysarthric recordings (TORGO or UASpeech, under their licences) or consenting users, and ideally the paper's HINT-in-noise protocol.

Speed on an Apple M4 (16 GB), Turbo, after warm-up:

| Device | First sentence | Whole two-sentence phrase (about 4 s of audio) |
| --- | --- | --- |
| CPU | 2.1–2.6 s | 4.0–5.0 s |
| MPS | 2.4–4.0 s | 4.5–6.6 s |

CPU is the default on Apple Silicon; set `CLARTE_VOICE_DEVICE=mps` to compare. Model load takes about 12 s. Once a phrase has been said, it is cached per voice and style and plays instantly the next time. That suits AAC use, where the same phrases recur.

## Open questions

- **Real validation.** Test both pacing settings on real dysarthric references: speaker similarity, ASR WER, and a small listener panel. Record the results in this file.
- **Professional Voice Cloning.** For people with 30+ minutes of old recordings, ElevenLabs' trained clones are a further step up. They need a verification step that Clarte doesn't support yet.
- **Latency.** For long messages, ElevenLabs' streaming endpoint would let audio start before the whole phrase is ready.
- **No usable audio at all.** Some people cannot produce even short voiced speech. Options are Qwen3-TTS VoiceDesign from a description (age, sex, accent, pitch measured from whatever sound they can make), or a Kokoro stock voice (NAT-14).
- **Consent and safety.** The service records a consent statement with each voice. A clinical deployment would also need guardian consent flows, and a decision on whether family members may make a voice for someone who can no longer consent.
