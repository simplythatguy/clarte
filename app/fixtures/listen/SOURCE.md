# Listener test fixtures

These are 16 kHz, 16-bit copies of recordings from **CNVVE** (Hedeshy, Menges, Staab, *CNVVE: Dataset and Benchmark for Classifying Non-verbal Voice*, Interspeech 2023). Source: [doi:10.18419/darus-3898](https://doi.org/10.18419/darus-3898). Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The audio is unchanged apart from the format.

| File | CNVVE source |
|---|---|
| `user-mmhmm-0.wav` … `user-mmhmm-7.wav` | `confirm_08f2e6f3_19-29_male_home_Q_1_0.wav` … `Q_8_0.wav` |
| `user-ahem.wav` | `ahem_08f2e6f3_19-29_male_home_Q_34_0.wav` |
| `user-hush.wav` | the first `hush_08f2e6f3_*` file |
| `neighbour-mmhmm-0.wav`, `-1` | `confirm_066ec67b_30-39_male_home_Q_1_0.wav`, `Q_2_0.wav` |
| `neighbour-mmhmm-2.wav`, `-3` | `confirm_13013a67_30-39_male_home_Q_1_0.wav`, `Q_2_0.wav` |

`scripts/e2e-listen.mjs` plays these through Chromium's fake microphone. One person (08f2e6f3) teaches their "mm-hmm" from six takes, and two other men's "mm-hmm" play the neighbours.

The shipped bank `public/listen/bank.json` is derived from the same dataset under the same licence. It holds features only (cepstra, level and pitch), no audio.
