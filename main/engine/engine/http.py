"""HTTP boundary: validation (from v0, with PR 15's request ids), one lock around the engine."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 256 * 1024


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


def serve(engine, host="127.0.0.1", port=8765, page=None, ready=None):
    lock = threading.Lock()
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
                self.send(200, json.dumps({"ok": True, "model": engine.model, "rescorer": engine.rescorer_name,
                                           "vocabulary": len(engine.lex)}).encode())
            else:
                self.send(404, b'{"error":"Not found"}')

        def body(self):
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 <= size <= MAX_BODY:
                raise ValueError("Request must be at most 256 KiB")
            raw = self.rfile.read(size) or b"{}"
            return json.loads(raw)

        def do_POST(self):
            if self.path not in ("/api/v1/predict", "/api/predict", "/api/v1/commit"):
                self.send(404, b'{"error":"Not found"}')
                return
            try:
                body = self.body()
                req = clean_request(body)
                if self.path == "/api/v1/commit":
                    word = body.get("word")
                    if not isinstance(word, str) or not word.strip() or len(word) > 64:
                        raise ValueError("word must be a non-empty string of at most 64 characters")
            except (ValueError, UnicodeDecodeError, TypeError, OverflowError) as error:
                self.send(400, json.dumps({"error": str(error)}).encode())
                return
            try:
                start = time.perf_counter()
                if self.path == "/api/v1/commit":
                    with lock:
                        engine.commit(word, req["history"], req["message"])
                    result = {"ok": True}
                elif self.path == "/api/predict":
                    with lock:
                        result = engine.predict_v0(req["history"], req["message"], req["groups"])
                else:
                    with lock:
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
