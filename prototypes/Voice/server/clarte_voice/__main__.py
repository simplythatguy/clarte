import os

os.environ.setdefault("TQDM_DISABLE", "1")

import uvicorn


def main() -> None:
    from .store import seed_shared

    seeded = seed_shared()
    if seeded:
        print(f"team voices: {len(seeded)} ready", flush=True)
    uvicorn.run(
        "clarte_voice.app:app",
        host="127.0.0.1",
        port=int(os.environ.get("CLARTE_VOICE_PORT", "4322")),
        log_level="info",
    )


if __name__ == "__main__":
    main()
