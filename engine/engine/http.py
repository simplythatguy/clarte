"""HTTP boundary: validation (from v0, with PR 15's request ids), one request at a time in the engine, predictions
before punctuation (`EngineLock`, NAT-52).

`/api/v1/transcribe` (NAT-49) takes raw audio, not JSON, and runs outside the engine's lock: hearing the partner
never holds up a prediction."""
import json
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .transcribe import MAX_SECONDS, RATE, pcm16

MAX_BODY = 256 * 1024
MAX_AUDIO = RATE * MAX_SECONDS * 2      # 30 s of 16 kHz 16-bit mono PCM


class Superseded(Exception):
    """A newer background request arrived: this one's answer is out of date, so it stops."""


class EngineLock:
    """The engine runs one request at a time, and a prediction never waits behind punctuation (NAT-52).

    Predictions and commits are urgent: they take the engine in turn. Punctuation is background work: it starts only
    when no urgent request is waiting, and between the words it scores it calls `pause()`, which hands the engine to
    any urgent request that arrived meanwhile and takes it back once none is left. A prediction then waits at most
    one punctuation step (tens of milliseconds) instead of the whole message (hundreds; seconds for a long one).

    The newest background request wins: the app asks for the message as it stands, so an older request (a message
    since changed) stops with `Superseded` at its next pause, or before it starts, instead of making Speak wait."""

    def __init__(self):
        self._engine = threading.Lock()
        self._state = threading.Condition()
        self._urgent = 0              # urgent requests waiting for or holding the engine
        self._background = 0          # background requests so far; the latest one's number is the one that may run

    @contextmanager
    def urgent(self):
        with self._state:
            self._urgent += 1
        try:
            with self._engine:
                yield
        finally:
            with self._state:
                self._urgent -= 1
                self._state.notify_all()

    def _take_for_background(self, mine):
        while True:
            with self._state:
                self._state.wait_for(lambda: self._urgent == 0 or self._background != mine)
                if self._background != mine:
                    raise Superseded
            self._engine.acquire()
            if self._background != mine:
                self._engine.release()
                raise Superseded
            if self._urgent == 0:
                return
            self._engine.release()    # an urgent request arrived between the check and the lock: it goes first

    @contextmanager
    def background(self):
        with self._state:
            self._background += 1
            mine = self._background
            self._state.notify_all()  # an older background request waiting for its turn gives up now
        self._take_for_background(mine)
        held = [True]

        def pause():
            """Let urgent requests through, then carry on; stop if a newer background request has arrived."""
            if self._background != mine:
                raise Superseded
            if self._urgent == 0:
                return
            self._engine.release()
            held[0] = False
            self._take_for_background(mine)
            held[0] = True

        try:
            yield pause
        finally:
            if held[0]:
                self._engine.release()


def clean_request(body, need_groups=True):
    if not isinstance(body, dict):
        raise ValueError("Request must be a JSON object")
    history, message, groups = body.get("history", []), body.get("message", []), body.get("groups", "")
    if history is None:
        history = []
    if message is None:
        message = []
    if groups is None:
        groups = ""
    if not isinstance(history, list) or any(not isinstance(t, (list, tuple)) or len(t) != 2 or t[0] not in ("partner", "user")
                                            or not isinstance(t[1], str) for t in history):
        raise ValueError('history must be [["partner"|"user", text], ...]')
    if not isinstance(message, list) or any(not isinstance(w, str) for w in message):
        raise ValueError("message must be an array of strings")
    if not isinstance(groups, str) or len(groups) > 128 or any(ch not in "1234" for ch in groups):
        raise ValueError("groups must contain at most 128 digits from 1 to 4")
    limit, offset = body.get("limit", 8), body.get("offset", 0)
    if type(limit) is not int or not 1 <= limit <= 64:
        raise ValueError("limit must be an integer from 1 to 64")
    if type(offset) is not int or not 0 <= offset <= 10_000_000:
        raise ValueError("offset must be a non-negative integer")
    rid = body.get("id", None)
    if rid is not None and not isinstance(rid, (int, str)):
        raise ValueError("id must be an integer or string")
    complete = body.get("complete", False)
    if complete is None:
        complete = False
    if not isinstance(complete, bool):
        raise ValueError("complete must be true or false")
    return dict(history=[list(t) for t in history[-200:]], message=message[-200:], groups=groups,
                limit=limit, offset=offset, id=rid, complete=complete)


