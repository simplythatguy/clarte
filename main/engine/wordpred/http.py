"""Small serial HTTP boundary shared by the two test servers."""
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from . import Predictor


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
    history, message, groups = body.get('history', []), body.get('message', []), body.get('groups', '')
    if not isinstance(history, list) or any(not isinstance(turn, list) or len(turn) != 2
                                           or turn[0] not in {'partner', 'user'} or not isinstance(turn[1], str)
                                           for turn in history):
        raise ValueError('history must be [["partner"|"user", text], ...]')
    if not isinstance(message, list) or any(not isinstance(word, str) for word in message):
        raise ValueError('message must be an array of strings')
    if not isinstance(groups, str) or len(groups) > 128 or any(ch not in '1234' for ch in groups):
        raise ValueError('groups must contain at most 128 digits from 1 to 4')
    return history, message, groups


def serve(endpoint, predict, page, host, port, timing=False):
    page = Path(page).read_bytes()

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
            else:
                self.send(404, b'{"error":"Not found"}')

        def do_POST(self):
            if self.path != endpoint:
                self.send(404, b'{"error":"Not found"}')
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 <= size <= 65536:
                    raise ValueError('Request must be at most 64 KiB')
                body = json.loads(self.rfile.read(size) or b'{}')
                values = request_values(body)
            except (ValueError, UnicodeDecodeError, TypeError) as error:
                self.send(400, json.dumps({'error': str(error)}).encode())
                return
            try:
                start = time.perf_counter()
                result = predict(*values)
                if timing:
                    result['ms'] = round(1000 * (time.perf_counter() - start), 1)
                self.send(200, json.dumps(result, allow_nan=False).encode())
            except Exception as error:
                print(f'Prediction failed: {error}', flush=True)
                self.send(500, b'{"error":"Prediction failed; check the server log"}')

    with HTTPServer((host, port), Handler) as server:
        print(f'Serving http://{host}:{port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
