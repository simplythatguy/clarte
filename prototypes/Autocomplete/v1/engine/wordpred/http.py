"""Small serial HTTP boundary shared by the two test servers."""
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from . import Predictor
from .conversation import validate_history


def load_predictor(model):
    try:
        predictor = Predictor(model=model)
    except FileNotFoundError as error:
        if model != 'deployable':
            raise
        print(f'Deployable unavailable: {error}\nFalling back to light.', flush=True)
        predictor = Predictor(model='light')
    predictor.start_conversation('ui')
    return predictor


def request_values(body):
    if not isinstance(body, dict):
        raise ValueError('Request must be a JSON object')
    if 'context_text' in body:
        if 'history' in body:
            raise ValueError('Provide either context_text or history, not both')
        text = body['context_text']
        if not isinstance(text, str):
            raise ValueError('context_text must be a string')
        # Treat pasted text as one partner turn; do not guess speaker boundaries.
        body = {**body, 'history': [['partner', text.strip()]] if text.strip() else []}
    history, message, groups = body.get('history', []), body.get('message', []), body.get('groups', '')
    if not isinstance(history, list) or any(not isinstance(turn, list) or len(turn) != 2
                                           or not isinstance(turn[0], str) or turn[0] not in {'partner', 'user'} or not isinstance(turn[1], str)
                                           for turn in history):
        raise ValueError('history must be [["partner"|"user", text], ...]')
    if not isinstance(message, list) or any(not isinstance(word, str) for word in message):
        raise ValueError('message must be an array of strings')
    if not isinstance(groups, str) or len(groups) > 128 or any(ch not in '1234' for ch in groups):
        raise ValueError('groups must contain at most 128 digits from 1 to 4')
    return validate_history(history), message.copy(), groups


def serve(endpoint, predict, page, host, port, timing=False, *, correlate=False, assets=None):
    page = Path(page).read_bytes()
    assets = {route: Path(path).read_bytes() for route, path in (assets or {}).items()}

    class Handler(BaseHTTPRequestHandler):
        def send(self, status, body, content_type='application/json'):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self):
            self.send(204, b'')

        def do_GET(self):
            if self.path in {'/', '/index.html'}:
                self.send(200, page, 'text/html; charset=utf-8')
            elif self.path in assets:
                self.send(200, assets[self.path], 'text/javascript; charset=utf-8')
            else:
                self.send(404, b'{"error":"Not found"}')

        def do_POST(self):
            if self.path != endpoint:
                self.send(404, b'{"error":"Not found"}')
                return
            identity = {}
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 <= size <= 65536:
                    raise ValueError('Request must be at most 64 KiB')
                body = json.loads(self.rfile.read(size) or b'{}')
                if correlate:
                    request_id = body.get('request_id') if isinstance(body, dict) else None
                    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 128:
                        raise ValueError('request_id must be a nonempty string of at most 128 characters')
                    identity['request_id'] = request_id
                values = request_values(body)
                if correlate:
                    identity['input'] = dict(zip(('history', 'message', 'groups'), values))
            except (ValueError, UnicodeDecodeError, TypeError) as error:
                self.send(400, json.dumps({'status': 'error', 'error': str(error), **identity}).encode())
                return
            try:
                start = time.perf_counter()
                result = predict(*values)
                result = {**result, **identity}
                if timing:
                    result['ms'] = round(1000 * (time.perf_counter() - start), 1)
                self.send(200, json.dumps(result, allow_nan=False).encode())
            except Exception as error:
                print(f'Prediction failed: {error}', flush=True)
                self.send(500, json.dumps({'status': 'error',
                    'error': 'Prediction failed; retry or check the local server log', **identity}).encode())

    with HTTPServer((host, port), Handler) as server:
        print(f'Serving http://{host}:{port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