def serve(engine, host="127.0.0.1", port=8765, page=None, ready=None, transcriber=None):
    lock = EngineLock()
    page_bytes = page.read_bytes() if page is not None and page.is_file() else b"<!doctype html><title>Clarte prediction v1</title><p>POST /api/v1/predict"

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            pass

        def send(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self):
            self.send(204, b"")

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self.send(200, page_bytes, "text/html; charset=utf-8")
            elif self.path == "/api/v1/health":
                hearing = transcriber.status() if transcriber is not None else {"model": None, "state": "off"}
                self.send(200, json.dumps({"ok": True, "model": engine.model, "rescorer": engine.rescorer_name,
                                           "vocabulary": len(engine.lex), "transcriber": hearing}).encode())
            else:
                self.send(404, b'{"error":"Not found"}')

        def body(self):
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 <= size <= MAX_BODY:
                raise ValueError("Request must be at most 256 KiB")
            raw = self.rfile.read(size) or b"{}"
            return json.loads(raw)

        def transcribe(self):
            """16 kHz mono 16-bit PCM in the body -> {available, text, ms}."""
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= MAX_AUDIO:
                    self.close_connection = True          # the oversized body is never read
                    raise ValueError(f"audio must be at most {MAX_SECONDS} seconds of 16 kHz 16-bit mono PCM")
                audio = pcm16(self.rfile.read(size))
            except ValueError as error:
                self.send(400, json.dumps({"error": str(error)}).encode())
                return
            if transcriber is None:
                self.send(200, b'{"available":false,"text":""}')
                return
            try:
                start = time.perf_counter()
                result = transcriber.transcribe(audio)
                result["ms"] = round(1000 * (time.perf_counter() - start), 1)
                self.send(200, json.dumps(result).encode())
            except Exception as error:  # noqa: BLE001
                print(f"Transcription failed: {type(error).__name__}: {error}", flush=True)
                self.send(500, b'{"error":"Transcription failed; check the server log"}')

        def do_POST(self):
            if self.path == "/api/v1/transcribe":
                self.transcribe()
                return
            if self.path == "/api/v1/reset":
                # The launcher's call when it reuses a kept engine (audit L3): a new session, as if freshly loaded.
                # Browsers send Origin on every cross-site POST, so no web page can wipe the person's session.
                if self.headers.get("Origin") is not None:
                    self.send(403, b'{"error":"reset is for the launcher only"}')
                    return
                with lock.urgent():
                    engine.start_conversation()
                self.send(200, b'{"ok":true}')
                return
            if self.path not in ("/api/v1/predict", "/api/predict", "/api/v1/commit", "/api/v1/punctuate", "/api/v1/phrases"):
                self.send(404, b'{"error":"Not found"}')
                return
            try:
                body = self.body()
                req = clean_request(body)
                if self.path == '/api/v1/phrases':
                    phrases = body.get('phrases')
                    if (not isinstance(phrases, list) or not 1 <= len(phrases) <= 64 or
                            any(not isinstance(s, str) or not s.strip() or len(s) > 2000 for s in phrases)):
                        raise ValueError('phrases must contain 1–64 nonempty strings of at most 2000 characters')
                if self.path == '/api/v1/phrases':
                    with lock.urgent():
                        result = engine.rank_phrases(req['history'], phrases)
                    result = {'id': req['id'], **result}
                elif self.path == "/api/v1/commit":
                    word = body.get("word")
                    if not isinstance(word, str) or not word.strip() or len(word) > 64:
                        raise ValueError("word must be a non-empty string of at most 64 characters")
            except (ValueError, UnicodeDecodeError, TypeError, OverflowError) as error:
                self.send(400, json.dumps({"error": str(error)}).encode())
                return
            try:
                start = time.perf_counter()
                if self.path == "/api/v1/commit":
                    with lock.urgent():
                        engine.commit(word, req["history"], req["message"])
                    result = {"ok": True}
                elif self.path == "/api/v1/punctuate":
                    try:
                        with lock.background() as pause:
                            result = engine.punctuate(req["history"], req["message"], pause)
                    except Superseded:
                        # A newer punctuation request came in: this message changed, so its answer is not needed.
                        result = {"available": False, "superseded": True, "text": "", "end": ""}
                    result = {"id": req["id"], **result}
                elif self.path == "/api/predict":
                    with lock.urgent():
                        result = engine.predict_v0(req["history"], req["message"], req["groups"])
                else:
                    with lock.urgent():
                        result = engine.predict(req["history"], req["message"], req["groups"], req["limit"], req["offset"],
                                                req["complete"])
                    result = {"id": req["id"], **result}
                result["ms"] = round(1000 * (time.perf_counter() - start), 1)
                self.send(200, json.dumps(result, allow_nan=False).encode())
            except Exception as error:  # noqa: BLE001
                print(f"Prediction failed: {type(error).__name__}: {error}", flush=True)
                self.send(500, b'{"error":"Prediction failed; check the server log"}')

    ThreadingHTTPServer.request_queue_size = 64        # the default backlog of 5 resets connections under 20 concurrent clients
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"Serving http://{host}:{port}", flush=True)
    if ready:
        ready(server)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
