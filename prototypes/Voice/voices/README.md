# Team voices

The team's voices, made with the app's ElevenLabs account. Each folder holds one `profile.json`:
the voice's name and its ElevenLabs clone id. **No audio is kept here.** Recordings are personal
data: they stay on the laptop that made the voice (`~/.clarte/voices`), and `.gitignore` keeps
`.wav`, `.webm` and `.m4a` files out of the repo.

When the voice service starts (`clarte ui` or `clarte voice`), it adds these voices to the
laptop's own, so every laptop with `ELEVENLABS_API_KEY` in `.env` can speak with them. A voice
renamed here is renamed on every laptop at its next start.

A team voice can't be changed or deleted from one laptop: that would replace or delete the clone
for everyone. To change one, edit its `profile.json` here.

| Folder | Voice |
| -- | -- |
| `mukhtar/` | Mukhtar's Voice |
| `omer/` | Omer's Voice |
| `amine/` | Amine's Voice |
