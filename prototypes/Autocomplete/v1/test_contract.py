"""Model-free contract tests; only controlled predictors and loopback HTTP."""
import json
import threading
import unittest
from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch

from autocomplete import complete_with
from wordpred.http import serve


class ControlledPredictor:
    def __init__(self):
        self.matches = [('hello', .6), ('hi', .2), ('help', .1), ('her', .06), ('him', .04)]
        self.calls = []
        self.failure = None

    def context(self, history, message):
        return history, message

    def matching_probabilities(self, context, groups):
        self.calls.append((context, groups))
        if self.failure:
            raise self.failure
        return self.matches

    def commit(self, *args):
        raise AssertionError('A suggestion must never commit')


@contextmanager
def local_service(predictor):
    ready = threading.Event()
    servers = []

    class LocalServer(HTTPServer):
        def __init__(self, address, handler):
            super().__init__(('127.0.0.1', 0), handler)
            servers.append(self)

        def serve_forever(self):
            ready.set()
            super().serve_forever(poll_interval=.01)

    root = Path(__file__).parent
    with patch('wordpred.http.HTTPServer', LocalServer):
        worker = threading.Thread(target=serve, args=(
            '/api/complete', lambda *v: complete_with(predictor, *v),
            root / 'index.html', '127.0.0.1', 0),
            kwargs={'correlate': True, 'assets': {'/client.mjs': root / 'client.mjs'}})
        worker.start()
        if not ready.wait(5):
            raise AssertionError('Server failed to start')
        connection = HTTPConnection('127.0.0.1', servers[0].server_port, timeout=5)
        try:
            yield connection
        finally:
            connection.close()
            servers[0].shutdown()
            worker.join(5)
            assert not worker.is_alive()


def post(connection, body):
    connection.request('POST', '/api/complete', json.dumps(body), {'Content-Type': 'application/json'})
    response = connection.getresponse()
    return response.status, json.loads(response.read())


class ContractTests(unittest.TestCase):
    def test_ranked_model_mass_and_explicit_acceptance(self):
        predictor = ControlledPredictor()
        history, message = [['partner', 'Hi']], ['say']
        result = complete_with(predictor, history, message, '2')
        self.assertEqual(result['status'], 'suggestion')
        self.assertEqual(result['word'], 'hello')
        self.assertEqual(result['probability'], .6)
        self.assertEqual(result['probability_kind'], 'conditional_model_mass')
        self.assertEqual([v['word'] for v in result['alternatives']], ['hi', 'help', 'her'])
        self.assertNotIn('confidence', result)
        self.assertEqual(history, [['partner', 'Hi']])
        self.assertEqual(message, ['say'])

    def test_empty_groups_reach_engine_and_no_match_is_not_failure(self):
        predictor = ControlledPredictor()
        self.assertEqual(complete_with(predictor, [], [], '')['word'], 'hello')
        self.assertEqual(predictor.calls, [(([], []), '')])
        predictor.matches = []
        result = complete_with(predictor, [], [], '4444')
        self.assertEqual((result['status'], result['word'], result['probability'], result['alternatives']),
                         ('no_match', '', 0, []))

    def test_python_rejects_invalid_groups_without_silent_filtering(self):
        predictor = ControlledPredictor()
        for groups in (None, 123, '1x2', '5', '1' * 129):
            with self.subTest(groups=groups), self.assertRaises(ValueError):
                complete_with(predictor, [], [], groups)
        self.assertEqual(predictor.calls, [])

    def test_http_echoes_request_identity_and_exact_validated_context(self):
        predictor = ControlledPredictor()
        with local_service(predictor) as connection:
            for request_id, context in [('old', {'context_text': ' Outside? '}),
                                        ('new', {'history': [['user', 'yes'], ['partner', '  Now?  ']]})]:
                body = {'request_id': request_id, 'message': ['draft'], 'groups': '', **context}
                status, result = post(connection, body)
                self.assertEqual(status, 200)
                self.assertEqual(result['request_id'], request_id)
                self.assertEqual(result['input'], {'history': context.get('history', [['partner', 'Outside?']]),
                                                  'message': ['draft'], 'groups': ''})
                self.assertEqual(predictor.calls[-1], ((result['input']['history'], ['draft']), ''))

    def test_http_engine_failure_is_correlated_and_server_recovers(self):
        predictor = ControlledPredictor()
        with local_service(predictor) as connection:
            predictor.failure = RuntimeError('private engine details')
            status, result = post(connection, {'request_id': 'failed'})
            self.assertEqual(status, 500)
            self.assertEqual(result['status'], 'error')
            self.assertEqual(result['request_id'], 'failed')
            self.assertEqual(result['input'], {'history': [], 'message': [], 'groups': ''})
            self.assertNotIn('private engine details', result['error'])
            self.assertNotIn('word', result)
            predictor.failure = None
            predictor.matches = []
            status, result = post(connection, {'request_id': 'retry', 'groups': '4444'})
            self.assertEqual(status, 200)
            self.assertEqual(result['status'], 'no_match')
            self.assertEqual(result['request_id'], 'retry')

    def test_http_validation_and_explicit_static_asset_routes(self):
        predictor = ControlledPredictor()
        with local_service(predictor) as connection:
            for body in ({}, {'request_id': ''}, {'request_id': 1}, {'request_id': 'x' * 129},
                         {'request_id': 'valid', 'groups': '1x'}, {'request_id': 'valid', 'message': 'draft'}):
                status, result = post(connection, body)
                self.assertEqual(status, 400)
                self.assertNotIn('input', result)
                if body.get('request_id') == 'valid':
                    self.assertEqual(result['request_id'], 'valid')
            self.assertEqual(predictor.calls, [])
            for path, expected in [('/client.mjs', 200), ('/../server.py', 404)]:
                connection.request('GET', path)
                response = connection.getresponse()
                self.assertEqual(response.status, expected)
                if expected == 200:
                    self.assertIn('text/javascript', response.getheader('Content-Type'))
                response.read()

    def test_nonfinite_engine_probability_is_a_correlated_failure(self):
        predictor = ControlledPredictor()
        predictor.matches = [('hello', float('nan'))]
        with local_service(predictor) as connection:
            status, result = post(connection, {'request_id': 'nonfinite'})
            self.assertEqual(status, 500)
            self.assertEqual(result['request_id'], 'nonfinite')
            self.assertEqual(result['status'], 'error')
            self.assertNotIn('word', result)

    def test_malformed_json_cannot_invoke_engine(self):
        predictor = ControlledPredictor()
        with local_service(predictor) as connection:
            connection.request('POST', '/api/complete', '{bad json', {'Content-Type': 'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            result = json.loads(response.read())
            self.assertEqual(result['status'], 'error')
            self.assertNotIn('request_id', result)
            self.assertEqual(predictor.calls, [])


if __name__ == '__main__':
    unittest.main()
