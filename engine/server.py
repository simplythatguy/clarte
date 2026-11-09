"""Prediction v1 server. Loads and warms every model, then listens (default 127.0.0.1:8765).

Run with the v0 environment:  .venv/bin/python server.py [--port 8765] [--rescorer auto|qwen2.5-1.5b|smol135-ft|none]
`auto` takes the best rescorer whose weights are present (engine/neural.py PREFERENCE): an MLX model from
models/ (fetch_models.py), else v0's fine-tuned SmolLM2-135M, else none.

`--transcriber` (or PREDICT_TRANSCRIBER) names the Whisper model that hears the partner when the browser's own
recognition fails (NAT-49, engine/transcribe.py); `none` turns it off. It loads in the background after the port
opens; the first run downloads its weights (about 290 MB) from the Hugging Face Hub.
"""
import argparse
import json
import os
import time
from pathlib import Path

from engine import Engine
from engine.http import serve
from engine.transcribe import DEFAULT_MODEL, Transcriber

HERE = Path(__file__).resolve().parent


def load(model="deployable", rescorer="auto", threads=4, params=None):
    t0 = time.perf_counter()
    try:
        engine = Engine(model=model, rescorer=rescorer, threads=threads, params=params)
    except FileNotFoundError as error:
        if model != "deployable":
            raise
        print(f"Deployable unavailable: {error}\nFalling back to light.", flush=True)
        engine = Engine(model="light", rescorer=rescorer, threads=threads, params=params)
    # Warm every path: the v0 neural position, the rescorer's fresh and incremental prompt passes at several
    # lengths, the candidate pass with small and large tries, the complete-only page. The GPU backend compiles
    # its kernels on first use, so each shape class must run once before the port opens.
    dinner = [["partner", "Where would you like to go for dinner tonight?"]]
    chat = [["partner", "Hi there, how are you doing today?"], ["user", "hello there i am fine thanks"]]
    warm = [(dinner, ["i", "want", "to", "go", "to", "the"], ""), (dinner, ["i", "want", "to", "go", "to", "the"], "3"),
            (dinner, ["i", "want", "to", "go", "to", "the"], "31"), (dinner, ["i", "want", "to", "go", "to", "the"], "3134"),
            (dinner, ["i", "want", "to", "go", "to", "the", "restaurant"], ""), (dinner + chat, ["so"], ""),
            (chat * 3, ["so"], "21"), (chat * 6, ["so", "i"], ""), (chat * 12, ["so"], "2"), (chat * 12, ["so", "what"], ""),
            (chat * 12 + dinner, [], ""), ([], [], ""), ([], [], "1"), ([], ["thank"], "")]
    for history, message, groups in warm:
        engine.predict(history, message, groups)
    engine.predict(dinner, ["i", "want", "to", "go", "to", "the"], "3134", limit=4, complete=True)
    engine.start_conversation("ui")
    print(json.dumps({"loaded_s": round(time.perf_counter() - t0, 1), "model": engine.model,
                      "rescorer": engine.rescorer_name, "vocabulary": len(engine.lex)}), flush=True)
    return engine


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["deployable", "light"], default="deployable")
    parser.add_argument("--rescorer", default=os.environ.get("PREDICT_RESCORER", "auto"))
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--params", default=None, help="JSON overrides for engine parameters")
    parser.add_argument("--transcriber", default=os.environ.get("PREDICT_TRANSCRIBER", DEFAULT_MODEL),
                        help="Whisper model for hearing the partner, or none")
    args = parser.parse_args()
    rescorer = None if args.rescorer in ("none", "", "off") else args.rescorer
    engine = load(args.model, rescorer, args.threads, json.loads(args.params) if args.params else None)
    transcriber = None if args.transcriber in ("none", "", "off") else Transcriber(args.transcriber)
    try:
        serve(engine, args.host, args.port, HERE / "index.html",
              ready=(lambda _server: transcriber.start()) if transcriber else None, transcriber=transcriber)
    finally:
        engine.close()


if __name__ == "__main__":
    main()
